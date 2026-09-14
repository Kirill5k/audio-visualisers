import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createLEDAnalysis } from '../js/led-grid/led-analysis.js';
import { createLEDTimelineBuilder, createLEDChunkAnalyzer, createLEDFrameReader, makeLEDBandRanges, selectReviewPassages, FFT_SIZE, FFT_BINS } from '../js/led-grid/led-analysis-core.js';

const rate = 48000;
const tone = (frequency, seconds = 0.8, amplitude = 0.8) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const buffer = channels => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: rate, duration: channels[0].length / rate, getChannelData: channel => channels[channel] });
function analyse(channels) {
  const builder = createLEDTimelineBuilder(channels, rate);
  while (!builder.done) builder.step(12);
  return { timeline: builder.timeline, at: createLEDFrameReader(builder.timeline) };
}
const clone = frame => ({ ...frame, bands: frame.bands.slice(), history: frame.history.slice(), loomLight: frame.loomLight?.slice(), features: { ...frame.features, onsets: frame.features.onsets.slice() }, events: frame.events.map(event => ({ ...event })),
  ...(frame.waveform ? { waveform: { ...frame.waveform, frames: frame.waveform.frames.map(snapshot => ({ ...snapshot, left: snapshot.left.slice(), right: snapshot.right.slice() })) } } : {}),
  flowFrames: frame.flowFrames.map(snapshot => ({ ...snapshot, bands: snapshot.bands.slice(), features: { ...snapshot.features } })) });

test('96 bands cover every retained FFT bin exactly once, including the highest range', () => {
  const ranges = makeLEDBandRanges(rate);
  assert.equal(FFT_SIZE, 32768); assert.equal(FFT_BINS, 16384); assert.equal(ranges.length, 96);
  const covered = new Uint8Array(FFT_BINS);
  for (const range of ranges) for (let bin = range.start; bin < range.end; bin++) covered[bin]++;
  assert.ok(covered.every(count => count === 1));
});

test('silence produces zero spectral bands, history, features and events', () => {
  const { at } = analyse([new Float32Array(rate / 3)]);
  for (const time of [0, 0.1, 0.333, 5]) {
    const frame = at(time);
    assert.ok(frame.bands.every(value => value === 0));
    assert.ok(frame.history.every(value => value === 0));
    assert.equal(frame.features.energy, 0); assert.equal(frame.features.rms, 0);
    assert.ok(frame.features.onsets.every(value => value === 0)); assert.deepEqual(frame.events, []);
  }
});

test('low, middle, high and near-Nyquist tones illuminate their correct complete intervals', () => {
  const ranges = makeLEDBandRanges(rate);
  for (const frequency of [55, 1100, 7500, 23500]) {
    const { at, timeline } = analyse([tone(frequency)]);
    const frame = at(0.45);
    const peak = frame.bands.indexOf(Math.max(...frame.bands));
    const bin = Math.round(frequency * FFT_SIZE / rate);
    assert.ok(bin >= ranges[peak].start - 2 && bin < ranges[peak].end + 2, `${frequency} Hz landed in column ${peak}`);
    assert.ok(frame.bands[peak] > 0.7);
    assert.ok(timeline.bands instanceof Uint16Array, 'band timeline retains 16-bit precision');
    assert.ok(timeline.bands.some(value => value > 0 && value % 257 !== 0));
  }
});

test('stereo powers preserve opposite-phase audio and right-only tracks', () => {
  const pcm = tone(1200, 0.5);
  const mono = analyse([pcm]).at(0.3);
  const opposite = analyse([pcm, Float32Array.from(pcm, value => -value)]).at(0.3);
  const right = analyse([new Float32Array(pcm.length), pcm]).at(0.3);
  assert.deepEqual(opposite.bands, mono.bands);
  assert.ok(Math.abs(opposite.features.energy - mono.features.energy) < 1e-6);
  assert.ok(Math.abs(right.features.rms / mono.features.rms - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.max(...right.bands) > 0.7);
  assert.equal(right.features.balance, 1); assert.equal(opposite.features.balance, 0);
  assert.ok(opposite.features.width > 0.99); assert.equal(mono.features.width, 0);
});

test('impulse onset is causal and within one 60 Hz frame; silence cannot anticipate a centered FFT', () => {
  const pcm = new Float32Array(rate);
  const impulseTime = 0.403;
  pcm[Math.round(impulseTime * rate)] = 1;
  const { at, timeline } = analyse([pcm]);
  assert.ok(at(0.39).bands.every(value => value === 0));
  const events = timeline.events.filter(event => event.strength > 0.05);
  assert.ok(events.length > 0);
  assert.ok(events[0].time >= impulseTime);
  assert.ok(events[0].time - impulseTime <= 1 / 60);
  assert.ok(at(0.42).features.energy > 0);
});

test('fixed calibration preserves quiet/loud contrast and request order', () => {
  const pcm = tone(220, 2, 0.6);
  for (let i = 0; i < rate; i++) pcm[i] *= 0.03;
  const { at } = analyse([pcm]);
  const quiet = clone(at(0.5)), loud = clone(at(1.5));
  assert.ok(quiet.features.energy < loud.features.energy * 0.25);
  assert.ok(Math.max(...quiet.bands) < Math.max(...loud.bands) * 0.25);
  at(0); at(1.9); at(0.03);
  assert.deepEqual(clone(at(1.5)), loud);
  assert.deepEqual(clone(at(0.5)), quiet);
});

test('six-second history preserves brief peaks and row zero is the newest interval', () => {
  const timeline = { sampleRate: rate, duration: 7, frames: 421, bands: new Uint16Array(421 * 96), features: new Float32Array(421 * 10), events: [] };
  timeline.bands[418 * 96 + 40] = 60000;
  timeline.bands[65 * 96 + 10] = 50000;
  const at = createLEDFrameReader(timeline);
  const frame = at(7);
  assert.ok(Math.abs(frame.history[40] - 60000 / 65535) < 1e-7);
  assert.ok(frame.history.some(value => Math.abs(value - 50000 / 65535) < 1e-7));
  assert.ok(at(0).history.every(value => value === 0));
  assert.throws(() => at(NaN), /finite/);
});

test('falling-note sources keep fixed audio times, remain causal and survive arbitrary seeks', () => {
  const timeline = { sampleRate: rate, duration: 8, frames: 481, bands: new Uint16Array(481 * 96), features: new Float32Array(481 * 10), events: [] };
  for (let frame = 0; frame < timeline.frames; frame++) {
    timeline.bands[frame * 96 + 40] = frame * 100;
    timeline.features[frame * 10 + 3] = frame / 481;
  }
  const at = createLEDFrameReader(timeline);
  assert.deepEqual(at(.199).flowFrames.map(item => item.time), [0]);
  const source = clone(at(.201)).flowFrames.find(item => item.time === .2);
  assert.ok(Math.abs(source.bands[40] - 1200 / 65535) < 1e-7);
  for (const time of [.23, 4.19, 1.5, 6.2]) {
    const frame = at(time);
    assert.ok(frame.flowFrames.length <= 31);
    assert.ok(frame.flowFrames.every(item => item.time <= time && item.time >= time - 6 - 1e-7));
    assert.deepEqual(frame.flowFrames.find(item => item.time === .2), source, 'A drop retains its source spectrum throughout its flight');
  }
  const expected = clone(at(7.41));
  at(0); at(8); at(.4);
  assert.deepEqual(clone(at(7.41)), expected);
});

test('review passages choose fixed quiet, dense and changing energy windows', () => {
  const timeline = { frames: 60 * 40 + 1, duration: 40, features: new Float32Array((60 * 40 + 1) * 10) };
  for (let frame = 0; frame < timeline.frames; frame++) timeline.features[frame * 10 + 3] = frame < 12 * 60 ? 0.03 : frame < 24 * 60 ? 0.9 : 0.2;
  const passages = selectReviewPassages(timeline);
  assert.deepEqual(passages.map(item => item.name), ['quiet', 'dense', 'change']);
  assert.ok(passages[0].start < 10); assert.ok(passages[1].start >= 12);
  assert.ok(passages[2].start < 12 && passages[2].start + 8 > 12);
  assert.ok(passages.every(item => item.duration === 8 && item.start >= 0 && item.start <= 32));
  assert.deepEqual(selectReviewPassages(timeline), passages);
});

class BrowserWorker {
  constructor(url) {
    const source = `import { parentPort } from 'node:worker_threads'; globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) }; await import(${JSON.stringify(url.href)}); parentPort.on('message', data => self.onmessage({ data }));`;
    this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
  terminate() { this.worker.terminate(); }
}

test('worker reports progress, synchronous frames, bounded compact storage and source PCM retention', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createLEDAnalysis();
  try {
    const pcm = tone(250, 0.3), progress = [];
    const info = await analysis.load(buffer([pcm]), { onProgress: value => progress.push(value) });
    assert.equal(info.fftSize, 32768); assert.equal(info.fftBins, 16384); assert.equal(info.precision, 16);
    assert.equal(info.analysisFps, 60); assert.equal(info.columns, 96); assert.equal(info.rows, 54);
    assert.equal(progress.at(-1), 1); assert.equal(pcm.byteLength, rate * 0.3 * 4);
    assert.ok(info.timelineBytes < info.frames * (96 * 2 + 10 * 4 + 12));
    assert.ok(!(analysis.getFrame(0.2) instanceof Promise));
    assert.equal(analysis.getReviewPassages().length, 3);
  } finally { analysis.dispose(); }
  assert.equal(analysis.getInfo().loaded, false);
});

test('replacement, cancellation and disposal reject stale loads', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createLEDAnalysis();
  const pending = analysis.load(buffer([tone(1000, 3)]));
  const replaced = assert.rejects(pending, error => error.name === 'AbortError');
  await analysis.load(buffer([new Float32Array(16)])); await replaced;
  const cancel = analysis.load(buffer([tone(1000, 2)]));
  const cancelled = assert.rejects(cancel, error => error.name === 'AbortError');
  analysis.cancelLoad(); await cancelled;
  assert.equal(analysis.getInfo().loaded, false);
  const final = analysis.load(buffer([tone(1000, 2)]));
  const disposed = assert.rejects(final, error => error.name === 'AbortError');
  analysis.dispose(); await disposed;
});

test('progressive load prepares only the first second, then reconstructs requested history deterministically', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createLEDAnalysis();
  try {
    const pcm = tone(440, 12, 0.5);
    const info = await analysis.load(buffer([pcm]));
    assert.equal(info.progressive, true);
    assert.equal(info.analyzedFrames, 60);
    assert.ok(info.analyzedFrames < info.frames / 10);
    assert.ok(info.calibrationFrames <= 48);
    assert.equal(info.fullyAnalyzed, false);
    assert.equal(analysis.isReady(0.5), true);
    assert.equal(analysis.isReady(8), false);
    assert.throws(() => analysis.getFrame(8), /ensureRange/);
    await analysis.ensureRange(2, 8.5);
    assert.equal(analysis.isReady(8), true);
    const expected = clone(analysis.getFrame(8));
    // Frames at an unrelated seek can arrive in any order without changing the
    // cached feature, event, or peak-preserving history values at this timestamp.
    await analysis.ensureRange(0, 2);
    analysis.prefetch(9);
    await analysis.ensureRange(6, 11.5);
    assert.deepEqual(clone(analysis.getFrame(8)), expected);
    assert.ok(expected.history.some(value => value > 0));
    assert.equal(analysis.getInfo().fullyAnalyzed, false);
  } finally { analysis.dispose(); }
});

test('pending progressive ranges are cancelled and a new track cannot inherit stale chunks', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createLEDAnalysis();
  try {
    await analysis.load(buffer([tone(1000, 12)]));
    const pending = analysis.ensureRange(4, 11);
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await analysis.load(buffer([new Float32Array(rate / 5)]));
    await rejected;
    assert.ok(analysis.getFrame(0.1).bands.every(value => value === 0));
    assert.equal(analysis.getInfo().fullyAnalyzed, true);
    assert.ok(analysis.getInfo().duration < 1);
  } finally { analysis.dispose(); }
});


test('canonical chunks exactly match sequential analysis when generated in reverse order', () => {
  const pcm = tone(500, 2.2, 0.5);
  for (let index = 0; index < pcm.length; index++) pcm[index] *= 0.5 + 0.5 * Math.sin(index / rate * 7) ** 2;
  const { timeline } = analyse([pcm]);
  const analyzer = createLEDChunkAnalyzer([pcm], rate);
  const reverseEvents = [];
  for (const index of [2, 1, 0]) {
    const job = analyzer.createChunk(index);
    while (!job.done) job.step(7);
    const { chunk } = job;
    assert.deepEqual(chunk.bands, timeline.bands.slice(chunk.first * 96, (chunk.first + chunk.count) * 96));
    assert.deepEqual(chunk.features, timeline.features.slice(chunk.first * 10, (chunk.first + chunk.count) * 10));
    reverseEvents.push(...chunk.events);
  }
  reverseEvents.sort((a, b) => a.time - b.time || a.band - b.band);
  assert.deepEqual(reverseEvents, timeline.events);
});

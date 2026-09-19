import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createPhaseTimelineBuilder, createPhaseFrameReader, FFT_SIZE, FFT_BINS } from '../js/phase/phase-analysis-core.js';
import { createPhaseAnalysis } from '../js/phase/phase-analysis.js';

const rate = 12000;
const tone = (frequency, seconds, amplitude = 0.5) => Float32Array.from({ length: rate * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
function analyse(channels) {
  const builder = createPhaseTimelineBuilder(channels, rate);
  while (!builder.done) builder.step(120);
  return { timeline: builder.timeline, at: createPhaseFrameReader(channels, builder.timeline) };
}
const copy = frame => ({ ...frame, features: { ...frame.features }, spectrum: frame.spectrum.slice(), waveform: frame.waveform.slice(), waveformLeft: frame.waveformLeft.slice(), waveformRight: frame.waveformRight.slice() });
const buffer = channels => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: rate, getChannelData: index => channels[index] });

test('maximum FFT resolution and true silence are preserved', () => {
  assert.equal(FFT_SIZE, 32768); assert.equal(FFT_BINS, 16384);
  const { timeline, at } = analyse([new Float32Array(rate * 2)]);
  assert.equal(timeline.sections.length, 1);
  const frame = at(1);
  assert.equal(frame.spectrum.length, 16384); assert.equal(frame.waveform.length, 2048);
  assert.ok(frame.spectrum.every(value => value === 0));
  assert.ok(frame.waveform.every(value => value === 0));
  assert.deepEqual(frame.features, { bass: 0, mids: 0, highs: 0, energy: 0, kick: 0, rms: 0 });
});

test('opposite stereo polarity cannot cancel spectrum, waveform, or loudness', () => {
  const pcm = tone(1200, 3);
  const mono = copy(analyse([pcm]).at(2.5));
  const stereo = copy(analyse([pcm, Float32Array.from(pcm, value => -value)]).at(2.5));
  assert.deepEqual(stereo.spectrum, mono.spectrum);
  assert.deepEqual(stereo.features, mono.features);
  assert.deepEqual(stereo.waveform, mono.waveform);
  const right = copy(analyse([new Float32Array(pcm.length), pcm]).at(2.5));
  assert.ok(Math.max(...right.spectrum) > 180);
  assert.ok(Math.max(...right.waveform) > 0.4);
  assert.ok(Math.abs(right.features.rms / mono.features.rms - Math.SQRT1_2) < 1e-5);
});

test('absolute frame reads are identical after arbitrary seeks', () => {
  const { at } = analyse([tone(180, 4)]);
  const first = copy(at(2.13));
  at(0); at(3.5); at(0.5);
  assert.deepEqual(copy(at(2.13)), first);
});

test('the final frequency ranges are retained and quiet passages remain quieter', () => {
  const high = analyse([tone(5800, 3)]).at(2.8);
  const expectedBin = Math.round(5800 * FFT_SIZE / rate);
  assert.ok(Math.abs(high.spectrum.indexOf(Math.max(...high.spectrum)) - expectedBin) < 2);
  const pcm = tone(200, 6);
  for (let i = 0; i < rate * 3; i++) pcm[i] *= 0.08;
  const { at } = analyse([pcm]);
  assert.ok(at(2).features.energy < at(5).features.energy * 0.2);
});

test('scope textures retain signed stereo PCM and expose a causal trigger-aligned window', () => {
  const left = tone(180, 4), right = Float32Array.from(left, value => -value);
  const { at } = analyse([left, right]);
  const frame = at(3.5);
  assert.equal(frame.waveformLeft.length, FFT_SIZE);
  assert.equal(frame.waveformRight.length, FFT_SIZE);
  assert.equal(frame.scopeSamples, Math.round(rate * 0.09));
  assert.ok(frame.scopeStart >= frame.scopeDelaySamples);
  assert.ok(frame.scopeStart + frame.scopeSamples <= FFT_SIZE);
  assert.ok(frame.scopeGain >= 0.7 && frame.scopeGain <= 8);
  const end = Math.round(frame.frame * rate / 60);
  assert.equal(frame.waveformLeft.at(-1), left[end - 1]);
  assert.equal(frame.waveformRight.at(-1), right[end - 1]);
  for (let i = 0; i < FFT_SIZE; i++) assert.equal(frame.waveformLeft[i] + frame.waveformRight[i], 0);
  assert.ok(frame.waveformLeft[frame.scopeStart - 1] <= 0 && frame.waveformLeft[frame.scopeStart] > 0);
  const expected = copy(frame);
  at(1.1); at(2.2);
  assert.deepEqual(copy(at(3.5)), expected);
});

test('sustained tones hold a phase while structural timbre changes trigger smooth morphs', () => {
  const steady = analyse([tone(120, 24)]);
  assert.equal(steady.timeline.sections.length, 1, 'a fixed timer must not change a constant tone');
  const pcm = new Float32Array(rate * 30);
  pcm.set(tone(100, 10), 0); pcm.set(tone(1200, 10), rate * 10); pcm.set(tone(4800, 10), rate * 20);
  const { timeline, at } = analyse([pcm]);
  assert.ok(timeline.sections.length >= 3, `found ${timeline.sections.length} sections`);
  for (const expected of [10, 20]) assert.ok(timeline.sections.some(section => Math.abs(section.time - expected) < 1), `missing boundary near ${expected}`);
  const transition = timeline.sections[1];
  const start = at(transition.time);
  assert.notEqual(start.shapeFrom, start.shapeTo);
  assert.equal(start.morph, 0);
  const middle = at(transition.time + 1.2);
  assert.ok(middle.morph > 0.2 && middle.morph < 0.8);
  assert.equal(at(transition.time + 3).morph, 1);
});

test('transients are causal and silence cannot fabricate a kick', () => {
  const pcm = new Float32Array(rate * 4);
  pcm.set(tone(80, 1), rate);
  const { at } = analyse([pcm]);
  assert.equal(at(0.99).features.kick, 0);
  assert.ok(at(1.04).features.energy > 0);
  assert.equal(at(3).features.kick, 0);
});

test('public load supports asynchronous progress and rejects reads after disposal', async () => {
  const pcm = tone(240, 0.4);
  const analysis = createPhaseAnalysis();
  const progress = [];
  await analysis.load({ numberOfChannels: 1, length: pcm.length, sampleRate: rate, getChannelData: () => pcm }, { onProgress: value => progress.push(value) });
  assert.equal(analysis.getFrame(0.3).spectrum.length, 16384);
  assert.equal(analysis.getInfo().fftSize, 32768);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  analysis.dispose();
  assert.throws(() => analysis.getFrame(0.1), /Load audio/);
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

test('worker retains source audio and rejects replaced or disposed loads', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createPhaseAnalysis();
  try {
    const pcm = tone(400, 3);
    const first = analysis.load(buffer([pcm]));
    const replaced = assert.rejects(first, error => error.name === 'AbortError');
    await analysis.load(buffer([new Float32Array(rate / 4)]));
    await replaced;
    assert.equal(pcm.byteLength, rate * 3 * 4);
    assert.ok(analysis.getFrame(0.1).spectrum.every(value => value === 0));
    const next = analysis.load(buffer([pcm]));
    const disposed = assert.rejects(next, error => error.name === 'AbortError');
    analysis.dispose(); await disposed;
    assert.equal(analysis.getInfo().loaded, false);
  } finally { analysis.dispose(); delete globalThis.Worker; }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createSignalAnalysis, createSignalFrame } from '../js/atlas/signal-atlas-analysis.js';
import { createSignalSummaryBuilder, createStereoSpectrum, fillSignalFrame } from '../js/atlas/signal-atlas-analysis-core.js';
import * as analysisCore from '../js/atlas/signal-atlas-analysis-core.js';

const rate = 48000;
const tone = (frequency, length = rate, amplitude = 0.8) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const buffer = (channels, sampleRate = rate) => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate,
  duration: channels[0].length / sampleRate, getChannelData: channel => channels[channel],
});
function summary(channels, sampleRate = rate, overviewBins = 16) {
  const builder = createSignalSummaryBuilder(channels, sampleRate, { overviewBins });
  while (!builder.done) builder.step(4096);
  return builder.summary;
}

test('shared frame indexing preserves exact clock ticks and the final partial interval', () => {
  const index = analysisCore.signalFrameIndex;
  assert.equal(typeof index, 'function');
  assert.equal(index(123 / 60, 3), 123, 'floating-point roundoff must not select frame 122');
  assert.equal(index(123 / 60 - 0.001, 3), 122);
  assert.equal(index(-1, 3), 0);
  assert.equal(index(0, 0), 0);
  assert.equal(index(5, 0), 0);
  assert.equal(index(1, 1), 60);
  assert.equal(index(2, 1), 60);
  assert.equal(index(0.005, 0.005), 1, 'a sub-frame clip has a nonzero endpoint frame');
  assert.equal(index(0.004, 0.005), 0);
  assert.equal(index(0.72, 0.72), 44);
  assert.equal(index(24800 / rate, 24800 / rate), 31, 'endpoint roundoff must not create an empty extra interval');
});

test('overview preserves short, silent, and right-only recordings across every channel', () => {
  const silent = summary([new Float32Array(4)], rate, 16);
  assert.deepEqual([...silent.peaks], new Array(16).fill(0));
  const rightOnly = summary([new Float32Array(4), Float32Array.of(0.25, 0.5, 1, 0.5)], rate, 8);
  assert.deepEqual([...rightOnly.peaks], [0.25, 0.25, 0.5, 0.5, 1, 1, 0.5, 0.5]);
  const thirdChannel = summary([new Float32Array(4), new Float32Array(4), Float32Array.of(0, 0.25, 0, 0)], rate, 4);
  assert.deepEqual([...thirdChannel.peaks], [0, 1, 0, 0]);
  for (const value of silent.levels) assert.equal(value, 0);
});

test('RMS overview reveals different energy when compressed bins have equal peaks', () => {
  const pcm = Float32Array.of(1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1);
  const mono = summary([pcm], rate, 4);
  assert.deepEqual([...mono.peaks], [1, 1, 1, 1], 'raw peaks remain unchanged');
  const expected = [0.5, Math.sqrt(0.5), Math.sqrt(0.75), 1];
  mono.rmsPeaks.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7));
  const silence = new Float32Array(pcm.length);
  const inverted = Float32Array.from(pcm, value => -value);
  const rightOnly = summary([silence, pcm], rate, 4);
  const antiphase = summary([pcm, inverted], rate, 4);
  const thirdChannel = summary([silence, silence, pcm], rate, 4);
  for (const result of [rightOnly, antiphase, thirdChannel]) {
    result.rmsPeaks.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-7));
  }
  assert.deepEqual([...summary([silence, silence], rate, 4).rmsPeaks], [0, 0, 0, 0]);
  assert.deepEqual([...summary([Float32Array.of(0.25, 0.5, 1, 0.5)], rate, 8).rmsPeaks],
    [0.25, 0.25, 0.5, 0.5, 1, 1, 0.5, 0.5]);
});

test('raw sampling uses real stereo, duplicates mono, and pads both boundaries', () => {
  const left = Float32Array.of(1, -1, 0.5, -0.5);
  const right = Float32Array.from(left, value => -value);
  const frame = createSignalFrame(4);
  assert.equal(fillSignalFrame([left, right], 4, 0.5, frame), frame);
  assert.deepEqual([...frame.left], [...left]);
  assert.deepEqual([...frame.right], [...right]);
  assert.equal(frame.correlation, -1);
  assert.equal(frame.lRms, Math.sqrt(0.625));
  assert.equal(frame.lPeak, 1);
  fillSignalFrame([left], 4, 0, frame);
  assert.deepEqual([...frame.left], [0, 0, 1, -1]);
  assert.deepEqual([...frame.left], [...frame.right]);
  assert.equal(frame.correlation, 1);
  fillSignalFrame([left, right], 4, 1.5, frame);
  assert.deepEqual([...frame.left], [0, 0, 0, 0]);
  assert.equal(frame.correlation, 0);
  fillSignalFrame([left, right], 4, 0.5, frame);
  assert.deepEqual([...frame.left], [...left]);
});

test('trailing PCM windows exclude future samples and expose stable absolute indexes', () => {
  const pcm = Float32Array.of(.1, .2, .3, .4, .5, .6);
  const frame = createSignalFrame(4);
  fillSignalFrame([pcm], 4, .5, frame, { trailing: true });
  assert.equal(frame.startSample, -2);
  assert.deepEqual([...frame.left], [0, 0, pcm[0], pcm[1]]);
  fillSignalFrame([pcm], 4, 1, frame, { trailing: true });
  assert.equal(frame.startSample, 0);
  assert.deepEqual(frame.left, pcm.subarray(0, 4));
  fillSignalFrame([pcm], 4, 0, frame, { trailing: true });
  assert.equal(frame.startSample, -4);
  assert.ok(frame.left.every(value => value === 0));
  fillSignalFrame([pcm], 4, 1, frame, { trailing: true });
  assert.equal(frame.startSample, 0);
  assert.deepEqual(frame.left, pcm.subarray(0, 4));
});

test('32768 FFT retains all bins, uses 16-bit dB precision and averages channel power', () => {
  const bin = 680;
  const pcm = tone(bin * rate / 32768);
  const analyse = createStereoSpectrum([pcm], rate);
  const mono = analyse(60);
  assert.ok(mono instanceof Uint16Array);
  assert.equal(mono.length, 16384);
  assert.equal(mono.indexOf(Math.max(...mono)), bin);
  const inverted = Float32Array.from(pcm, value => -value);
  const antiphase = createStereoSpectrum([pcm, inverted], rate)(60);
  assert.deepEqual(antiphase, mono, 'out-of-phase stereo must not cancel');
  const rightOnly = createStereoSpectrum([new Float32Array(pcm.length), pcm], rate)(60);
  const db = value => value / 65535 * 90 - 90;
  assert.ok(Math.abs(db(mono[bin]) - 20 * Math.log10(0.8)) < 0.01);
  assert.ok(Math.abs(db(rightOnly[bin]) - db(mono[bin]) + 3.0103) < 0.01);
  assert.ok(mono.some(value => value % 257 !== 0), 'precision must exceed 8-bit expansion');
  assert.ok(analyse(0).every(value => value === 0));
  assert.ok(analyse(-30).every(value => value === 0));
  analyse(13);
  assert.deepEqual(analyse(60), mono, 'seek order must not affect spectra');
});

test('stereo RTA uses calibrated 2048-point FFTs at the source sample rate', () => {
  assert.equal(analysisCore.RTA_FFT_SIZE, 2048);
  assert.equal(analysisCore.RTA_BINS, 1024);
  for (const sampleRate of [22050, 44100, 48000, 96000]) {
    const channel = (bin, amplitude) => Float32Array.from({ length: sampleRate }, (_, i) =>
      amplitude * Math.sin(2 * Math.PI * bin * i / 2048));
    const left = channel(43, 0.5), right = channel(219, 0.25);
    const analyse = analysisCore.createStereoRta([left, right, channel(100, 1)], sampleRate);
    const result = analyse(60);
    for (const [spectrum, bin, amplitude] of [[result.rtaLeft, 43, 0.5], [result.rtaRight, 219, 0.25]]) {
      assert.ok(spectrum instanceof Float32Array);
      assert.equal(spectrum.length, 1024);
      assert.ok(spectrum.every(Number.isFinite));
      assert.equal(spectrum.indexOf(Math.max(...spectrum)), bin);
      assert.ok(Math.abs(spectrum[bin] - 20 * Math.log10(amplitude)) < 0.01);
    }
    analyse(17);
    assert.deepEqual(analyse(60), result, 'RTA must be independent of request order');
  }
});

test('RTA duplicates mono, preserves stereo phase, and pads trailing windows without lookahead', () => {
  const pcm = tone(64 * rate / 2048);
  const mono = analysisCore.createStereoRta([pcm], rate)(60);
  assert.deepEqual(mono.rtaLeft, mono.rtaRight);
  const opposite = analysisCore.createStereoRta([pcm, Float32Array.from(pcm, value => -value)], rate)(60);
  assert.deepEqual(opposite, mono);
  const silent = new Float32Array(pcm.length);
  const rightOnly = analysisCore.createStereoRta([silent, pcm], rate)(60);
  assert.ok(rightOnly.rtaLeft.every(value => value === -120));
  assert.deepEqual(rightOnly.rtaRight, mono.rtaRight);
  const delayed = pcm.slice();
  delayed.fill(0, 0, rate / 2);
  const analyse = analysisCore.createStereoRta([delayed], rate);
  for (const frame of [-1, 0, 30, 64]) {
    assert.ok(analyse(frame).rtaLeft.every(value => value === -120));
  }
  assert.ok(analyse(31).rtaLeft.some(value => value > -120));
  const dc = analysisCore.createStereoRta([new Float32Array(rate).fill(0.5)], rate)(60);
  assert.ok(Math.abs(dc.rtaLeft[0] - 20 * Math.log10(0.5)) < 0.01, 'DC is not doubled');
});

test('smoothed RTA applies track-time attack and release independently of seek order', () => {
  const pcm = tone(64 * rate / 2048, rate * 7);
  pcm.fill(0, 0, rate / 2);
  pcm.fill(0, rate, rate * 2);
  pcm.fill(0, rate * 3, rate * 7);
  const smooth = analysisCore.createSmoothedStereoRta([pcm], rate);
  const raw = analysisCore.createStereoRta([pcm], rate);
  assert.ok(smooth(32).rtaLeft[64] < raw(32).rtaLeft[64], 'attack approaches the raw curve gradually');
  assert.ok(smooth(64).rtaLeft[64] > raw(64).rtaLeft[64] + 20, 'release retains a readable falling curve');
  assert.ok(smooth(70).rtaLeft[64] < smooth(64).rtaLeft[64]);
  const expected = smooth(150);
  assert.deepEqual(expected.rtaLeft, expected.rtaRight);
  smooth(370); smooth(10);
  assert.deepEqual(smooth(150), expected, 'evicted blocks reconstruct the same result');
  const transferable = smooth(150);
  structuredClone(transferable, { transfer: [transferable.rtaLeft.buffer, transferable.rtaRight.buffer] });
  assert.deepEqual(smooth(150), expected, 'worker transfers must not detach cached block data');
  assert.ok(smooth(0).rtaLeft.every(db => db === -120));
});

test('smoothed RTA block boundaries match a continuous follower within 0.05 dB', () => {
  const pcm = tone(64 * rate / 2048, rate * 6);
  pcm.fill(0, rate * 3);
  const raw = analysisCore.createStereoRta([pcm], rate);
  const smooth = analysisCore.createSmoothedStereoRta([pcm], rate);
  const values = new Float64Array(1024).fill(-120);
  const attack = 1 - Math.exp(-1 / (60 * .04));
  const release = 1 - Math.exp(-1 / (60 * .25));
  const checks = new Set([119, 120, 121, 239, 240, 241, 359, 360]);
  for (let frame = 0; frame <= 360; frame++) {
    const current = raw(frame).rtaLeft;
    for (let bin = 0; bin < values.length; bin++) {
      values[bin] += (current[bin] - values[bin]) * (current[bin] > values[bin] ? attack : release);
    }
    if (checks.has(frame)) {
      const result = smooth(frame).rtaLeft;
      const maximumError = Math.max(...result.map((db, bin) => Math.abs(db - values[bin])));
      assert.ok(maximumError < .05, `frame ${frame}: ${maximumError} dB boundary error`);
    }
  }
});

test('meter timeline uses 50 ms RMS, a release envelope and 750 ms peak hold', () => {
  const pcm = new Float32Array(rate * 2);
  pcm.fill(0.5, 0, rate / 2);
  const result = summary([pcm, new Float32Array(pcm.length)]);
  const at = seconds => result.levels.subarray(Math.floor(seconds * 60) * result.levelStride, (Math.floor(seconds * 60) + 1) * result.levelStride);
  assert.ok(Math.abs(at(0.4)[0] - 0.5) < 0.002);
  assert.equal(at(0.4)[1], 0);
  assert.ok(at(0.6)[0] > at(0.8)[0]);
  assert.ok(at(0.8)[0] > at(1)[0]);
  assert.equal(at(1.2)[2], 0.5);
  assert.equal(at(1.3)[2], 0);
  assert.ok(result.levels.every(Number.isFinite));
});

test('sample peaks cover each 60 Hz interval separately from RMS and held peaks', () => {
  for (const sampleRate of [44100, 48000]) {
    const left = new Float32Array(sampleRate + 7), right = new Float32Array(left.length);
    const boundary = Math.round(sampleRate / 60);
    left[boundary - 1] = -1.25;
    right[boundary] = 0.5;
    left[left.length - 1] = 0.75;
    const result = summary([left, right], sampleRate);
    assert.equal(result.levelStride, 9);
    const at = frame => result.levels.subarray(frame * result.levelStride, (frame + 1) * result.levelStride);
    assert.deepEqual([...at(0)], new Array(9).fill(0));
    assert.equal(at(1)[5], 1.25, 'clipped sample magnitude is retained');
    assert.equal(at(1)[6], 0, 'the next interval must not leak into this frame');
    assert.ok(at(1)[0] < at(1)[5], 'peak bars must not use RMS');
    assert.equal(at(2)[5], 0);
    assert.equal(at(2)[6], 0.5);
    assert.equal(at(2)[2], 1.25, 'hold survives after the current sample peak has fallen');
    assert.equal(at(45)[2], 1.25);
    assert.equal(at(46)[2], 0, 'hold expires after 45 frames');
    assert.equal(at(46)[3], 0.5);
    assert.equal(at(47)[3], 0);
    assert.equal(at(result.frames - 1)[5], 0.75, 'a partial final interval retains its final sample');
  }
});

test('display peaks retain 50 ms transients then release over 200 ms without altering measurements', () => {
  for (const sampleRate of [44100, 48000]) {
    const pcm = new Float32Array(sampleRate);
    pcm[0] = 1.25;
    const result = summary([pcm, new Float32Array(pcm.length)], sampleRate);
    const at = frame => result.levels.subarray(frame * result.levelStride, (frame + 1) * result.levelStride);
    assert.equal(at(1)[7], 1.25, 'attack is immediate, including clipping');
    assert.equal(at(2)[5], 0, 'sample-peak measurement remains per interval');
    assert.equal(at(3)[7], 1.25, 'sample at the start remains in the 50 ms window');
    const release = Math.exp(-1 / (60 * .2));
    assert.ok(Math.abs(at(4)[7] - 1.25 * release) < 1e-6);
    assert.ok(Math.abs(at(15)[7] - 1.25 / Math.E) < 1e-6);
    assert.equal(at(15)[2], 1.25, 'held reading remains independent of display decay');
    assert.equal(at(46)[2], 0);
    assert.ok(at(46)[7] > 0, 'display release does not extend the measured hold');
    assert.ok(Array.from({ length: result.frames }, (_, frame) => at(frame)[8]).every(value => value === 0));
  }
});

class BrowserWorker {
  constructor(url) {
    const source = `import { parentPort } from 'node:worker_threads';
      globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
      await import(${JSON.stringify(url.href)});
      parentPort.on('message', data => self.onmessage({ data }));`;
    this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
  terminate() { this.worker.terminate(); }
}

test('worker batches deterministic ranges, reports actual cache bytes, and preserves source PCM', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createSignalAnalysis({ cacheFrames: 3, prefetchFrames: 1 });
  try {
    const pcm = tone(1000);
    const input = buffer([pcm, Float32Array.from(pcm, value => -value)]);
    const progress = [];
    const info = await analysis.load(input, { onProgress: value => progress.push(value) });
    assert.equal(info.frequencyBinCount, 16384);
    assert.equal(info.fftSize, 32768);
    assert.equal(info.rtaFftSize, 2048);
    assert.equal(info.rtaFrequencyBinCount, 1024);
    assert.equal(info.workerRtaCacheBytes, 0);
    assert.equal(info.fps, 60);
    assert.equal(analysis.buffer, input);
    assert.ok(analysis.rmsPeaks instanceof Float32Array);
    assert.equal(analysis.rmsPeaks.length, 16384);
    assert.ok(analysis.rmsPeaks.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.equal(pcm.byteLength, rate * 4);
    assert.equal(progress.at(-1), 1);
    const frames = await analysis.getRange(58, 60);
    assert.deepEqual(frames.map(item => item.frame), [58, 59, 60]);
    assert.equal(analysis.getInfo().cacheBytes, 3 * (16384 * 2 + 1024 * 4 * 2));
    assert.equal(analysis.getInfo().workerRtaCacheBytes, 120 * 1024 * 4 * 2);
    const end = { ...frames[2], spectrum: frames[2].spectrum.slice(),
      rtaLeft: frames[2].rtaLeft.slice(), rtaRight: frames[2].rtaRight.slice() };
    assert.deepEqual(end.rtaLeft, end.rtaRight);
    assert.deepEqual(analysis.getCachedFrame(60), end);
    await analysis.getRange(20, 22);
    assert.equal(analysis.getCachedFrame(60), null);
    assert.deepEqual(await analysis.getFrame(60), end);
    assert.ok(analysis.getInfo().cachedFrames <= 3);
    assert.deepEqual((await analysis.getRange(-2, 0)).map(item => item.spectrum.every(value => value === 0)
      && item.rtaLeft.every(value => value === -120) && item.rtaRight.every(value => value === -120)), [true, true, true]);
    assert.throws(() => analysis.getRange(0, 1450), /1450/);
    assert.equal(analysis.sampleAt(0.8, createSignalFrame()).correlation, -1);
    const meter = analysis.getLevels(0.8);
    assert.ok(Math.abs(meter.lSamplePeak - 0.8) < 1e-6);
    assert.equal(meter.lSamplePeak, meter.rSamplePeak);
    assert.ok(meter.lDisplayPeak >= meter.lSamplePeak);
    assert.equal(meter.lDisplayPeak, meter.rDisplayPeak);
    const trailing = analysis.sampleAt(0, createSignalFrame(4), { trailing: true });
    assert.equal(trailing.startSample, -4);
    assert.ok(trailing.left.every(value => value === 0));
    analysis.getLevels(0.1);
    assert.deepEqual(analysis.getLevels(0.8), meter);
    const staleRange = analysis.getRange(30, 50);
    const staleRejected = assert.rejects(staleRange, error => error.name === 'AbortError');
    analysis.reset();
    await staleRejected;
    assert.equal(analysis.getInfo().loaded, true);
    assert.equal(analysis.getInfo().cacheBytes, 0);
    assert.deepEqual(await analysis.getFrame(60), end);
    await analysis.getFrame(120);
    assert.equal(analysis.getInfo().workerRtaCacheBytes, 2 * 120 * 1024 * 4 * 2);
    await analysis.getFrame(240);
    assert.equal(analysis.getInfo().workerRtaCacheBytes, 2 * 120 * 1024 * 4 * 2, 'worker blocks remain bounded after eviction');
    await analysis.load(buffer([new Float32Array(8)]));
    assert.equal(analysis.getInfo().workerRtaCacheBytes, 0, 'replacement releases previous worker blocks');
  } finally { analysis.dispose(); }
  assert.equal(analysis.getInfo().workerRtaCacheBytes, 0);
});

test('public peak levels include the partial final interval and clear when unloaded', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createSignalAnalysis({ cacheFrames: 1 });
  try {
    const pcm = new Float32Array(rate + 7);
    pcm[pcm.length - 1] = -1;
    await analysis.load(buffer([pcm]));
    assert.equal(analysis.getLevels(1).lSamplePeak, 0);
    const last = analysis.getLevels(analysis.duration);
    assert.equal(last.lSamplePeak, 1);
    assert.equal(last.rSamplePeak, 1);
    assert.equal(last.lPeak, 1);
    assert.equal(last.rPeak, 1);
    analysis.dispose();
    assert.ok(Object.values(analysis.getLevels(0)).every(value => value === 0));
    assert.equal(analysis.getLevels(0).lSamplePeak, 0);
    assert.equal(analysis.getLevels(0).rSamplePeak, 0);
    assert.equal(analysis.getInfo().cacheBytes, 0);
  } finally { analysis.dispose(); }
});

test('disabling unused motion analysis preserves spectra, meters and seek results', async () => {
  globalThis.Worker = BrowserWorker;
  const full = createSignalAnalysis({ cacheFrames: 2 });
  const atlas = createSignalAnalysis({ cacheFrames: 2, motionAnalysis: false });
  try {
    const left = tone(1000), right = tone(3000);
    left.fill(0, 0, rate / 2);
    right.fill(0, 0, rate / 2);
    const input = buffer([left, right]);
    await Promise.all([full.load(input), atlas.load(input)]);
    assert.equal(full.getInfo().motionFftSize, 4096, 'other visualisers retain motion analysis by default');
    assert.equal(atlas.getInfo().motionFftSize, 0);
    assert.deepEqual(atlas.peaks, full.peaks);
    assert.deepEqual(atlas.rmsPeaks, full.rmsPeaks);
    for (const index of [31, 60, 0, 31]) {
      const [expected, actual] = await Promise.all([full.getFrame(index), atlas.getFrame(index)]);
      assert.deepEqual(actual, { ...expected, motionFlux: 0 });
      assert.deepEqual(atlas.getLevels(index / 60), full.getLevels(index / 60));
      if (index === 31) assert.ok(expected.motionFlux > 0, 'fixture must exercise motion analysis');
    }
    atlas.reset();
    await atlas.load(input);
    assert.equal(atlas.getInfo().motionFftSize, 0, 'replacement retains the opt-out');
    assert.equal((await atlas.getFrame(31)).motionFlux, 0);
  } finally {
    full.dispose();
    atlas.dispose();
  }
});

test('history range results retain the complete current spectrum when FIFO inserts evict it', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createSignalAnalysis({ cacheFrames: 3 });
  try {
    await analysis.load(buffer([tone(1000), tone(3000)]));
    const previous = await analysis.getRange(10, 12);
    const expected = { ...previous[0], spectrum: previous[0].spectrum.slice(),
      rtaLeft: previous[0].rtaLeft.slice(), rtaRight: previous[0].rtaRight.slice() };
    // Frame 10 is resolved from the cache before worker results for 8 and 9
    // arrive. Inserting those earlier frames evicts 10 from the FIFO cache.
    const history = await analysis.getRange(8, 10);
    assert.equal(analysis.getCachedFrame(10), null);
    assert.deepEqual(history.at(-1), expected, 'renderers can retain the returned current frame');
    assert.notDeepEqual(history.at(-1).rtaLeft, history.at(-1).rtaRight);
    assert.equal(analysis.getInfo().cacheBytes, 3 * (16384 * 2 + 1024 * 4 * 2));
    assert.deepEqual(await analysis.getFrame(10), expected);
  } finally { analysis.dispose(); }
});

test('meter indexing matches exact frame ticks and short or exact track endpoints', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createSignalAnalysis({ cacheFrames: 1 });
  try {
    const pcm = new Float32Array(rate * 3);
    pcm[Math.round(123 * rate / 60) - 1] = 0.5;
    await analysis.load(buffer([pcm]));
    assert.equal(analysis.getLevels(123 / 60).lSamplePeak, 0.5);
    assert.equal(analysis.getLevels(122 / 60).lSamplePeak, 0);
    for (const length of [240, 24800, rate]) {
      const ended = new Float32Array(length).fill(0.125);
      ended[length - 1] = 0.75;
      await analysis.load(buffer([ended]));
      assert.equal(analysis.getLevels(analysis.duration).lSamplePeak, 0.75);
      const frame = analysisCore.signalFrameIndex(analysis.duration, analysis.duration);
      assert.equal(frame, analysis.getInfo().frameCount - 1);
      assert.ok((await analysis.getFrame(frame)).rtaLeft.some(db => db > -120));
    }
  } finally { analysis.dispose(); }
});

test('replacing a load and disposing reject stale worker requests', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createSignalAnalysis();
  const first = analysis.load(buffer([tone(1000)]));
  const firstRejected = assert.rejects(first, error => error.name === 'AbortError');
  await analysis.load(buffer([new Float32Array(8)]));
  await firstRejected;
  const pending = analysis.getRange(1, 20);
  const pendingRejected = assert.rejects(pending, error => error.name === 'AbortError');
  analysis.dispose();
  await pendingRejected;
  assert.equal(analysis.getInfo().loaded, false);
  assert.equal(analysis.buffer, null);
});

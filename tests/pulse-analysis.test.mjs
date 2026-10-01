import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createPulseFeatureBuilder, createPulseOverviewBuilder, readPulseFrame, PULSE_FFT_SIZE, PULSE_SMOOTHING, PULSE_DEFAULT_BANDS, validatePulseAnalysisOptions } from '../js/pulse/pulse-analysis-core.js';
import { createPulseAnalysis, createSignalFrame } from '../js/pulse/pulse-analysis.js';

const rate = 32000;
const tone = (frequency, length = rate, amplitude = .5) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const buffer = (channels, sampleRate = rate) => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate,
  duration: channels[0].length / sampleRate, getChannelData: channel => channels[channel],
});
function timeline(channels, step = 120, options = {}) {
  const builder = createPulseFeatureBuilder(channels, rate, options);
  while (!builder.done) builder.step(step);
  return builder.timeline;
}
function overview(channels, overviewBins) {
  const builder = createPulseOverviewBuilder(channels, rate, { overviewBins });
  while (!builder.done) builder.step(7);
  return builder.summary;
}


test('Cardiogram defaults and independent overlapping bands validate before analysis', () => {
  assert.deepEqual(PULSE_DEFAULT_BANDS, [{ min: 40, max: 120 }, { min: 180, max: 1200 }, { min: 6000, max: 14000 }]);
  assert.equal(PULSE_SMOOTHING, .2);
  const options = { bands: [{ min: 100, max: 1000 }, { min: 100, max: 1000 }, { min: 800, max: 2000 }], fftSize: 2048, smoothing: .4 };
  const valid = validatePulseAnalysisOptions(options, rate);
  assert.deepEqual(valid, options);
  valid.bands[0].min = 200;
  assert.equal(options.bands[0].min, 100, 'validation copies mutable band controls');
  const row = readPulseFrame(timeline([tone(900)], 120, options), 60);
  assert.equal(row.bands[0], row.bands[1]);
  assert.equal(row.fast[0], row.fast[1]);
  assert.ok(row.bands.every(value => value > .1), 'overlapping bands each receive the same tone');
  for (const bad of [{ fftSize: 512 }, { fftSize: 16384 }, { smoothing: NaN }, { smoothing: 1 }, { bands: [{ min: 20, max: 200 }] }]) {
    assert.throws(() => validatePulseAnalysisOptions(bad, rate));
  }
  for (const range of [{ min: 10, max: 200 }, { min: 200, max: 200 }, { min: 500, max: 200 }, { min: 20, max: Infinity }, { min: 20, max: 17000 }]) {
    assert.throws(() => validatePulseAnalysisOptions({ bands: [range, ...PULSE_DEFAULT_BANDS.slice(1)] }, rate));
  }
  const lowRate = validatePulseAnalysisOptions({}, 12000);
  assert.ok(lowRate.bands.every(band => band.min >= 20 && band.min < band.max && band.max <= 6000));
  assert.deepEqual(validatePulseAnalysisOptions({ bands: PULSE_DEFAULT_BANDS }, 12000), lowRate);
});

test('Cardiogram followers use its calibrated byte energy and survive random seeks', () => {
  // Exact FFT-bin sinusoid: Blackman coherent gain gives magnitude .21 × amplitude
  // before the analyser dB mapping. The three independent ranges share that bin.
  const options = { bands: Array.from({ length: 3 }, () => ({ min: 499, max: 501 })), fftSize: 1024, smoothing: 0 };
  const result = timeline([tone(500, rate, .001)], 9, options);
  const last = readPulseFrame(result, 60);
  const expectedByte = Math.floor(255 * (20 * Math.log10(.21 * (1023 / 1024) * .001) + 100) / 77);
  const expectedEnergy = (expectedByte / 255) ** 1.18;
  assert.ok(Math.abs(last.fast[0] - expectedEnergy) < 1e-6, 'fast follower converges to the Cardiogram bandEnergy');
  assert.ok(last.slow[0] > 0 && last.slow[0] < last.fast[0], 'slow follower still catches up');
  assert.deepEqual(last.fast, Array(3).fill(last.fast[0]));
  const first = readPulseFrame(result, 1);
  assert.ok(Math.abs(first.fast[0] / .55 - first.slow[0] / .055) < 1e-7, 'followers use the same energy with different coefficients');
  const smoothing = timeline([tone(500, rate, .001)], 9, { ...options, smoothing: .95 });
  assert.ok(readPulseFrame(smoothing, 1).fast[0] < first.fast[0], 'FFT magnitude smoothing softens the attack');
  assert.deepEqual(smoothing.data.filter((_, i) => i % 12 < 6), result.data.filter((_, i) => i % 12 < 6), 'FFT smoothing does not alter raw powers or flux');
  readPulseFrame(result, 3);
  assert.deepEqual(readPulseFrame(result, 60), last);
  last.fast[0] = 999;
  assert.notEqual(readPulseFrame(result, 60).fast[0], 999);
  assert.deepEqual(readPulseFrame(result, -1).fast, [0, 0, 0]);
  assert.deepEqual(readPulseFrame(result, result.frames).slow, [0, 0, 0]);
});

test('silence and track start stay zero; FFT features never see future samples', () => {
  const pcm = tone(1000, rate * 2);
  pcm.fill(0, 0, rate);
  const result = timeline([pcm]);
  assert.equal(PULSE_FFT_SIZE, 8192);
  assert.equal(result.frames, 121);
  for (let frame = -2; frame <= 60; frame++) {
    assert.deepEqual(readPulseFrame(result, frame).bands, [0, 0, 0]);
    assert.deepEqual(readPulseFrame(result, frame).flux, [0, 0, 0]);
  }
  assert.ok(readPulseFrame(result, 70).bands[1] > .1);
  assert.ok(result.data.every(value => Number.isFinite(value) && value >= 0));
});

test('channel power preserves inverted stereo, right-only and multichannel recordings', () => {
  const pcm = tone(1000), silent = new Float32Array(rate);
  const mono = timeline([pcm]);
  assert.deepEqual(timeline([pcm, pcm.map(value => -value)]).data, mono.data);
  const rightOnly = readPulseFrame(timeline([silent, pcm]), 60);
  const thirdOnly = readPulseFrame(timeline([silent, silent, pcm]), 60);
  const reference = readPulseFrame(mono, 60);
  assert.ok(Math.abs(rightOnly.bands[1] * 2 - reference.bands[1]) < 1e-7);
  assert.ok(Math.abs(thirdOnly.bands[1] * 3 - reference.bands[1]) < 1e-7);
});

test('three broad bands isolate tones and preserve raw power scaling', () => {
  for (const [frequency, band] of [[100, 0], [1000, 1], [8000, 2]]) {
    const full = readPulseFrame(timeline([tone(frequency)]), 60);
    const quiet = readPulseFrame(timeline([tone(frequency, rate, .25)]), 60);
    assert.equal(full.bands.indexOf(Math.max(...full.bands)), band);
    assert.ok(full.bands[band] > .1);
    assert.ok(full.bands.filter((_, index) => index !== band).every(value => value < 1e-8));
    assert.ok(Math.abs(full.bands[band] - quiet.bands[band] * 4) < 1e-7);
  }
});

test('chunk sizes and seek order cannot change absolute features or introduce a history-edge onset', () => {
  const pcm = tone(1000, rate * 3);
  const batch = timeline([pcm], 10000);
  const chunks = timeline([pcm], 7);
  assert.deepEqual(batch.data, chunks.data);
  const end = readPulseFrame(batch, 140);
  readPulseFrame(batch, 0);
  readPulseFrame(batch, 120);
  assert.deepEqual(readPulseFrame(batch, 140), end);
  assert.ok(end.flux[1] < 1e-6, 'steady tone has no fabricated onset when seeking into it');
  end.bands[1] = 999;
  assert.notEqual(readPulseFrame(batch, 140).bands[1], 999, 'rows do not expose mutable timeline storage');
  assert.equal(batch.data.byteLength, batch.frames * 12 * Float32Array.BYTES_PER_ELEMENT);
});

test('the final partial interval ends at the final sample and overview includes every sample', () => {
  const pcm = tone(1000, rate + 37);
  const result = timeline([pcm]);
  assert.equal(result.frames, 62);
  assert.equal(readPulseFrame(result, 61).time, pcm.length / rate);
  assert.ok(readPulseFrame(result, 61).bands[1] > .1);
  const impulse = new Float32Array(37);
  impulse[36] = .5;
  const end = timeline([impulse]);
  assert.ok(readPulseFrame(end, 1).bands.some(value => value > 0));
  const shape = overview([Float32Array.of(.25, .5, 1, .5)], 8);
  assert.deepEqual([...shape.peaks], [.25, .25, .5, .5, 1, 1, .5, .5]);
  assert.deepEqual([...shape.rmsPeaks], [...shape.peaks]);
  const varied = Float32Array.of(1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1);
  const shape2 = overview([varied, varied.map(value => -value)], 4);
  assert.deepEqual([...shape2.peaks], [1, 1, 1, 1]);
  [0.5, Math.sqrt(.5), Math.sqrt(.75), 1].forEach((expected, index) => assert.ok(Math.abs(shape2.rmsPeaks[index] - expected) < 1e-7));
  assert.deepEqual([...overview([impulse], 4).peaks], [0, 0, 0, 1]);
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

test('worker precomputes compact data, retains PCM and serves deterministic preview/seek/export rows', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createPulseAnalysis();
  try {
    const pcm = tone(1000, rate * 2);
    const input = buffer([pcm, pcm.map(value => -value)]);
    const progress = [];
    const info = await analysis.load(input, { onProgress: value => progress.push(value) });
    assert.equal(info.fps, 60);
    assert.equal(info.fftSize, 8192);
    assert.equal(info.frameCount, 121);
    assert.equal(info.featureBytes, 121 * 12 * 4);
    assert.equal(info.workerActive, false, 'worker PCM copies are released after precomputation');
    assert.equal(analysis.buffer, input);
    assert.equal(pcm.byteLength, rate * 2 * 4);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
    assert.equal(analysis.peaks.length, 16384);
    assert.equal(analysis.rmsPeaks.length, 16384);
    const forward = await analysis.getRange(70, 120);
    const tail = forward.at(-1);
    assert.deepEqual(analysis.getCachedFrame(120), tail);
    await analysis.getRange(0, 10);
    assert.deepEqual(await analysis.getFrame(120), tail);
    const staleRange = analysis.getRange(0, 120);
    const rejected = assert.rejects(staleRange, error => error.name === 'AbortError');
    analysis.reset();
    await rejected;
    assert.deepEqual(await analysis.getFrame(120), tail);
    assert.equal(analysis.sampleAt(1, createSignalFrame()).correlation, -1);
    assert.ok(analysis.sampleAt(0, createSignalFrame(16), { trailing: true }).left.every(value => value === 0));
    assert.equal(analysis.getLevels(1), null);
  } finally { analysis.dispose(); }
  assert.equal(analysis.getInfo().loaded, false);
  assert.equal(analysis.getInfo().featureBytes, 0);
  assert.equal(analysis.buffer, null);
});

test('replacement/disposal abort pending loads and stale worker errors cannot clear the replacement', async () => {
  const workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { this.request = message; }
    terminate() { this.terminated = true; }
  };
  const analysis = createPulseAnalysis();
  const input = buffer([tone(1000)]);
  const first = analysis.load(input);
  const firstRejected = assert.rejects(first, error => error.name === 'AbortError');
  const second = analysis.load(input);
  const secondRejected = assert.rejects(second, error => error.name === 'AbortError');
  workers[0].onerror({ message: 'late failure' });
  assert.equal(analysis.buffer, input);
  assert.equal(workers[1].terminated, undefined);
  analysis.dispose();
  await Promise.all([firstRejected, secondRejected]);
  assert.ok(workers.every(worker => worker.terminated));
  assert.equal(analysis.buffer, null);
  await assert.rejects(analysis.load(input), /disposed/);
  globalThis.Worker = BrowserWorker;
});


test('worker receives configured bands, FFT size and smoothing and rejects invalid config before replacing loaded audio', async () => {
  globalThis.Worker = BrowserWorker;
  const options = { bands: [{ min: 80, max: 1100 }, { min: 300, max: 700 }, { min: 80, max: 1100 }], fftSize: 2048, smoothing: .65 };
  const analysis = createPulseAnalysis(options);
  options.bands[0].max = 1200;
  try {
    const pcm = tone(500);
    const info = await analysis.load(buffer([pcm]));
    assert.equal(info.fftSize, 2048);
    assert.equal(info.smoothing, .65);
    assert.equal(info.bands[0].max, 1100, 'factory snapshots config');
    const expected = timeline([pcm], 11, { ...options, bands: [{ min: 80, max: 1100 }, ...options.bands.slice(1)] });
    assert.deepEqual(await analysis.getFrame(50), readPulseFrame(expected, 50));
    const infoBands = info.bands;
    infoBands[0].max = 99;
    assert.equal(analysis.getInfo().bands[0].max, 1100, 'getInfo does not expose analysis config storage');
    await assert.rejects(analysis.load(buffer([pcm], 1000)), /frequency|band|Nyquist/i);
    assert.equal(analysis.getInfo().loaded, true, 'invalid replacement leaves current analysis available');
  } finally { analysis.dispose(); }
});

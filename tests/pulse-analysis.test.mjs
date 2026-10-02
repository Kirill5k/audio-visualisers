import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { createPulseFeatureBuilder, createPulseOverviewBuilder, readPulseFrame, PULSE_FFT_SIZE, PULSE_SMOOTHING, PULSE_DEFAULT_BANDS, PULSE_FEATURE_STRIDE, validatePulseAnalysisOptions } from '../js/pulse/pulse-analysis-core.js';
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

test('adding timbre and activity metrics preserves all prior band features bit-for-bit', () => {
  const pcm = Float32Array.from({ length: rate }, (_, i) =>
    (.3 * Math.sin(2 * Math.PI * 100 * i / rate) + .2 * Math.sin(2 * Math.PI * 1000 * i / rate)
      + .1 * Math.sin(2 * Math.PI * 8000 * i / rate)) * (i < rate / 3 ? .5 : 1));
  const result = timeline([pcm], 7);
  const priorFeatures = result.data.filter((_, i) => i % PULSE_FEATURE_STRIDE < 12);
  assert.equal(createHash('sha256').update(new Uint8Array(priorFeatures.buffer)).digest('hex'),
    'af65dd907a923c4bbedd396fed6a2c56dc16f79796b2f9ccffc63934ad884ca8');
});

test('timbre measures full-spectrum power centroid and calibrated PCM RMS independently of band controls', () => {
  for (const frequency of [100, 1000, 4000, 8000]) {
    const pcm = tone(frequency);
    const row = readPulseFrame(timeline([pcm]), 60);
    assert.ok(Math.abs(row.brightness - frequency) < 1, `${frequency} Hz centroid: ${row.brightness}`);
    assert.ok(Math.abs(row.rmsDb - 20 * Math.log10(.5 / Math.sqrt(2))) < .12, 'sine RMS is amplitude / sqrt(2)');
    const custom = readPulseFrame(timeline([pcm], 11, { bands: Array.from({ length: 3 }, () => ({ min: 20, max: 40 })) }), 60);
    assert.equal(custom.brightness, row.brightness, 'centroid includes frequencies excluded by editable bands');
    assert.equal(custom.rmsDb, row.rmsDb);
    const half = readPulseFrame(timeline([tone(frequency, rate, .25)]), 60);
    assert.ok(Math.abs(row.rmsDb - half.rmsDb - 20 * Math.log10(2)) < 1e-5);
    assert.equal(half.brightness, row.brightness);
  }
  const a = tone(1000), b = tone(4000, rate, .25);
  const stereo = readPulseFrame(timeline([a, b]), 60);
  assert.ok(Math.abs(stereo.brightness - 1600) < 1, 'stereo powers average before the centroid');
  assert.ok(Math.abs(stereo.rmsDb - 10 * Math.log10((.5 ** 2 + .25 ** 2) / 4)) < .03);
});

test('silent and out-of-track timbre/activity rows have finite floors and no attacks', () => {
  const result = timeline([new Float32Array(rate)]);
  for (let frame = -1; frame <= result.frames; frame++) {
    const row = readPulseFrame(result, frame);
    assert.equal(row.brightness, 0);
    assert.equal(row.rmsDb, -96);
    assert.equal(row.onset, 0);
  }
});

test('activity detects isolated attacks with causal timestamps and at least 120 ms separation', () => {
  const starts = [.3, .8, 1.3, 1.8];
  const pcm = Float32Array.from({ length: rate * 3 }, (_, i) => {
    const time = i / rate;
    const start = starts.find(start => time >= start && time < start + .1);
    return start === undefined ? 0 : .5 * Math.sin(2 * Math.PI * 1000 * time) * Math.exp(-(time - start) * 30);
  });
  const result = timeline([pcm], 7);
  const events = Array.from({ length: result.frames }, (_, frame) => readPulseFrame(result, frame)).filter(row => row.onset > 0);
  assert.equal(events.length, starts.length, 'each separated strong burst produces one event');
  events.forEach((event, i) => {
    assert.ok(event.time >= starts[i] && event.time <= starts[i] + .16, 'events use only samples already heard');
    assert.ok(event.onset <= 1 && Number.isFinite(event.onset));
    if (i) assert.ok(event.time - events[i - 1].time >= .12);
  });
  const rapid = Float32Array.from({ length: rate * 2 }, (_, i) => {
    const time = i / rate, phase = time % .05;
    return phase < .02 ? .5 * Math.sin(2 * Math.PI * 2000 * time) : 0;
  });
  const rapidResult = timeline([rapid]);
  const rapidEvents = Array.from({ length: rapidResult.frames }, (_, frame) => readPulseFrame(rapidResult, frame)).filter(row => row.onset > 0);
  assert.ok(rapidEvents.length > 0);
  rapidEvents.slice(1).forEach((event, i) => assert.ok(event.time - rapidEvents[i].time >= .12));
  const quiet = timeline([pcm.map(value => value * .02)]);
  const quietEvents = Array.from({ length: quiet.frames }, (_, frame) => readPulseFrame(quiet, frame)).filter(row => row.onset > 0);
  assert.deepEqual(quietEvents.map(row => row.frame), events.map(row => row.frame), 'relative detector works on quiet audible attacks');
});

test('activity does not invent attacks on sustained tones or gradual gain changes', () => {
  const steady = timeline([tone(1000, rate * 3)]);
  for (let frame = 30; frame < steady.frames; frame++) assert.equal(readPulseFrame(steady, frame).onset, 0);
  const ramp = Float32Array.from({ length: rate * 3 }, (_, i) =>
    (.1 + .3 * i / (rate * 3)) * Math.sin(2 * Math.PI * 1000 * i / rate));
  const result = timeline([ramp]);
  for (let frame = 30; frame < result.frames; frame++) assert.equal(readPulseFrame(result, frame).onset, 0);
  const tail = readPulseFrame(result, 140);
  readPulseFrame(result, 0);
  assert.deepEqual(readPulseFrame(result, 140), tail, 'arbitrary seeks retain event decisions');
  assert.deepEqual(timeline([ramp], 1).data, result.data, 'chunk boundaries cannot affect detector history');
});

test('timbre and attack decisions never include samples after the requested frame', () => {
  const pcm = tone(1000, rate * 2);
  const changedFuture = pcm.slice();
  changedFuture.set(tone(8000, rate, .9), rate);
  const original = timeline([pcm]), changed = timeline([changedFuture]);
  for (let frame = 0; frame <= 60; frame++) assert.deepEqual(readPulseFrame(original, frame), readPulseFrame(changed, frame));
  assert.notEqual(readPulseFrame(original, 100).brightness, readPulseFrame(changed, 100).brightness);
});


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
  assert.deepEqual(smoothing.data.filter((_, i) => i % PULSE_FEATURE_STRIDE < 6), result.data.filter((_, i) => i % PULSE_FEATURE_STRIDE < 6), 'FFT smoothing does not alter raw powers or flux');
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
  assert.ok(result.data.every(value => Number.isFinite(value)));
  assert.ok(result.data.filter((_, i) => i % PULSE_FEATURE_STRIDE !== 13).every(value => value >= 0));
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
  assert.equal(batch.data.byteLength, batch.frames * PULSE_FEATURE_STRIDE * Float32Array.BYTES_PER_ELEMENT);
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
    assert.equal(info.featureBytes, 121 * PULSE_FEATURE_STRIDE * 4);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import {
  createPhosphorFeatureBuilder, readPhosphorFrame, PHOSPHOR_STRIDE, PHOSPHOR_FLOOR_DB, PHOSPHOR_BAND_FLOOR_DB,
} from '../js/phosphor/phosphor-analysis-core.js';
import { createPhosphorAnalysis, createSignalFrame } from '../js/phosphor/phosphor-analysis.js';

const rate = 44100;
const tone = (frequency, seconds = 1, amplitude = .5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const mix = (...signals) => Float32Array.from(signals[0], (_, i) => signals.reduce((sum, signal) => sum + signal[i], 0));
const buffer = channels => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate: rate,
  duration: channels[0].length / rate, getChannelData: channel => channels[channel],
});
function timeline(channels, step = 240) {
  const builder = createPhosphorFeatureBuilder(channels, rate);
  while (!builder.done) builder.step(step);
  return builder.timeline;
}
const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

/** Decaying 1 kHz/noise-free clicks at a fixed tempo. */
function clicks(bpm, seconds) {
  const pcm = new Float32Array(Math.round(rate * seconds)), period = 60 / bpm;
  for (let start = .25; start < seconds; start += period) {
    const first = Math.round(start * rate);
    for (let i = 0; i < rate * .08 && first + i < pcm.length; i++) {
      pcm[first + i] += .6 * Math.sin(2 * Math.PI * 1800 * i / rate) * Math.exp(-i / rate * 40);
    }
  }
  return pcm;
}

test('momentary loudness follows the BS.1770 calibration and sums channel powers', () => {
  const sine = tone(997, 1, 1);
  close(readPhosphorFrame(timeline([sine]), 50).loudness, -3.01, .05, 'full-scale 997 Hz in one channel');
  close(readPhosphorFrame(timeline([sine, sine]), 50).loudness, -.0, .05, 'the same sine in both channels');
  close(readPhosphorFrame(timeline([tone(997, 1, .1)]), 50).loudness, -23.01, .05, '−20 dBFS sine');
});

test('RMS, peak and crest use the trailing 100 ms of every channel', () => {
  const row = readPhosphorFrame(timeline([tone(1000)]), 40);
  close(row.rmsDb, 20 * Math.log10(.5 / Math.SQRT2), .02, 'sine RMS');
  close(row.peakDb, 20 * Math.log10(.5), .02, 'sine peak');
  const stereo = readPhosphorFrame(timeline([tone(1000), new Float32Array(rate)]), 40);
  close(stereo.rmsDb, row.rmsDb - 10 * Math.log10(2), .02, 'a silent channel halves the mean power');
  assert.equal(stereo.peakDb, row.peakDb);
});

test('centroid, correlation and side share describe the spectrum and stereo image', () => {
  for (const hz of [200, 1000, 5000]) close(readPhosphorFrame(timeline([tone(hz)]), 40).centroid, hz, hz * .02, `${hz} Hz centroid`);
  const pcm = tone(440);
  const mono = readPhosphorFrame(timeline([pcm, pcm]), 40);
  close(mono.correlation, 1, 1e-6, 'identical channels');
  close(mono.sideShare, 0, 1e-6, 'identical channels have no side');
  const inverted = readPhosphorFrame(timeline([pcm, pcm.map(value => -value)]), 40);
  close(inverted.correlation, -1, 1e-6, 'inverted channels');
  close(inverted.sideShare, 1, 1e-6, 'inverted channels are all side');
  const unrelated = readPhosphorFrame(timeline([tone(440), tone(587)]), 40);
  assert.ok(Math.abs(unrelated.correlation) < .1, 'unrelated tones are decorrelated');
});

test('band levels are relative to the track and pick the dominant band', () => {
  const midTone = tone(600, 2, .2);
  for (let i = rate; i < midTone.length; i++) midTone[i] *= .1;
  const result = timeline([mix(tone(80, 2, .4), midTone)]);
  const both = readPhosphorFrame(result, 40), row = readPhosphorFrame(result, 90);
  close(both.bands[1], 0, .5, 'the mid band at its loudest sits at its own reference');
  close(row.bands[1], -20, 1, 'the mid band 20 dB down');
  close(row.bands[0], 0, .5, 'a steady band sits at its own reference');
  assert.equal(row.bands[2], PHOSPHOR_BAND_FLOOR_DB, 'an empty band rests on the floor');
  assert.ok(result.bandReferences.slice(0, 2).every(Number.isFinite));
});

test('key detection finds the tonic and mode of a sustained triad', () => {
  const note = midi => 440 * 2 ** ((midi - 69) / 12);
  const cMajor = mix(...[60, 64, 67, 48].map(midi => tone(note(midi), 6, .15)));
  const aMinor = mix(...[57, 60, 64, 45].map(midi => tone(note(midi), 6, .15)));
  assert.equal(readPhosphorFrame(timeline([cMajor]), 300).key, 0, 'C major');
  assert.equal(readPhosphorFrame(timeline([aMinor]), 300).key, 12 + 9, 'A minor');
  assert.ok(readPhosphorFrame(timeline([cMajor]), 300).keyScore > .6);
});

test('key detection ignores broadband drums and does not depend on the sample rate', () => {
  const keyAt = sampleRate => {
    const length = sampleRate * 6, pcm = new Float32Array(length);
    let seed = 7;
    const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
    for (const midi of [62, 65, 69, 50]) {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      for (let i = 0; i < length; i++) pcm[i] += .08 * Math.sin(2 * Math.PI * hz * i / sampleRate);
    }
    for (let start = 0; start < length; start += sampleRate / 2) {
      for (let i = 0; i < sampleRate * .15 && start + i < length; i++) {
        const t = i / sampleRate;
        pcm[start + i] += .5 * Math.exp(-t * 25) * (Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-t * 30)) * t) + .4 * noise());
      }
    }
    const builder = createPhosphorFeatureBuilder([pcm], sampleRate);
    while (!builder.done) builder.step(2000);
    return readPhosphorFrame(builder.timeline, 300).key;
  };
  assert.equal(keyAt(44100), 12 + 2, 'D minor at 44.1 kHz');
  assert.equal(keyAt(48000), 12 + 2, 'D minor at 48 kHz');
});

test('onsets, attack rate and local tempo follow a click track', () => {
  const result = timeline([clicks(120, 12)]);
  const onsets = Array.from({ length: result.frames }, (_, f) => readPhosphorFrame(result, f)).filter(row => row.onset > 0);
  assert.ok(Math.abs(onsets.length - 24) <= 1, `one onset per click: ${onsets.length}`);
  close(result.bpm, 120, 1, 'track tempo');
  close(readPhosphorFrame(result, 600).attackRate, 2, .5, 'two attacks per second');
  close(readPhosphorFrame(result, 600).tempo, 120, 1, 'local tempo');
  assert.ok(Number.isNaN(readPhosphorFrame(result, 60).tempo), 'local tempo waits for four seconds of history');
});

test('level, loudness, stereo, spectral and key values never use future audio', () => {
  const pcm = mix(tone(220, 3, .3), clicks(100, 3));
  const changed = pcm.slice();
  changed.set(tone(5000, 1, .9), rate * 2);
  const a = timeline([pcm, pcm.map(value => value * .5)]), b = timeline([changed, changed.map(value => value * .5)]);
  const causal = ['loudness', 'rmsDb', 'peakDb', 'centroid', 'correlation', 'sideShare', 'key', 'keyScore'];
  for (let frame = 0; frame <= 119; frame++) {
    const before = readPhosphorFrame(a, frame), after = readPhosphorFrame(b, frame);
    for (const field of causal) assert.ok(Object.is(before[field], after[field]), `${field} at frame ${frame}`);
  }
  assert.notEqual(readPhosphorFrame(a, 150).centroid, readPhosphorFrame(b, 150).centroid);
});

test('chunk sizes cannot change the timeline, and rows are independent copies', () => {
  const pcm = mix(tone(330, 2), clicks(128, 2));
  const batch = timeline([pcm], 10000), small = timeline([pcm], 7);
  assert.deepEqual(batch.data, small.data);
  assert.equal(batch.data.byteLength, batch.frames * PHOSPHOR_STRIDE * 4);
  const row = readPhosphorFrame(batch, 60);
  row.bands[0] = 999;
  assert.notEqual(readPhosphorFrame(batch, 60).bands[0], 999);
});

test('silence and out-of-track frames read as floors and undefined values', () => {
  const result = timeline([new Float32Array(rate)]);
  for (const frame of [-1, 0, 30, result.frames]) {
    const row = readPhosphorFrame(result, frame);
    assert.equal(row.loudness, PHOSPHOR_FLOOR_DB);
    assert.equal(row.rmsDb, PHOSPHOR_FLOOR_DB);
    assert.equal(row.peakDb, PHOSPHOR_FLOOR_DB);
    assert.equal(row.key, -1);
    assert.equal(row.novelty, 0);
    assert.equal(row.attackRate, 0);
    for (const field of ['centroid', 'tempo', 'keyScore', 'correlation', 'sideShare']) assert.ok(Number.isNaN(row[field]), field);
    assert.deepEqual(row.bands, [PHOSPHOR_BAND_FLOOR_DB, PHOSPHOR_BAND_FLOOR_DB, PHOSPHOR_BAND_FLOOR_DB]);
  }
  assert.ok(Number.isNaN(result.bpm));
});

test('the final partial frame ends at the last sample', () => {
  const pcm = tone(1000, 1 + 37 / rate);
  const result = timeline([pcm]);
  assert.equal(result.frames, 62);
  assert.equal(readPhosphorFrame(result, 61).time, pcm.length / rate);
  assert.ok(readPhosphorFrame(result, 61).rmsDb > -10);
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

test('worker precomputes the timeline, keeps PCM on the main thread and serves stable rows', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createPhosphorAnalysis();
  try {
    const pcm = mix(tone(440, 2), clicks(120, 2));
    const input = buffer([pcm, pcm.map(value => -value)]);
    const progress = [];
    const info = await analysis.load(input, { onProgress: value => progress.push(value) });
    assert.equal(info.fps, 60);
    assert.equal(info.frameCount, 121);
    assert.equal(info.featureBytes, 121 * PHOSPHOR_STRIDE * 4);
    assert.equal(info.workerActive, false);
    assert.equal(analysis.buffer, input);
    assert.equal(analysis.channels[0], pcm);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]));
    assert.equal(analysis.peaks.length, 16384);
    const expected = timeline([pcm, pcm.map(value => -value)]);
    assert.deepEqual(await analysis.getFrame(90), readPhosphorFrame(expected, 90));
    const forward = await analysis.getRange(70, 120);
    assert.deepEqual(analysis.getCachedFrame(120), forward.at(-1));
    const stale = analysis.getRange(0, 120);
    const rejected = assert.rejects(stale, error => error.name === 'AbortError');
    analysis.reset();
    await rejected;
    assert.equal(analysis.sampleAt(1, createSignalFrame()).correlation, -1);
    assert.equal(analysis.getLevels(1), null);
  } finally { analysis.dispose(); }
  assert.equal(analysis.getInfo().loaded, false);
  assert.equal(analysis.buffer, null);
});

test('replacing or disposing aborts pending loads; stale worker errors cannot clear the replacement', async () => {
  const workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(message) { this.request = message; }
    terminate() { this.terminated = true; }
  };
  const analysis = createPhosphorAnalysis();
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
  await assert.rejects(analysis.load(input), /disposed/);
});

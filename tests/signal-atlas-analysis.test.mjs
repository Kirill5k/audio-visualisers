import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createSignalAnalysis, createSignalFrame } from '../js/atlas/signal-atlas-analysis.js';
import { createSignalSummaryBuilder, createStereoSpectrum, fillSignalFrame } from '../js/atlas/signal-atlas-analysis-core.js';

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
    assert.equal(info.fps, 60);
    assert.equal(analysis.buffer, input);
    assert.ok(analysis.rmsPeaks instanceof Float32Array);
    assert.equal(analysis.rmsPeaks.length, 16384);
    assert.ok(analysis.rmsPeaks.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.equal(pcm.byteLength, rate * 4);
    assert.equal(progress.at(-1), 1);
    const frames = await analysis.getRange(58, 60);
    assert.deepEqual(frames.map(item => item.frame), [58, 59, 60]);
    assert.equal(analysis.getInfo().cacheBytes, 3 * 16384 * 2);
    const end = frames[2].spectrum.slice();
    await analysis.getRange(20, 22);
    assert.equal(analysis.getCachedFrame(60), null);
    assert.deepEqual((await analysis.getFrame(60)).spectrum, end);
    assert.ok(analysis.getInfo().cachedFrames <= 3);
    assert.deepEqual((await analysis.getRange(-2, 0)).map(item => item.spectrum.every(value => value === 0)), [true, true, true]);
    assert.throws(() => analysis.getRange(0, 1450), /1450/);
    assert.equal(analysis.sampleAt(0.8, createSignalFrame()).correlation, -1);
    const meter = analysis.getLevels(0.8);
    analysis.getLevels(0.1);
    assert.deepEqual(analysis.getLevels(0.8), meter);
    const staleRange = analysis.getRange(30, 50);
    const staleRejected = assert.rejects(staleRange, error => error.name === 'AbortError');
    analysis.reset();
    await staleRejected;
    assert.equal(analysis.getInfo().loaded, true);
    assert.deepEqual((await analysis.getFrame(60)).spectrum, end);
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

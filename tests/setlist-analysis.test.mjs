import assert from 'node:assert/strict';
import test from 'node:test';
import { createSetlistAnalysis } from '../js/setlist/setlist-analysis.js';
import { OVERVIEW_BINS, signalFrameIndex } from '../js/atlas/signal-atlas-analysis-core.js';

const sampleRate = 32000;
const buffer = (channels, rate = sampleRate) => ({
  numberOfChannels: channels.length, length: channels[0].length, sampleRate: rate,
  duration: channels[0].length / rate, getChannelData: index => channels[index],
});
const isAbort = error => error.name === 'AbortError';

test('silence produces finite shared overviews without spectral or frame storage', async () => {
  const analysis = createSetlistAnalysis();
  try {
    const input = buffer([new Float32Array(sampleRate)]);
    const info = await analysis.load(input);
    assert.equal(analysis.buffer, input);
    assert.equal(analysis.duration, 1);
    assert.equal(analysis.sampleRate, sampleRate);
    assert.equal(info.fps, 60);
    assert.equal(info.frameCount, 61);
    assert.equal(info.fftSize, 0);
    assert.equal(info.frequencyBinCount, 0);
    assert.equal(info.featureBytes, 0);
    assert.equal(info.cacheBytes, 0);
    assert.equal(info.cachedFrames, 0);
    assert.equal(info.workerActive, false);
    assert.equal(info.loaded, true);
    assert.equal(info.overviewBytes, OVERVIEW_BINS * 4 * 2);
    assert.equal(analysis.peaks.length, OVERVIEW_BINS);
    assert.equal(analysis.rmsPeaks.length, OVERVIEW_BINS);
    assert.ok(analysis.peaks.every(value => value === 0));
    assert.ok(analysis.rmsPeaks.every(value => value === 0));
  } finally { analysis.dispose(); }
});

test('sub-bin clips expand real samples and include a partial final analysis frame', async () => {
  const analysis = createSetlistAnalysis();
  try {
    await analysis.load(buffer([Float32Array.of(.25, .5, 1, .5)]));
    for (let bin = 0; bin < OVERVIEW_BINS; bin++) {
      const expected = [.25, .5, 1, .5][Math.floor(bin * 4 / OVERVIEW_BINS)];
      assert.equal(analysis.peaks[bin], expected);
      assert.equal(analysis.rmsPeaks[bin], expected);
    }
    assert.equal(analysis.getInfo().frameCount, 2);
    const finalSample = new Float32Array(sampleRate + 37);
    finalSample[finalSample.length - 1] = -.75;
    await analysis.load(buffer([finalSample]));
    assert.equal(analysis.peaks.at(-1), 1);
    assert.equal(analysis.rmsPeaks.at(-1), 1);
    assert.equal(analysis.getInfo().frameCount, signalFrameIndex(analysis.duration, analysis.duration) + 1);
    assert.equal(analysis.getInfo().frameCount, 62);
  } finally { analysis.dispose(); }
});

test('every channel contributes without cancellation of opposite stereo phases', async () => {
  const analysis = createSetlistAnalysis();
  const pcm = Float32Array.from({ length: OVERVIEW_BINS }, (_, index) => (index % 7) / 7);
  try {
    await analysis.load(buffer([pcm]));
    const monoPeaks = analysis.peaks.slice(), monoRms = analysis.rmsPeaks.slice();
    await analysis.load(buffer([pcm, pcm.map(value => -value)]));
    assert.deepEqual(analysis.peaks, monoPeaks);
    assert.deepEqual(analysis.rmsPeaks, monoRms);
    await analysis.load(buffer([new Float32Array(pcm.length), new Float32Array(pcm.length), pcm]));
    assert.deepEqual(analysis.peaks, monoPeaks, 'third-channel-only recordings remain visible');
    analysis.rmsPeaks.forEach((value, index) => assert.ok(Math.abs(value - monoRms[index]) < 1e-7));
    await analysis.load(buffer([Float32Array.of(1, 1), Float32Array.of(0, 1)]));
    assert.equal(analysis.peaks[0], 1);
    assert.equal(analysis.peaks.at(-1), 1);
    assert.ok(Math.abs(analysis.rmsPeaks[0] - Math.SQRT1_2) < 1e-7, 'RMS averages channel power');
    assert.equal(analysis.rmsPeaks.at(-1), 1);
  } finally { analysis.dispose(); }
});

test('seek and export rows are deterministic frame indices with no PCM sampling', async () => {
  const analysis = createSetlistAnalysis();
  try {
    assert.equal(analysis.getCachedFrame(0), null);
    await assert.rejects(analysis.getFrame(0), /Load audio/);
    await analysis.load(buffer([new Float32Array(sampleRate * 2)]));
    assert.deepEqual(await analysis.getRange(118, 120), [{ frame: 118 }, { frame: 119 }, { frame: 120 }]);
    assert.deepEqual(await analysis.getFrame(120), { frame: 120 });
    await analysis.getRange(0, 10);
    assert.deepEqual(analysis.getCachedFrame(120), { frame: 120 });
    assert.deepEqual(analysis.getCachedFrame(2.9), { frame: 2 });
    assert.deepEqual(await analysis.getRange(-1, 1), [{ frame: -1 }, { frame: 0 }, { frame: 1 }]);
    const row = analysis.getCachedFrame(120);
    row.frame = 9;
    assert.deepEqual(analysis.getCachedFrame(120), { frame: 120 });
    const suppliedFrame = { left: Float32Array.of(.75), sentinel: true };
    assert.equal(analysis.sampleAt(1, suppliedFrame), suppliedFrame);
    assert.equal(suppliedFrame.left[0], .75);
    assert.equal(analysis.getLevels(1), null);
    await analysis.prefetch(120);
    assert.throws(() => analysis.getRange(4, 2), /last analysis frame/);
    assert.throws(() => analysis.getRange(NaN, 2), /finite/);
    assert.throws(() => analysis.getCachedFrame(Infinity), /finite/);
  } finally { analysis.dispose(); }
});

test('large loads report monotonic progress and yield between bounded chunks', async () => {
  const analysis = createSetlistAnalysis();
  try {
    const progress = [];
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    await analysis.load(buffer([new Float32Array(262144 * 3 + 1)]), {
      onProgress: value => progress.push({ value, yielded }),
    });
    clearTimeout(timer);
    assert.equal(progress[0].value, 0);
    assert.equal(progress.at(-1).value, 1);
    assert.ok(progress.some(({ value }) => value > 0 && value < 1));
    assert.ok(progress.every(({ value }, index) => index === 0 || value >= progress[index - 1].value));
    assert.ok(progress.at(-1).yielded, 'analysis permits the event loop to service UI work');
  } finally { analysis.dispose(); }
});

test('reset retains completed overview data but invalidates queued frame reads', async () => {
  const analysis = createSetlistAnalysis();
  try {
    await analysis.load(buffer([Float32Array.of(.25, .5)]));
    const peaks = analysis.peaks, input = analysis.buffer;
    const stale = analysis.getRange(0, 1);
    const rejected = assert.rejects(stale, isAbort);
    analysis.reset();
    await rejected;
    assert.equal(analysis.peaks, peaks);
    assert.equal(analysis.buffer, input);
    assert.equal(analysis.getInfo().loaded, true);
    assert.deepEqual(await analysis.getFrame(1), { frame: 1 });
    let reported = false;
    await analysis.getRange(0, 1, { onProgress: value => { reported = value === 1; } });
    assert.equal(reported, true);
  } finally { analysis.dispose(); }
});

test('replacement, reset, and disposal cancel pending loads without clearing a newer result', async () => {
  const analysis = createSetlistAnalysis();
  const long = buffer([new Float32Array(262144 * 3)]);
  const first = analysis.load(long);
  const firstRejected = assert.rejects(first, isAbort);
  const replacement = buffer([Float32Array.of(1)]);
  await analysis.load(replacement);
  await firstRejected;
  assert.equal(analysis.buffer, replacement);
  assert.equal(analysis.getInfo().loaded, true);
  const second = analysis.load(long);
  const secondRejected = assert.rejects(second, isAbort);
  analysis.reset();
  await secondRejected;
  assert.equal(analysis.buffer, null);
  const third = analysis.load(long);
  const thirdRejected = assert.rejects(third, isAbort);
  analysis.dispose();
  await thirdRejected;
  assert.equal(analysis.buffer, null);
  assert.equal(analysis.peaks, null);
  assert.equal(analysis.rmsPeaks, null);
  assert.equal(analysis.duration, 0);
  assert.equal(analysis.sampleRate, 0);
  assert.equal(analysis.getInfo().loaded, false);
  assert.equal(analysis.getInfo().overviewBytes, 0);
  assert.equal(analysis.getInfo().frameCount, 0);
  assert.equal(analysis.getCachedFrame(0), null);
  await assert.rejects(analysis.load(replacement), /disposed/);
});

test('invalid replacement audio preserves the completed summary', async () => {
  const analysis = createSetlistAnalysis();
  try {
    const input = buffer([Float32Array.of(1)]);
    await analysis.load(input);
    const peaks = analysis.peaks;
    for (const invalid of [null, {}, buffer([new Float32Array(0)]), buffer([Float32Array.of(1)], 0),
      buffer([Float32Array.of(1)], Infinity), buffer([Float32Array.of(1), Float32Array.of(1, 2)])]) {
      await assert.rejects(analysis.load(invalid));
      assert.equal(analysis.buffer, input);
      assert.equal(analysis.peaks, peaks);
    }
  } finally { analysis.dispose(); }
});

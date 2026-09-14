import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoomLightReader } from '../js/led-grid/led-loom-light.js';

const COLUMNS = 96, ROWS = 54, FPS = 60, STRIDE = 10;
const sourceTime = 1, sourceFrame = sourceTime * FPS, peakColumn = 40;
const encodedPeak = Math.round(.9 * 65535), peak = encodedPeak / 65535;
const sourceEnergy = Math.pow(peak - .11, 1.45);
const rowSeconds = 6 / ROWS;
const clamp = value => Math.max(0, Math.min(1, value));
function makeTimeline() {
  const duration = 8, frames = duration * FPS + 1;
  return { duration, frames, bands: new Uint16Array(frames * COLUMNS), features: new Float32Array(frames * STRIDE) };
}
function isolatedPeak() {
  const timeline = makeTimeline();
  timeline.bands[sourceFrame * COLUMNS + peakColumn] = encodedPeak;
  timeline.features[sourceFrame * STRIDE + 8] = .8;
  return { timeline, at: createLoomLightReader(timeline) };
}
function totals(values, column = peakColumn) {
  const sum = [0, 0, 0, 0];
  for (let row = 0; row < ROWS; row++) for (let component = 0; component < 4; component++) {
    sum[component] += values[(row * COLUMNS + column) * 4 + component];
  }
  return sum;
}
const maxDifference = (a, b) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
const sum = values => values.reduce((total, value) => total + value, 0);

test('Loom light: one-frame attacks illuminate immediately and never anticipate audio', () => {
  const { at } = isolatedPeak();
  assert.ok(at(sourceTime - 1e-6).every(value => value === 0));
  const arrival = at(sourceTime);
  assert.ok(Math.abs(sum(totals(arrival)) - sourceEnergy) < 1e-7);
  for (let row = 1; row < ROWS; row++) {
    assert.equal(sum(arrival.subarray((row * COLUMNS + peakColumn) * 4, (row * COLUMNS + peakColumn) * 4 + 4)), 0);
  }
});

test('Loom light: a peak keeps its energy and hue throughout every row transfer', () => {
  const { at } = isolatedPeak();
  const original = totals(at(sourceTime));
  // This checks the emitted coefficients, not squared spectrum amplitude or a
  // moving centroid. Nonlinear palette changes caused the previous 37% dip.
  for (let row = 0; row < ROWS - 1; row++) for (const phase of [0, .1, .25, .5, .75, .9, .999]) {
    const actual = totals(at(sourceTime + (row + phase) * rowSeconds));
    assert.ok(maxDifference(actual, original) < 8e-8, `Hue changed at row ${row}, phase ${phase}`);
    assert.ok(Math.abs(sum(actual) - sourceEnergy) < 1e-7, `Light dipped at row ${row}, phase ${phase}`);
  }
});

test('Loom light: arbitrary linear palettes produce no phase-related RGB flicker', () => {
  const { at } = isolatedPeak();
  const palettes = [
    [[.175, .061, 1], [.028, .105, 1], [1, .376, .047], [1, .88, .63]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1], [.05, .15, .1]],
  ];
  for (const palette of palettes) {
    const emitted = coefficients => [0, 1, 2].map(channel => coefficients.reduce((total, value, i) => total + value * palette[i][channel], 0));
    const expected = emitted(totals(at(sourceTime)));
    let previous = expected, beforePrevious = expected, maximumCurvature = 0;
    for (let sample = 0; sample < 53 * rowSeconds * 240; sample++) {
      const actual = emitted(totals(at(sourceTime + sample / 240)));
      assert.ok(maxDifference(actual, expected) < 1e-7, 'Palette changes cannot bring back the handover light dip');
      maximumCurvature = Math.max(maximumCurvature, ...actual.map((value, channel) => Math.abs(value - 2 * previous[channel] + beforePrevious[channel])));
      beforePrevious = previous; previous = actual;
    }
    assert.ok(maximumCurvature < 2e-7);
  }
});

test('Loom light: transfers are continuous across row boundaries and within analysis frames', () => {
  const { at } = isolatedPeak();
  for (let row = 1; row < ROWS; row++) {
    const time = sourceTime + row * rowSeconds;
    const before = at(time - 1e-6).slice(), after = at(time + 1e-6);
    assert.ok(maxDifference(before, after) < 1e-7, `Row ${row} jumps at its boundary`);
  }
  const time = sourceTime + rowSeconds * 4.35;
  const before = at(time).slice();
  assert.ok(maxDifference(before, at(time + .001)) > .001, 'Light must move between cached analysis times');
});

test('Loom light: onset color uses the source frequency group and cannot change with later features', () => {
  const timeline = makeTimeline();
  // Deliberately put columns in groups other than the fallback thirds.
  timeline.ranges = Array.from({ length: COLUMNS }, (_, column) => [
    { low: 5000, high: 6000 }, { low: 20, high: 100 }, { low: 500, high: 1000 },
  ][column % 3]);
  const onsets = [.1, .4, .9];
  timeline.features.set(onsets, sourceFrame * STRIDE + 7);
  const encoded = Math.round(.85 * 65535), value = encoded / 65535;
  for (const column of [0, 1, 2]) timeline.bands[sourceFrame * COLUMNS + column] = encoded;
  const at = createLoomLightReader(timeline), arrival = at(sourceTime).slice();
  for (const [column, group] of [[0, 2], [1, 0], [2, 1]]) {
    const energy = Math.pow(value - .11, 1.45);
    const expectedWhite = energy * .82 * clamp((value - .81) * 4 + onsets[group] * .45);
    assert.ok(Math.abs(arrival[column * 4 + 3] - expectedWhite) < 1e-7);
  }
  timeline.features.fill(1, (sourceFrame + 1) * STRIDE);
  for (const column of [0, 1, 2]) {
    assert.ok(maxDifference(totals(at(sourceTime + 2.417), column), totals(arrival, column)) < 1e-7);
  }
});

test('Loom light: silence and subthreshold spectra stay dark despite onset features', () => {
  const timeline = makeTimeline();
  timeline.features.fill(1);
  const at = createLoomLightReader(timeline);
  assert.ok(at(7).every(value => value === 0));
  timeline.bands.fill(Math.floor(.06 * 65535));
  assert.ok(at(7).every(value => value === 0));
  timeline.bands.fill(Math.round(.7 * 65535));
  assert.ok(sum(at(7)) > 1);
});

test('Loom light: every frequency column is isolated and retained without single-bin sampling', () => {
  const timeline = makeTimeline();
  for (const column of [0, 47, 95]) timeline.bands[sourceFrame * COLUMNS + column] = encodedPeak;
  const at = createLoomLightReader(timeline);
  for (const phase of [0, .5, 22.15, 52.97, 53.5]) {
    const values = at(sourceTime + phase * rowSeconds);
    for (let column = 0; column < COLUMNS; column++) {
      if ([0, 47, 95].includes(column)) assert.ok(sum(totals(values, column)) > 0);
      else assert.equal(sum(totals(values, column)), 0);
    }
  }
});

test('Loom light: final-row light fades to exact darkness within six seconds', () => {
  const { at } = isolatedPeak();
  const start = sum(at(sourceTime + 53 * rowSeconds));
  const middle = sum(at(sourceTime + 53.5 * rowSeconds));
  const ending = sum(at(sourceTime + 6 - 1e-6));
  assert.ok(Math.abs(start - sourceEnergy) < 1e-7);
  assert.ok(Math.abs(middle - sourceEnergy * .5) < 1e-7);
  assert.ok(ending < 1e-8);
  assert.equal(sum(at(sourceTime + 6)), 0);
  assert.equal(sum(at(sourceTime + 6.1)), 0);
});

test('Loom light: unavailable older and future cache regions are never read', () => {
  const timeline = makeTimeline(), time = 7.413;
  const first = Math.ceil((time - 6) * FPS), last = Math.floor(time * FPS);
  const protect = (values, stride) => new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        const frame = Math.floor(Number(key) / stride);
        assert.ok(frame >= first && frame <= last, `Out-of-window source read at frame ${frame}`);
      }
      return Reflect.get(target, key, target);
    },
  });
  timeline.bands = protect(timeline.bands, COLUMNS);
  timeline.features = protect(timeline.features, STRIDE);
  assert.equal(sum(createLoomLightReader(timeline)(time)), 0);
});

test('Loom light: changing overlapping color winners cannot make discontinuous jumps', () => {
  const timeline = makeTimeline();
  const leftFrame = sourceFrame, rightFrame = sourceFrame + 5;
  timeline.bands[leftFrame * COLUMNS + peakColumn] = Math.round(.63 * 65535);
  timeline.bands[rightFrame * COLUMNS + peakColumn] = Math.round(.94 * 65535);
  timeline.features[rightFrame * STRIDE + 8] = .9;
  const at = createLoomLightReader(timeline);
  const begin = sourceTime + .3;
  let maximumJump = 0;
  for (let index = 0; index < 1000; index++) {
    const time = begin + index / 1000;
    const before = at(time - 1e-6).slice();
    maximumJump = Math.max(maximumJump, maxDifference(before, at(time + 1e-6)));
  }
  assert.ok(maximumJump < .00003, `Mixed-source light jumped by ${maximumJump}`);
});

test('Loom light: arbitrary seeks reproduce the same output without accumulating render state', () => {
  const timeline = makeTimeline();
  for (let frame = 1; frame < timeline.frames; frame += 7) {
    timeline.bands[frame * COLUMNS + frame % COLUMNS] = 15000 + (frame * 197) % 50000;
    timeline.features[frame * STRIDE + 7 + frame % 3] = (frame % 11) / 10;
  }
  const at = createLoomLightReader(timeline);
  const times = [0, .011, 1.2394, 2.0911, 6.384, 7.999];
  const expected = new Map(times.map(time => [time, at(time).slice()]));
  for (const time of [8, 0, 4.317, .002, 6.972, ...times.toReversed(), ...times]) {
    const actual = at(time);
    if (expected.has(time)) assert.deepEqual(actual, expected.get(time));
  }
  assert.equal(at(0), at(1), 'The output allocation is intentionally reused');
  assert.deepEqual(at(-1).slice(), at(0));
  assert.deepEqual(at(100).slice(), at(timeline.duration));
  assert.throws(() => at(NaN), /finite/);
  assert.throws(() => at(Infinity), /finite/);
});

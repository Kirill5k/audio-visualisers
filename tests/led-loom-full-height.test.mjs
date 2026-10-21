import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLEDPattern, getLEDRowCount, LED_COLUMNS, LED_ROWS, LED_COUNT, LED_FULL_HEIGHT_ROWS } from '../js/led-grid/led-patterns.js';
import { createLoomLightReader } from '../js/led-grid/led-loom-light.js';

const settings = { mode: 'loom', loomFullHeight: true, gain: 1, persistence: 1 };
const count = LED_COLUMNS * 69;
const intensity = (values, row, column) => values[(row * LED_COLUMNS + column) * 4];
const maxDifference = (a, b) => a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
function lightFrame() {
  const loomLight = new Float32Array(LED_COUNT * 4);
  for (let index = 0; index < LED_COUNT; index++) loomLight.set([.2, .1, .05, .02], index * 4);
  return { loomLight };
}
function emittedTotals(values, horizontal = false) {
  const totals = [0, 0, 0, 0];
  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    const age = horizontal ? (index % LED_COLUMNS) / (LED_COLUMNS - 1) : Math.floor(index / LED_COLUMNS) / (LED_FULL_HEIGHT_ROWS - 1);
    const energy = values[offset] / (2.5 * Math.exp(-age / 3.25));
    const white = energy * values[offset + 3] * .82;
    const coloured = energy - white, amber = coloured * values[offset + 2];
    const cool = coloured - amber, blue = cool * values[offset + 1];
    totals[0] += cool - blue; totals[1] += blue; totals[2] += amber; totals[3] += white;
  }
  return totals;
}

test('Full-height Loom adds 15 active rows and includes them in coverage statistics', () => {
  assert.equal(LED_FULL_HEIGHT_ROWS, 69);
  assert.equal(getLEDRowCount({ mode: 'loom' }), LED_ROWS);
  assert.equal(getLEDRowCount(settings), 69);
  for (const loomHorizontal of [false, true]) {
    const result = evaluateLEDPattern(lightFrame(), { ...settings, loomHorizontal });
    assert.equal(result.values.length, count * 4);
    assert.equal(result.litCoverage, 1);
    for (let row = 0; row < 69; row++) assert.ok(intensity(result.values, row, 40) > 0);
    assert.ok(result.values.every(Number.isFinite));
  }
});

test('Full-height Loom keeps silence dark and turning it off restores exact default output', () => {
  for (const loomHorizontal of [false, true]) {
    const options = { ...settings, loomHorizontal };
    const data = lightFrame();
    const baseline = evaluateLEDPattern(data, { mode: 'loom', loomHorizontal, gain: 1, persistence: 1 });
    const storage = new Float32Array(count * 4);
    evaluateLEDPattern(data, options, storage);
    const restored = evaluateLEDPattern(data, { ...options, loomFullHeight: false }, storage);
    assert.equal(restored.values, storage);
    assert.deepEqual(storage.subarray(0, LED_COUNT * 4), baseline.values);
    assert.ok(storage.subarray(LED_COUNT * 4).every(value => value === 0));
    assert.equal(restored.meanIntensity, baseline.meanIntensity);
    assert.equal(restored.centroidRow, baseline.centroidRow);
    const silent = evaluateLEDPattern({}, options, storage);
    assert.equal(silent.maxIntensity, 0);
    assert.equal(silent.litCoverage, 0);
    for (let index = 0; index < count; index++) assert.equal(storage[index * 4], 0);
  }
});

test('Full-height Loom preserves the newest and oldest history and every horizontal frequency band', () => {
  for (const useLight of [false, true]) {
    const history = new Float32Array(LED_COUNT), loomLight = new Float32Array(LED_COUNT * 4);
    for (const sourceRow of [0, LED_ROWS - 1]) {
      history.fill(0); loomLight.fill(0);
      history[sourceRow * LED_COLUMNS + 40] = 1;
      loomLight[(sourceRow * LED_COLUMNS + 40) * 4] = .5;
      const values = evaluateLEDPattern(useLight ? { loomLight } : { history }, settings).values;
      assert.ok(intensity(values, sourceRow === 0 ? 0 : 68, 40) > 0);
      assert.equal(intensity(values, sourceRow === 0 ? 68 : 0, 40), 0);
    }
    for (let band = 0; band < LED_COLUMNS; band++) {
      history.fill(0); loomLight.fill(0);
      history[18 * LED_COLUMNS + band] = 1;
      loomLight[(18 * LED_COLUMNS + band) * 4] = .5;
      const values = evaluateLEDPattern(useLight ? { loomLight } : { history }, { ...settings, loomHorizontal: true }).values;
      const litRows = new Set();
      for (let row = 0; row < 69; row++) for (let column = 0; column < LED_COLUMNS; column++) {
        if (intensity(values, row, column) > 0) litRows.add(row);
      }
      assert.deepEqual([...litRows], [Math.ceil((band + 1) * 69 / LED_COLUMNS) - 1], `Lost or duplicated band ${band}`);
    }
  }
});

test('Full-height Loom resampling conserves travelling light and hue without changing source data', () => {
  const duration = 8, frames = duration * 60 + 1;
  const timeline = { duration, frames, bands: new Uint16Array(frames * LED_COLUMNS), features: new Float32Array(frames * 10) };
  timeline.bands[60 * LED_COLUMNS + 40] = Math.round(.9 * 65535);
  timeline.features[60 * 10 + 8] = .8;
  const read = createLoomLightReader(timeline);
  const initial = read(1).slice(), coefficients = [0, 0, 0, 0];
  initial.forEach((value, index) => { coefficients[index % 4] += value; });
  for (const loomHorizontal of [false, true]) {
    const options = { ...settings, loomHorizontal };
    const expected = coefficients.map(value => value * (loomHorizontal ? LED_COLUMNS : 69) / LED_ROWS);
    for (let sample = 0; sample <= 60; sample++) {
      const loomLight = read(2 + sample / 20).slice(), original = loomLight.slice();
      const values = evaluateLEDPattern({ loomLight }, options).values;
      assert.ok(maxDifference(emittedTotals(values, loomHorizontal), expected) < 3e-7, `Light or hue changed at sample ${sample}`);
      assert.deepEqual(loomLight, original);
    }
    const boundary = 1 + 20 * 6 / LED_ROWS;
    const before = evaluateLEDPattern({ loomLight: read(boundary - 1e-6) }, options).values;
    const after = evaluateLEDPattern({ loomLight: read(boundary + 1e-6) }, options).values;
    for (let index = 0; index < count; index++) assert.ok(Math.abs(before[index * 4] - after[index * 4]) < .0001);
    const fixed = evaluateLEDPattern({ loomLight: read(3.417) }, options).values;
    for (const time of [8, 0, 6, 1]) evaluateLEDPattern({ loomLight: read(time) }, options);
    assert.deepEqual(evaluateLEDPattern({ loomLight: read(3.417) }, options).values, fixed);
    assert.equal(evaluateLEDPattern({ loomLight: read(7) }, options).maxIntensity, 0);
  }
});

test('Full-height checkbox leaves other modes at 54 rows and clears any extra-row state', () => {
  const features = { bass: .7, mids: .6, highs: .5, energy: .6, width: .4, balance: .1, onsets: new Float32Array([.5, .3, .2]) };
  const bands = new Float32Array(LED_COLUMNS).fill(.65);
  const data = { time: 4, features, bands, events: [{ time: 3.8, band: 0, strength: .6 }],
    waveform: { frames: [{ time: 4, age: 0,
      left: Float32Array.from({ length: 193 }, (_, index) => .5 * Math.sin(index * .1)),
      right: Float32Array.from({ length: 193 }, (_, index) => .5 * Math.sin(index * .1 + .6)),
      rmsLeft: .35, rmsRight: .35, peakLeft: .5, peakRight: .5,
    }] }, flowFrames: [{ time: 3.8, bands, features }] };
  for (const mode of ['calligraphy', 'choreography']) {
    const original = evaluateLEDPattern(data, { ...settings, mode, loomFullHeight: false });
    assert.ok(original.maxIntensity > 0);
    assert.equal(getLEDRowCount({ ...settings, mode }), LED_ROWS);
    assert.deepEqual(evaluateLEDPattern(data, { ...settings, mode }).values, original.values);
    const storage = new Float32Array(count * 4).fill(5);
    const result = evaluateLEDPattern(data, { ...settings, mode }, storage);
    assert.deepEqual(result.values.subarray(0, LED_COUNT * 4), original.values);
    assert.ok(result.values.subarray(LED_COUNT * 4).every(value => value === 0));
    assert.equal(result.meanIntensity, original.meanIntensity);
  }
});

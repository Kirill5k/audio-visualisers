import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLEDPattern, LED_COLUMNS, LED_ROWS, LED_COUNT } from '../js/led-grid/led-patterns.js';
import { createLoomLightReader } from '../js/led-grid/led-loom-light.js';

const settings = { mode: 'loom', loomHorizontal: true, gain: 1, persistence: 1 };
const FPS = 60, STRIDE = 10, sourceTime = 1, sourceBand = 40;
const sourceRowSeconds = 6 / LED_ROWS;
const sum = values => values.reduce((total, value) => total + value, 0);
const maxDifference = (a, b) => a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
const evaluate = data => evaluateLEDPattern(data, settings).values;
const intensity = (values, row, column) => values[(row * LED_COLUMNS + column) * 4];
function makeTimeline() {
  const duration = 8, frames = duration * FPS + 1;
  return { duration, frames, bands: new Uint16Array(frames * LED_COLUMNS), features: new Float32Array(frames * STRIDE) };
}
function isolatedPeak() {
  const timeline = makeTimeline();
  timeline.bands[sourceTime * FPS * LED_COLUMNS + sourceBand] = Math.round(.9 * 65535);
  timeline.features[sourceTime * FPS * STRIDE + 8] = .8;
  const read = createLoomLightReader(timeline);
  return { read, at: time => evaluate({ time, loomLight: read(time) }) };
}
function centroidColumn(values) {
  let total = 0, moment = 0;
  for (let index = 0; index < LED_COUNT; index++) {
    total += values[index * 4];
    moment += values[index * 4] * (index % LED_COLUMNS);
  }
  return total > 0 ? moment / total : null;
}
// Undo the display's palette reconstruction and age attenuation. This checks
// conserved emitted light, including hue, without mistaking unused color ratios
// at black pixels for visible discontinuities.
function coefficients(values) {
  const output = new Float64Array(values.length);
  for (let index = 0; index < LED_COUNT; index++) {
    const offset = index * 4, age = (index % LED_COLUMNS) / (LED_COLUMNS - 1);
    const light = values[offset] / (2.5 * settings.gain * Math.exp(-age / (3.25 * settings.persistence)));
    const white = light * values[offset + 3] * .82;
    const colored = light - white, amber = colored * values[offset + 2];
    const cool = colored - amber, blue = cool * values[offset + 1];
    output[offset] = cool - blue;
    output[offset + 1] = blue;
    output[offset + 2] = amber;
    output[offset + 3] = white;
  }
  return output;
}
function componentTotals(values) {
  const totals = [0, 0, 0, 0];
  for (let index = 0; index < values.length; index++) totals[index % 4] += values[index];
  return totals;
}

test('Horizontal Loom: the default remains vertical and toggling is reversible', () => {
  const history = new Float32Array(LED_COUNT), loomLight = new Float32Array(LED_COUNT * 4);
  history[17 * LED_COLUMNS + 83] = .8;
  loomLight[(17 * LED_COLUMNS + 83) * 4 + 2] = .4;
  for (const data of [{ history }, { loomLight }]) {
    const original = evaluateLEDPattern(data, { mode: 'loom' }).values.slice();
    const storage = new Float32Array(LED_COUNT * 4);
    assert.ok(intensity(original, 17, 83) > 0);
    assert.equal(Array.from(original).filter((value, index) => index % 4 === 0 && value > 0).length, 1);
    assert.deepEqual(evaluateLEDPattern(data, { mode: 'loom', loomHorizontal: false }, storage).values, original);
    evaluateLEDPattern(data, settings, storage);
    assert.notDeepEqual(storage, original);
    assert.deepEqual(evaluateLEDPattern(data, { mode: 'loom' }, storage).values, original);
  }
});

test('Horizontal Loom: all 96 frequency bands survive on the fixed 54 physical rows', () => {
  assert.equal(LED_COLUMNS, 96);
  assert.equal(LED_ROWS, 54);
  assert.equal(LED_COUNT, 5184);
  for (const useLight of [false, true]) {
    const history = new Float32Array(LED_COUNT), loomLight = new Float32Array(LED_COUNT * 4);
    for (let band = 0; band < LED_COLUMNS; band++) {
      history.fill(0); loomLight.fill(0);
      history[18 * LED_COLUMNS + band] = 1;
      loomLight[(18 * LED_COLUMNS + band) * 4] = .5;
      const values = evaluate(useLight ? { loomLight } : { history });
      assert.equal(values.length, LED_COUNT * 4);
      const litRows = new Set();
      for (let row = 0; row < LED_ROWS; row++) for (let column = 0; column < LED_COLUMNS; column++) {
        if (intensity(values, row, column) > 0) litRows.add(row);
      }
      const expectedRow = Math.ceil((band + 1) * LED_ROWS / LED_COLUMNS) - 1;
      assert.deepEqual([...litRows], [expectedRow], `Band ${band} was lost or moved to the wrong frequency row (${useLight ? 'light' : 'history'})`);
    }
  }
});

test('Horizontal Loom: low frequencies start at the bottom left and oldest highs reach the top right', () => {
  for (const useLight of [false, true]) {
    const history = new Float32Array(LED_COUNT), loomLight = new Float32Array(LED_COUNT * 4);
    history[0] = 1;
    loomLight[0] = .5;
    const newest = evaluate(useLight ? { loomLight } : { history });
    assert.ok(intensity(newest, 0, 0) > 0);
    assert.equal(intensity(newest, 0, LED_COLUMNS - 1), 0);
    history.fill(0); loomLight.fill(0);
    history[LED_COUNT - 1] = 1;
    loomLight[(LED_COUNT - 1) * 4] = .5;
    const oldest = evaluate(useLight ? { loomLight } : { history });
    assert.ok(intensity(oldest, LED_ROWS - 1, LED_COLUMNS - 1) > 0);
    assert.equal(intensity(oldest, LED_ROWS - 1, 0), 0);
    assert.ok(centroidColumn(oldest) > centroidColumn(newest) + 90);
  }
});

test('Horizontal Loom: persistence fades with horizontal age without dimming high frequencies', () => {
  const loomLight = new Float32Array(LED_COUNT * 4);
  for (let index = 0; index < LED_COUNT; index++) loomLight[index * 4] = .2;
  for (const persistence of [.15, 1, 3]) {
    const values = evaluateLEDPattern({ loomLight }, { ...settings, persistence }).values;
    assert.equal(intensity(values, 0, 0), intensity(values, LED_ROWS - 1, 0));
    assert.equal(intensity(values, 0, LED_COLUMNS - 1), intensity(values, LED_ROWS - 1, LED_COLUMNS - 1));
    const ratio = intensity(values, 0, LED_COLUMNS - 1) / intensity(values, 0, 0);
    assert.ok(Math.abs(ratio - Math.exp(-1 / (3.25 * persistence))) < 1e-7);
  }
});

test('Horizontal Loom: neighboring bands retain their strongest emitted colors without mutating the cached frame', () => {
  const loomLight = new Float32Array(LED_COUNT * 4);
  // Bands 1 and 2 share physical row 1. Each wins different palette channels;
  // selecting one band, averaging, or recomputing colors would lose that light.
  loomLight.set([.3, .05, .02, .03], (19 * LED_COLUMNS + 1) * 4);
  loomLight.set([.1, .15, .2, .01], (19 * LED_COLUMNS + 2) * 4);
  const original = loomLight.slice();
  const totals = componentTotals(coefficients(evaluate({ loomLight })));
  const expected = [.3, .15, .2, .03].map(value => value * LED_COLUMNS / LED_ROWS);
  assert.ok(maxDifference(totals, expected) < 2e-7);
  assert.deepEqual(loomLight, original);
});

test('Horizontal Loom: real one-frame attacks are causal and travel continuously to the right', () => {
  const { at } = isolatedPeak();
  assert.equal(centroidColumn(at(sourceTime - 1e-6)), null);
  assert.ok(centroidColumn(at(sourceTime)) < 1);
  let previous = centroidColumn(at(sourceTime + 1));
  for (let sample = 1; sample <= 180; sample++) {
    const current = centroidColumn(at(sourceTime + 1 + sample / 60));
    assert.ok(current > previous, `History reversed at display sample ${sample}`);
    previous = current;
  }
  const boundary = sourceTime + 15 * sourceRowSeconds;
  const before = coefficients(at(boundary + .001));
  assert.ok(maxDifference(before, coefficients(at(boundary + .004))) > .001, 'History must move between 60 Hz analysis samples');
  for (let row = 6; row < LED_ROWS; row++) {
    const time = sourceTime + row * sourceRowSeconds;
    const left = coefficients(at(time - 1e-6));
    assert.ok(maxDifference(left, coefficients(at(time + 1e-6))) < .00003, `A visible handover jumped at source row ${row}`);
  }
});

test('Horizontal Loom: resampling preserves traveling light and hue at every display phase', () => {
  const { read, at } = isolatedPeak();
  const expected = componentTotals(read(sourceTime)).map(value => value * LED_COLUMNS / LED_ROWS);
  for (let sample = 0; sample <= 180; sample++) {
    const totals = componentTotals(coefficients(at(sourceTime + 1 + sample / 45)));
    assert.ok(maxDifference(totals, expected) < 2e-7, `A traveling peak pulsed or changed color at sample ${sample}`);
  }
});

test('Horizontal Loom: the oldest light fades completely within the same six-second history', () => {
  const { at } = isolatedPeak();
  const start = sum(coefficients(at(sourceTime + 53 * sourceRowSeconds)));
  const middle = sum(coefficients(at(sourceTime + 53.5 * sourceRowSeconds)));
  const ending = sum(coefficients(at(sourceTime + 6 - 1e-6)));
  assert.ok(Math.abs(middle - start * .5) < 2e-7);
  assert.ok(ending < 1e-8);
  assert.equal(sum(coefficients(at(sourceTime + 6))), 0);
  assert.equal(sum(coefficients(at(sourceTime + 6.1))), 0);
});

test('Horizontal Loom: stationary tones stay steady between display frames', () => {
  const timeline = makeTimeline();
  for (let frame = 0; frame < timeline.frames; frame++) for (let band = 0; band < LED_COLUMNS; band++) {
    timeline.bands[frame * LED_COLUMNS + band] = 9000 + band * 503;
  }
  const read = createLoomLightReader(timeline);
  const initial = evaluate({ loomLight: read(6.1) });
  for (let sample = 1; sample < 60; sample++) {
    const values = evaluate({ loomLight: read(6.1 + sample / 240) });
    // Exclude the causal entrance and the reader's final six-second fade.
    for (let row = 0; row < LED_ROWS; row++) for (const column of [4, 10, 40, 70, 89]) {
      const offset = (row * LED_COLUMNS + column) * 4;
      assert.ok(maxDifference(values.subarray(offset, offset + 4), initial.subarray(offset, offset + 4)) < 2e-7);
    }
  }
});

test('Horizontal Loom: arbitrary seeking cannot change a previously rendered frame', () => {
  const { at } = isolatedPeak();
  const times = [0, .99, 1, 1.321, 3.417, 6.922, 7];
  const expected = new Map(times.map(time => [time, at(time)]));
  for (const time of [8, 0, 6, 1, ...times.toReversed(), ...times]) {
    const values = at(time);
    if (expected.has(time)) assert.deepEqual(values, expected.get(time));
  }
});

test('Horizontal Loom: the checkbox leaves Calligraphy and Choreography unchanged', () => {
  const time = 4;
  const features = { bass: .7, mids: .6, highs: .5, energy: .6, width: .4, balance: .1, onsets: new Float32Array([.5, .3, .2]) };
  const bands = new Float32Array(LED_COLUMNS).fill(.65);
  const data = {
    time, features, bands,
    events: [{ time: 3.8, band: 0, strength: .6 }],
    waveform: { frames: [{ time, age: 0,
      left: Float32Array.from({ length: 193 }, (_, index) => .5 * Math.sin(index * .1)),
      right: Float32Array.from({ length: 193 }, (_, index) => .5 * Math.sin(index * .1 + .6)),
      rmsLeft: .35, rmsRight: .35, peakLeft: .5, peakRight: .5,
    }] },
    flowFrames: [{ time: 3.8, bands, features }],
  };
  for (const mode of ['calligraphy', 'choreography']) {
    const original = evaluateLEDPattern(data, { ...settings, mode, loomHorizontal: false });
    assert.ok(original.maxIntensity > 0, `${mode} fixture must illuminate`);
    assert.deepEqual(evaluateLEDPattern(data, { ...settings, mode }).values, original.values);
  }
});

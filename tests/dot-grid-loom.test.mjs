import assert from 'node:assert/strict';
import test from 'node:test';
import { createDotGridLoomMapper } from '../js/dot-grid/dot-grid-loom.js';
import { createLoomLightReader } from '../js/led-grid/led-loom-light.js';

const SOURCE_COLUMNS = 96, SOURCE_ROWS = 54;
const light = () => new Float32Array(SOURCE_COLUMNS * SOURCE_ROWS * 4);
const offset = (row, column, columns = SOURCE_COLUMNS) => (row * columns + column) * 4;
const attenuation = (age, gain = 1.3, persistence = 1) => 2.5 * gain * Math.exp(-age / (3.25 * persistence));
const approximately = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 5e-7, `${message}: ${actual} ≠ ${expected}`);

test('Dot Grid Loom preserves the source colors and frequencies, with the newest row at the bottom', () => {
  const source = light(), mapper = createDotGridLoomMapper();
  for (let i = 0; i < source.length; i++) source[i] = (i * 7919 % 1000) / 1000;
  const saved = source.slice();
  const result = mapper.map({ loomLight: source }, {}, SOURCE_COLUMNS, SOURCE_ROWS);
  assert.equal(result.length, source.length);
  for (let row = 0; row < SOURCE_ROWS; row++) for (let column = 0; column < SOURCE_COLUMNS; column++) {
    const age = SOURCE_ROWS - 1 - row;
    for (let component = 0; component < 4; component++) approximately(
      result[offset(row, column) + component],
      source[offset(age, column) + component] * attenuation(age / (SOURCE_ROWS - 1)),
    );
  }
  assert.deepEqual(source, saved, 'Rendering must not alter cached spectral light');
});

test('Dot Grid Loom horizontal mode puts recent bass bottom-left and older highs top-right', () => {
  const source = light(), mapper = createDotGridLoomMapper();
  source[offset(0, 0)] = .3;
  source[offset(53, 95) + 3] = .7;
  // Swapping the native dimensions makes this a precise orientation check.
  const values = mapper.map({ loomLight: source }, { loomHorizontal: true }, 54, 96);
  approximately(values[offset(95, 0, 54)], .3 * attenuation(0));
  approximately(values[offset(0, 53, 54) + 3], .7 * attenuation(1));
  assert.equal(values.filter(value => value > 0).length, 2);
});

test('Dot Grid Loom retains every narrow frequency peak when the grid has fewer frequency cells', () => {
  const source = light(), mapper = createDotGridLoomMapper();
  for (const horizontal of [false, true]) {
    const columns = horizontal ? 17 : 13, rows = horizontal ? 13 : 17;
    for (let band = 0; band < SOURCE_COLUMNS; band++) {
      source.fill(0);
      for (let age = 0; age < SOURCE_ROWS; age++) source[offset(age, band) + 2] = .5;
      const values = mapper.map({ loomLight: source }, { loomHorizontal: horizontal }, columns, rows);
      const frequencies = new Set();
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        if (values[offset(row, column, columns) + 2] > 0) frequencies.add(horizontal ? rows - 1 - row : column);
      }
      assert.equal(frequencies.size, 1, `Frequency ${band} was lost or duplicated`);
      assert.equal([...frequencies][0], Math.ceil((band + 1) * 13 / SOURCE_COLUMNS) - 1);
    }
  }
});

test('Dot Grid Loom remaps the full history without losing light or changing its palette', () => {
  const mapper = createDotGridLoomMapper(), source = light();
  const palette = [.2, .3, .1, .4];
  for (const rows of [7, 13, 54, 81, 106]) for (const sourceRow of [0, 1, 17, 52, 53]) {
    source.fill(0);
    source.set(palette, offset(sourceRow, 40));
    const values = mapper.map({ loomLight: source }, {}, 96, rows);
    const totals = [0, 0, 0, 0];
    for (let row = 0; row < rows; row++) for (let component = 0; component < 4; component++) {
      totals[component] += values[offset(row, 40) + component] / attenuation((rows - 1 - row) / (rows - 1));
    }
    for (let component = 0; component < 4; component++) approximately(
      totals[component], palette[component] * rows / SOURCE_ROWS,
      `History row ${sourceRow}, display height ${rows}, palette ${component}`,
    );
  }
});

test('Dot Grid Loom moving peaks remain causal and follow the selected scroll direction after seeking', () => {
  const frames = 481;
  const timeline = { duration: 8, frames, bands: new Uint16Array(frames * 96), features: new Float32Array(frames * 10) };
  timeline.bands[60 * 96 + 40] = Math.round(.9 * 65535);
  const read = createLoomLightReader(timeline), mapper = createDotGridLoomMapper();
  function at(time, horizontal) {
    return mapper.map({ loomLight: read(time) }, { loomHorizontal: horizontal }, 64, 36).slice();
  }
  function centroid(values, horizontal) {
    let weight = 0, moment = 0;
    for (let row = 0; row < 36; row++) for (let column = 0; column < 64; column++) {
      const base = offset(row, column, 64);
      const energy = values[base] + values[base + 1] + values[base + 2] + values[base + 3];
      weight += energy;
      moment += energy * (horizontal ? column : row);
    }
    return weight > 0 ? moment / weight : null;
  }
  for (const horizontal of [false, true]) {
    assert.equal(centroid(at(.9999, horizontal), horizontal), null);
    const first = centroid(at(1, horizontal), horizontal);
    const later = centroid(at(4, horizontal), horizontal);
    assert.ok(horizontal ? later > first + 25 : later < first - 12);
    const sought = at(3.875, horizontal);
    at(6.5, !horizontal); at(1.25, horizontal);
    assert.deepEqual(at(3.875, horizontal), sought, 'Seek order must not change the history');
    assert.equal(centroid(at(7.001, horizontal), horizontal), null);
  }
});

test('Dot Grid Loom clears reused output for silence and keeps gain and persistence separate from frequency', () => {
  const mapper = createDotGridLoomMapper(), source = light().fill(.2);
  const normal = mapper.map({ loomLight: source }, { loomGain: 1, loomPersistence: 1 }, 12, 8).slice();
  const brighter = mapper.map({ loomLight: source }, { loomGain: 2, loomPersistence: 1 }, 12, 8).slice();
  for (let i = 0; i < normal.length; i++) approximately(brighter[i], normal[i] * 2);
  const persistent = mapper.map({ loomLight: source }, { loomGain: 1, loomPersistence: 3 }, 12, 8);
  assert.ok(persistent[offset(0, 0, 12)] > normal[offset(0, 0, 12)]);
  approximately(persistent[offset(7, 0, 12)], normal[offset(7, 0, 12)]);
  approximately(persistent[offset(0, 0, 12)], persistent[offset(0, 11, 12)]);
  assert.ok(mapper.map(null, {}, 12, 8).every(value => value === 0));
  assert.ok(mapper.map({ loomLight: source }, { loomGain: 0 }, 12, 8).every(value => value === 0));
});

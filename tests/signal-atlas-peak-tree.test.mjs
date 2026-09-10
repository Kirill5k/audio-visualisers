import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPeakTree, queryPeakTree } from '../js/atlas/signal-atlas-peak-tree.js';
import { createStereoSpectrum } from '../js/atlas/signal-atlas-analysis-core.js';

test('binary max queries cover arbitrary inclusive intervals and both edges', () => {
  const count = 16384;
  let seed = 1234567;
  const source = Uint16Array.from({ length: count }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 16;
  });
  const tree = buildPeakTree(source, new Uint16Array(count));
  for (let index = 0; index < count; index++) {
    assert.equal(queryPeakTree(source, tree, index, index), source[index]);
  }
  for (let first = 0; first < count; first += 29) {
    for (const span of [1, 2, 3, 6, 7, 11, 65, 256, 973, 16384]) {
      const last = Math.min(count - 1, first + span);
      let maximum = 0;
      for (let index = first; index <= last; index++) maximum = Math.max(maximum, source[index]);
      assert.equal(queryPeakTree(source, tree, first, last), maximum);
    }
  }
});

test('packed row construction isolates adjacent history rows and replaces old peaks', () => {
  const source = Uint16Array.of(1, 2, 30, 4, 5, 6, 7, 8, 10, 20, 3, 40, 50, 60, 70, 80);
  const tree = new Uint16Array(16);
  buildPeakTree(source, tree, 8, 0, 0);
  const firstRow = tree.slice(0, 8);
  buildPeakTree(source, tree, 8, 8, 8);
  assert.deepEqual(tree.slice(0, 8), firstRow);
  assert.equal(tree[1], 30);
  assert.equal(tree[9], 80);
  source.fill(0, 8);
  buildPeakTree(source, tree, 8, 8, 8);
  assert.ok(tree.slice(8).every(value => value === 0));
  assert.deepEqual(tree.slice(0, 8), firstRow);
});

test('a high-frequency Blackman FFT peak survives both log-column and 4K pixel mapping', () => {
  const rate = 48000, size = 32768, bin = 16380;
  const source = Float32Array.from({ length: rate }, (_, index) => 0.8 * Math.sin(2 * Math.PI * bin * index / size));
  const spectrum = createStereoSpectrum([source], rate)(60);
  const tree = buildPeakTree(spectrum, new Uint16Array(spectrum.length));
  const knee = 30 * size / rate;
  const normalized = Math.log1p(bin / knee) / Math.log1p((spectrum.length - 1) / knee);
  const binAt = x => knee * Math.expm1(Math.log1p((spectrum.length - 1) / knee) * Math.max(0, Math.min(1, x)));
  assert.equal(binAt(0), 0);
  assert.ok(Math.abs(binAt(1) - (spectrum.length - 1)) < 1e-9);
  const truePeak = spectrum[bin];
  const column = Math.round(normalized * 16383);
  assert.equal(queryPeakTree(spectrum, tree, binAt((column - 0.5) / 16383), binAt((column + 0.5) / 16383)), truePeak);
  const height = 2160 * 0.093;
  const pixel = Math.floor(normalized * height);
  assert.equal(queryPeakTree(spectrum, tree, binAt(pixel / height), binAt((pixel + 1) / height)), truePeak);
  assert.ok(Math.abs(truePeak / 65535 * 90 - 90 - 20 * Math.log10(0.8)) < 0.01);
});

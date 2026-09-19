import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainColumnRanges, mapTerrainColumns, mapTerrainEnvelope, terrainEnergy, terrainHistoryLayout } from '../js/terrain/spectral-terrain-math.js';
import { buildPeakTree, queryPeakTree } from '../js/atlas/signal-atlas-peak-tree.js';
import { createStereoSpectrum } from '../js/atlas/signal-atlas-analysis-core.js';

test('all maximum-detail columns match original exact peak-tree intervals', () => {
  let seed = 82;
  const spectrum = Uint16Array.from({ length: 16384 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 16;
  });
  const tree = buildPeakTree(spectrum, new Uint16Array(spectrum.length));
  for (const rate of [44100, 48000, 96000]) {
    const ranges = createTerrainColumnRanges(rate);
    const mapped = mapTerrainColumns(spectrum, ranges);
    const knee = 30 * 32768 / rate;
    const binAt = x => knee * Math.expm1(Math.log1p(16383 / knee) * Math.max(0, Math.min(1, x)));
    for (let column = 0; column < 16384; column++) {
      assert.equal(mapped[column], queryPeakTree(spectrum, tree,
        binAt((column - .5) / 16383), binAt((column + .5) / 16383)), `rate ${rate}, column ${column}`);
    }
  }
});

test('mapping covers every source bin, including isolated DC and final-bin peaks', () => {
  const ranges = createTerrainColumnRanges(48000);
  const coverage = new Uint8Array(16384);
  for (let column = 0; column < 16384; column++) {
    for (let bin = ranges.first[column]; bin <= ranges.last[column]; bin++) coverage[bin] = 1;
  }
  assert.ok(coverage.every(Boolean));
  for (const bin of [0, 1, 97, 6000, 16382, 16383]) {
    const source = new Uint16Array(16384);
    source[bin] = 65535;
    const mapped = mapTerrainColumns(source, ranges);
    assert.equal(Math.max(...mapped), 65535);
    for (let column = 0; column < mapped.length; column++) {
      assert.equal(mapped[column], ranges.first[column] <= bin && ranges.last[column] >= bin ? 65535 : 0);
    }
  }
});

test('high-frequency calibrated FFT energy survives mapping and silence clears reused output', () => {
  const rate = 48000, bin = 16380, size = 32768;
  const samples = Float32Array.from({ length: rate }, (_, i) => .8 * Math.sin(2 * Math.PI * bin * i / size));
  const spectrum = createStereoSpectrum([samples], rate)(60);
  const ranges = createTerrainColumnRanges(rate), target = new Uint16Array(16384);
  assert.equal(mapTerrainColumns(spectrum, ranges, target), target);
  assert.equal(Math.max(...target), Math.max(...spectrum));
  mapTerrainColumns(new Uint16Array(16384), ranges, target);
  assert.ok(target.every(value => value === 0));
});

test('energy colour modulation stays bounded, neutral in silence and stereo symmetric', () => {
  assert.equal(terrainEnergy(), 0);
  assert.equal(terrainEnergy({ lRms: 0, rRms: 0 }), 0);
  assert.equal(terrainEnergy({ lRms: 1, rRms: 1 }), 1);
  assert.equal(terrainEnergy({ lRms: .02, rRms: .2 }), terrainEnergy({ lRms: .2, rRms: .02 }));
  assert.throws(() => createTerrainColumnRanges(0), RangeError);
});

test('longer history extends the terrain without changing sample cadence or ridge spacing', () => {
  const short = terrainHistoryLayout(2), original = terrainHistoryLayout(6), long = terrainHistoryLayout(12);
  assert.equal(original.ridges, 120);
  assert.equal(original.depth, 10.5);
  assert.equal(long.ridges, 239);
  assert.equal(long.depth, 21);
  assert.equal(short.ridges, 40);
  assert.ok(short.depth < original.depth);
  for (const layout of [short, original, long]) {
    assert.equal(layout.timeStep, original.timeStep);
    assert.equal(layout.depthStep, original.depthStep);
    assert.ok((layout.ridges - 1) * layout.timeStep <= layout.seconds + 1e-8);
    assert.ok(layout.ridges * layout.timeStep > layout.seconds);
  }
});

test('continuous terrain envelope preserves isolated peaks without sub-bin staircase cliffs', () => {
  const ranges = createTerrainColumnRanges(48000);
  for (const bin of [0, 1, 21, 97, 6000, 16382, 16383]) {
    const spectrum = new Uint16Array(16384);
    spectrum[bin] = 65535;
    const mapped = mapTerrainEnvelope(spectrum, ranges);
    assert.equal(Math.max(...mapped), 65535, `isolated bin ${bin} is retained`);
    if (bin > 0 && bin < 100) assert.ok(mapped.some(value => value > 0 && value < 65535), 'sub-bin slopes are continuous');
  }
  const ramp = Uint16Array.from({ length: 16384 }, (_, i) => i * 4);
  const mapped = mapTerrainEnvelope(ramp, ranges);
  for (let i = 0; i < mapped.length; i++) {
    assert.equal(mapped[i], Math.round(ranges.end[i] * 4), `linear envelope at column ${i}`);
  }
  const silence = mapTerrainEnvelope(new Uint16Array(16384), ranges, mapped);
  assert.ok(silence.every(value => value === 0));
});

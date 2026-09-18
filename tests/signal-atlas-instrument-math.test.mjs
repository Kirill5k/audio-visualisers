import assert from 'node:assert/strict';
import test from 'node:test';
import { amplitudeToDb, clampRange, dbToUnit, fillPhaseTrail, frequencyAt, phaseTrailWeight, RTA_PRESETS, sampleSpectrum, validateRange } from '../js/atlas/signal-atlas-instrument-math.js';

test('analyzer ranges reject empty and reversed inputs and respect track Nyquist', () => {
  assert.deepEqual(validateRange('20', '20000', 32000), { min: 20, max: 16000 });
  assert.deepEqual(validateRange(500, 4000, 48000), RTA_PRESETS.mids);
  for (const [min, max] of [['', 20000], ['  ', 20000], [20, ''], [0, 20000], [NaN, 20000], [100, 100], [1000, 100], [24000, 30000]]) {
    assert.throws(() => validateRange(min, max, 48000), RangeError);
  }
  assert.throws(() => validateRange(20, 20000, 0), RangeError);
  assert.deepEqual(clampRange(4000, 20000, 6000), { min: 20, max: 3000 }, 'a low-rate track restores a useful range');
  assert.deepEqual(clampRange(20, 20000, 22050), { min: 20, max: 11025 });
});

test('log-frequency endpoints and midpoint stay consistent with the hover coordinates', () => {
  assert.equal(frequencyAt(-1, 20, 20000), 20);
  assert.equal(frequencyAt(2, 20, 20000), 20000);
  assert.ok(Math.abs(frequencyAt(.5, 20, 20000) - Math.sqrt(20 * 20000)) < 1e-10);
});

test('spectrum sampling interpolates narrow bins and retains peaks on a compressed log axis', () => {
  const spectrum = new Float32Array(1024).fill(-100);
  spectrum[10] = -60; spectrum[11] = -20;
  const binWidth = 48000 / 2048;
  assert.equal(sampleSpectrum(spectrum, binWidth * 10, 48000), -60);
  assert.equal(sampleSpectrum(spectrum, binWidth * 10.25, 48000), -50);
  assert.equal(sampleSpectrum(spectrum, binWidth * 9, 48000, binWidth * 14), -20);
  spectrum[1023] = -9;
  assert.equal(sampleSpectrum(spectrum, 24000, 48000), -9, 'Nyquist clamps to the last available bin');
  assert.equal(spectrum[10], -60, 'sampling never applies display boost or mutates the FFT');
});

test('silent spectra and sample peaks retain negative infinity while meters clamp only visually', () => {
  assert.equal(sampleSpectrum(new Float32Array(1024).fill(-Infinity), 1000), -Infinity);
  assert.equal(sampleSpectrum(null, 1000), -Infinity);
  assert.equal(amplitudeToDb(0), -Infinity);
  assert.equal(amplitudeToDb(1), 0);
  assert.ok(Math.abs(amplitudeToDb(.5) + 6.020599913) < 1e-8);
  assert.ok(amplitudeToDb(1.5) > 0, 'clipping remains measurable above full scale');
  assert.equal(dbToUnit(-Infinity), 0);
  assert.equal(dbToUnit(-90), 0);
  assert.equal(dbToUnit(-45), .5);
  assert.equal(dbToUnit(6), 1);
});

test('scope persistence fades real older points without altering stereo phase', () => {
  const positions = new Float32Array(48), weights = new Float32Array(16);
  const left = Float32Array.from({ length: 16 }, (_, i) => (i + 1) / 16);
  const mono = fillPhaseTrail({ left, startSample: 0 }, 100, positions, weights);
  assert.equal(mono.count, 16);
  assert.equal(mono.duration, .16);
  assert.equal(mono.correlation, 1);
  for (let i = 0; i < mono.count; i++) {
    assert.equal(positions[i * 3], 0, 'mono remains a vertical line');
    assert.equal(positions[i * 3 + 1], left[i] * 2);
    if (i > 0) assert.ok(weights[i] > weights[i - 1], 'older samples are fainter');
  }
  const right = Float32Array.from(left, value => -value);
  const opposite = fillPhaseTrail({ left, right }, 100, positions, weights);
  assert.equal(opposite.correlation, -1);
  for (let i = 0; i < opposite.count; i++) assert.equal(positions[i * 3 + 1], 0, 'opposite phase remains horizontal');
  const silence = fillPhaseTrail({ left: new Float32Array(16) }, 100, positions, weights);
  assert.equal(silence.correlation, 0);
  assert.ok(positions.every(value => value === 0));
  assert.equal(phaseTrailWeight(0), 1);
  assert.equal(phaseTrailWeight(.16), 0);
  assert.equal(phaseTrailWeight(1), 0);
});

test('scope decimation retains absolute samples and deterministic age after a seek', () => {
  const positions = new Float32Array(12), weights = new Float32Array(4);
  const frame = startSample => ({ startSample, left: Float32Array.from({ length: 16 }, (_, i) => (startSample + i) / 200) });
  const first = fillPhaseTrail(frame(100), 100, positions, weights);
  const firstPositions = positions.slice(), firstWeights = weights.slice();
  assert.equal(first.stride, 4);
  fillPhaseTrail(frame(101), 100, positions, weights);
  for (let i = 0; i < 3; i++) {
    assert.equal(positions[i * 3 + 1], firstPositions[(i + 1) * 3 + 1], 'overlapping points keep their true positions');
    assert.ok(weights[i] < firstWeights[i + 1], 'the same sample fades smoothly as it ages');
  }
  assert.deepEqual(fillPhaseTrail(frame(100), 100, positions, weights), first);
  assert.deepEqual(positions, firstPositions, 'seeking backwards exactly reconstructs the cloud');
  assert.deepEqual(weights, firstWeights);
  assert.equal(fillPhaseTrail(null, 100, positions, weights).count, 0, 'unloading removes the draw range');
});

test('scope correlation includes samples omitted by point decimation', () => {
  const left = new Float32Array(16).fill(1);
  const right = new Float32Array(16).fill(-1);
  right[0] = 1;
  const result = fillPhaseTrail({ left, right, startSample: 0 }, 100, new Float32Array(3), new Float32Array(1));
  assert.equal(result.count, 1);
  assert.ok(result.correlation < -.95, 'a sparse display must not invent positive correlation');
});

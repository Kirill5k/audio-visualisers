import test from 'node:test';
import assert from 'node:assert/strict';
import { FREQUENCY_CURVE, sampleSpectrum } from '../js/waveform-drift-spectrum.js';

const settings = { minFrequency: 40, maxFrequency: 12000, nyquist: 24000, gain: 1 };
const shaped = raw => Math.pow(Math.min(1, Math.max(0, Math.pow(raw, 1.18))), 1.55);
const atFrequency = frequency => Math.pow(
  (frequency - settings.minFrequency) / (settings.maxFrequency - settings.minFrequency),
  1 / FREQUENCY_CURVE,
);
const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should equal ${expected}`);
};

test('a 2048-point FFT uses its 1024 active bins to locate a frequency', () => {
  const data = new Uint8Array(1024);
  data[32] = 255;
  const frequency = (32 + .5) / data.length * settings.nyquist;
  close(sampleSpectrum(data, atFrequency(frequency), settings), 1);
  close(sampleSpectrum(data, atFrequency(frequency * 4), settings), 0);
});

test('frequency samples interpolate continuously between texel centers', () => {
  const data = new Uint8Array(1024);
  data[33] = 255;
  const between = 33 / data.length * settings.nyquist;
  close(sampleSpectrum(data, atFrequency(between), settings), shaped(.5));
  const center = 33.5 / data.length * settings.nyquist;
  const left = sampleSpectrum(data, atFrequency(center - .00001), settings);
  const right = sampleSpectrum(data, atFrequency(center + .00001), settings);
  assert.ok(left > .99999 && right > .99999);
  close(left, right);
});

test('silence stays silent and full input respects gain and saturation', () => {
  const silent = new Uint8Array(1024);
  const full = new Uint8Array(1024).fill(255);
  for (const smoothness of [0, .3, 1]) {
    close(sampleSpectrum(silent, .6, settings, smoothness), 0);
    close(sampleSpectrum(full, .6, settings, smoothness), 1);
    close(sampleSpectrum(full, .6, { ...settings, gain: .5 }, smoothness), Math.pow(.5, 1.55));
    close(sampleSpectrum(full, .6, { ...settings, gain: 5 }, smoothness), 1);
    close(sampleSpectrum(full, .6, { ...settings, gain: -1 }, smoothness), 0);
  }
  close(sampleSpectrum(new Uint8Array(), .5, settings), 0);
});

test('coordinates and frequency samples clamp at the spectrum edges', () => {
  const data = Uint8Array.of(64, 128, 192, 255);
  const fullRange = { ...settings, minFrequency: 0, maxFrequency: settings.nyquist };
  close(sampleSpectrum(data, -2, fullRange), shaped(64 / 255));
  close(sampleSpectrum(data, 3, fullRange), 1);
  close(sampleSpectrum(data, 0, { ...fullRange, minFrequency: -100 }), shaped(64 / 255));
  close(sampleSpectrum(data, 1, { ...fullRange, maxFrequency: 48000 }), 1);
  close(sampleSpectrum(data, .4, fullRange, -1), sampleSpectrum(data, .4, fullRange));
});

test('triangular smoothing lowers a narrow crest and distributes its shaped height', () => {
  const data = new Uint8Array(8192);
  data[640] = 128;
  const frequency = (640 + .5) / data.length * settings.nyquist;
  const center = atFrequency(frequency);
  const radius = .012;
  const height = shaped(128 / 255);
  close(sampleSpectrum(data, center, settings), height);
  close(sampleSpectrum(data, center, settings, 1), height / 3);
  close(sampleSpectrum(data, center - radius, settings), 0);
  close(sampleSpectrum(data, center - radius, settings, 1), height * 2 / 9);
  close(sampleSpectrum(data, center - 2 * radius, settings, 1), height / 9);
});

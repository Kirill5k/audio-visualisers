import assert from 'node:assert/strict';
import test from 'node:test';
import { spectrogramColor, createSpectrogramPalette } from '../js/atlas/signal-atlas-color.js';

test('spectrogram palette matches reference colors and interpolates in display RGB', () => {
  for (const [level, expected] of [[0, [4, 3, 12]], [.15, [14, 10, 42]], [.30, [45, 12, 95]],
    [.45, [110, 20, 130]], [.60, [185, 30, 85]], [.75, [230, 80, 25]],
    [.88, [255, 175, 20]], [.96, [255, 235, 80]], [1, [255, 255, 240]]]) {
    assert.deepEqual(spectrogramColor(level), expected);
  }
  assert.deepEqual(spectrogramColor(.075), [9, 7, 27]);
  assert.deepEqual(spectrogramColor(-1), [4, 3, 12]);
  assert.deepEqual(spectrogramColor(2), [255, 255, 240]);
  assert.deepEqual(spectrogramColor(NaN), [4, 3, 12]);
});

test('palette texture contains 1024 opaque colors including both endpoints', () => {
  const palette = createSpectrogramPalette();
  assert.equal(palette.length, 4096);
  assert.deepEqual([...palette.subarray(0, 4)], [4, 3, 12, 255]);
  assert.deepEqual([...palette.subarray(-4)], [255, 255, 240, 255]);
  assert.ok(palette.every((value, index) => index % 4 !== 3 || value === 255));
});

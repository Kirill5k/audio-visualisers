import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLEDPattern, LED_COUNT, LED_COLUMNS } from '../js/led-grid/led-patterns.js';

// Reproduce the shader's public colour-mix contract, then remove only the
// intentional age attenuation to measure the handover's light and colour.
function integratedRGB(values, palette) {
  const total = [0, 0, 0];
  for (let led = 0; led < LED_COUNT; led++) {
    const offset = led * 4, age = Math.floor(led / LED_COLUMNS) / 53;
    const energy = values[offset] / Math.exp(-age / 3.25);
    const cool = values[offset + 1], amber = values[offset + 2], white = values[offset + 3] * .82;
    for (let channel = 0; channel < 3; channel++) {
      let color = palette[0][channel] * (1 - cool) + palette[1][channel] * cool;
      color = color * (1 - amber) + palette[2][channel] * amber;
      color = color * (1 - white) + palette[3][channel] * white;
      total[channel] += energy * color;
    }
  }
  return total;
}

test('Loom renderer preserves emitted RGB and hue throughout a row handover for any palette', () => {
  const coefficients = [.04, .08, .35, .2];
  const palettes = [
    [[.18, .06, 1], [.03, .1, 1], [1, .38, .047], [1, .88, .63]],
    [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]],
    [[.7, .2, .4], [.3, .8, .5], [.5, .4, .9], [.1, .9, .3]],
  ];
  for (const palette of palettes) {
    const expected = [0, 1, 2].map(channel => coefficients.reduce((sum, value, i) => sum + value * palette[i][channel], 0) * 2.5);
    for (let step = 0; step <= 40; step++) {
      const blend = step / 40;
      const loomLight = new Float32Array(LED_COUNT * 4);
      for (let i = 0; i < 4; i++) {
        loomLight[(24 * LED_COLUMNS + 40) * 4 + i] = coefficients[i] * (1 - blend);
        loomLight[(25 * LED_COLUMNS + 40) * 4 + i] = coefficients[i] * blend;
      }
      // Changing raw history may not reclassify the already-coloured peak.
      const history = new Float32Array(LED_COUNT).fill(blend);
      const { values } = evaluateLEDPattern({ loomLight, history }, { mode: 'loom', gain: 1, persistence: 1 });
      const rgb = integratedRGB(values, palette);
      rgb.forEach((value, channel) => assert.ok(Math.abs(value - expected[channel]) < 3e-7,
        `Channel ${channel} must not dip or change hue at handover phase ${blend}`));
    }
  }
});

test('Loom renderer keeps pre-mapped silence dark and sensitivity remains effective', () => {
  const loomLight = new Float32Array(LED_COUNT * 4);
  assert.equal(evaluateLEDPattern({ loomLight }, { mode: 'loom', gain: 1 }).maxIntensity, 0);
  loomLight[0] = .2; loomLight[2] = .3;
  const first = evaluateLEDPattern({ loomLight }, { mode: 'loom', gain: .5 }).values[0];
  const second = evaluateLEDPattern({ loomLight }, { mode: 'loom', gain: 1 }).values[0];
  assert.ok(Math.abs(second - first * 2) < 1e-7);
  assert.equal(evaluateLEDPattern({ loomLight }, { mode: 'loom', gain: 0 }).maxIntensity, 0);
});

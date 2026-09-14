import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoomLightReader } from '../js/led-grid/led-loom-light.js';
import { evaluateLEDPattern } from '../js/led-grid/led-patterns.js';

// NeutralToneMapping from the renderer's pinned Three.js r183. Test displayed
// light as well as the input coefficients: a tone curve maps one bright LED
// differently from two LEDs sharing the same input energy.
// https://github.com/mrdoob/three.js/blob/r183/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
function neutral(rgb) {
  const minimum = Math.min(...rgb), offset = minimum < .08 ? minimum - 6.25 * minimum * minimum : .04;
  let colour = rgb.map(value => value - offset);
  const peak = Math.max(...colour);
  if (peak < .76) return colour;
  const compressed = 1 - .24 ** 2 / (peak - .52);
  colour = colour.map(value => value * compressed / peak);
  const desaturation = 1 - 1 / (.15 * (peak - compressed) + 1);
  return colour.map(value => value * (1 - desaturation) + compressed * desaturation);
}
const linear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
const palette = ['7446FF', '2F5BFF', 'FFA53D', 'FFF1D0'].map(hex => hex.match(/../g).map(part => linear(parseInt(part, 16) / 255)));
const housing = [.001, .00115, .00165];
const luma = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
const black = luma(neutral(housing));
const mix = (a, b, amount) => a.map((value, i) => value + (b[i] - value) * amount);
function displayed(values, row, column) {
  const index = (row * 96 + column) * 4;
  let colour = mix(palette[0], palette[1], values[index + 1]);
  colour = mix(colour, palette[2], values[index + 2]);
  colour = mix(colour, palette[3], values[index + 3] * .82);
  return luma(neutral(colour.map((value, i) => value * values[index] * 2.05 + housing[i]))) - black;
}
const modulation = values => (Math.max(...values) - Math.min(...values)) / (values.reduce((a, b) => a + b, 0) / values.length);

for (const [name, value, onset] of [['cool', .39, 0], ['amber', .75, .25], ['white', .94, .9]]) {
  test(`Loom display: ${name} peaks avoid a brightness flash at each row handover`, () => {
    const timeline = { duration: 8, frames: 481, bands: new Uint16Array(481 * 96), features: new Float32Array(481 * 10) };
    timeline.bands[60 * 96 + 40] = Math.round(value * 65535);
    timeline.features[60 * 10 + 8] = onset;
    const read = createLoomLightReader(timeline), totals = [], centroids = [];
    for (let sample = 0; sample <= 240; sample++) {
      const time = 1 + (21 + sample / 240) / 9;
      const { values } = evaluateLEDPattern({ time, loomLight: read(time) }, { mode: 'loom', gain: 1.3, persistence: 1 });
      let total = 0, weighted = 0;
      for (let row = 0; row < 54; row++) {
        const light = displayed(values, row, 40);
        total += light; weighted += light * row;
      }
      totals.push(total); centroids.push(weighted / total);
    }
    // The old two-row implementation modulated warm/white display light by
    // roughly45–53%. This bound is in output light, after highlight compression.
    assert.ok(modulation(totals) < .2, `${name} display modulation was ${modulation(totals)}`);
    for (let i = 1; i < centroids.length; i++) {
      const speed = (centroids[i] - centroids[i - 1]) * 240;
      assert.ok(speed > .5 && speed < 2, `${name} visible centroid stalled or jumped: ${speed}`);
    }
  });
}

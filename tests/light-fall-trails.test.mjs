import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PRESETS, DEFAULT_PRESET_ID } from '../js/light-fall/light-fall-presets.js';
import { createSettings, LIGHT_FALL_CONTROLS } from '../js/light-fall/light-fall-settings.js';
import { createTrailLayout, createLightFallTrails, normalizedTrailRank, trailSlotX, bendUv } from '../js/light-fall/light-fall-trails.js';
import { lightFallVertexShader, lightFallFragmentShader } from '../js/light-fall/light-fall-shaders.js';
import { resolveEffectOrder } from '../js/particle-dance/particle-dance-effect-settings.js';

test('all six source variants load independently with the linked #5 as the default', () => {
  assert.equal(PRESETS.length, 6);
  assert.equal(DEFAULT_PRESET_ID, 'config-1783179841706-168');
  const defaults = createSettings();
  assert.equal(Object.keys(LIGHT_FALL_CONTROLS).length, 13);
  assert.deepEqual([
    defaults.trailCount, defaults.trailSpread, defaults.trailBrightness,
    defaults.speedMultiplier, defaults.audioReactivity, defaults.dotDensity,
    defaults.dotSize, defaults.dotSpeed, defaults.arcRadius, defaults.color0,
  ], [700, 2.05, 1.4, .05, 2, 100, .5, 2.2, 200, '#004c94']);
  assert.equal(defaults.sensitivity, 3.5);
  assert.equal(defaults.globalIntensity, 1);
  assert.equal(defaults.cameraFov, 75);
  assert.equal(defaults.fftSize, 16384);
  assert.equal(defaults.enablePostProcessing, false);
  assert.equal(defaults.barrelDistortion_enabled, true);
  assert.equal(defaults.kaleidoscope_enabled, true);
  assert.deepEqual(resolveEffectOrder(defaults), []);
  defaults.cameraState.position.x = 42;
  defaults.effectOrder.reverse();
  defaults.controlModulations.audioReactivity = { enabled: true };
  assert.equal(createSettings().cameraState.position.x, -91.771393);
  assert.deepEqual(createSettings().controlModulations, {});
  const third = createSettings(PRESETS[2].id);
  assert.equal(third.controlModulations.radialBlur_strength.source, 'flux');
  assert.equal(third.controlModulations.radialBlur_strength.releaseMs, 610);
  assert.deepEqual(resolveEffectOrder(createSettings(PRESETS[5].id)), ['gradientMap', 'gammaCorrection', 'radialBlur', 'feedback']);
  assert.throws(() => createSettings('missing'), RangeError);
});

test('original GLSL is preserved verbatim from the inspected source bundle', () => {
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(lightFallVertexShader), 'c6421c3b2dd36fca1676764f51249675e2c76cad3f819e1ad2b2b05403a540cb');
  assert.equal(hash(lightFallFragmentShader), 'ff41d4608c8dad28b1f0fd64e0da1581ae463f0d9ac24bacd9b6ed8e5c45701e');
});

test('seeded layout keeps all 700 source trails and their six-call distributions stable', () => {
  const layout = createTrailLayout();
  assert.equal(layout.length, 700);
  assert.deepEqual(layout, createTrailLayout());
  assert.notDeepEqual(layout, createTrailLayout(12));
  assert.deepEqual(layout[0], {
    baseSlotX: -80, colorIndex: 1, baseTailLength: 0.662647154647857,
    geometryX: -80.96523497160524, radius: 0.26888636467047033,
    speed: 0.43462003364693375, offset: 0.44651689077727497,
  });
  assert.equal(layout[699].baseSlotX, 80);
  for (const trail of layout) {
    assert.ok(trail.radius >= .1 && trail.radius < .3);
    assert.ok(trail.baseTailLength >= .3 && trail.baseTailLength < .7);
    assert.ok(Math.abs(trail.geometryX - trail.baseSlotX) <= 1);
    assert.ok(trail.speed >= .2 && trail.speed < .7);
    assert.ok(trail.colorIndex >= 0 && trail.colorIndex <= 4);
  }
});

test('source center-out rank maps mirrored trails to matching frequency bins', () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => normalizedTrailRank(i, 5)), [0, .5, -.5, 1, -1]);
  assert.equal(normalizedTrailRank(0, 1), 0);
  assert.equal(trailSlotX(-1), -80);
  assert.equal(trailSlotX(0), 0);
  assert.equal(trailSlotX(1), 80);
  const settings = { ...createSettings(), trailCount: 5, sensitivity: 1 };
  const simulation = createLightFallTrails();
  const spectrum = Uint8Array.from([255, 0, 0, 128, 0, 0, 0, 64]);
  const output = simulation.step(settings, spectrum, 1 / 120);
  assert.deepEqual([...output.frequencyIndex.slice(0, 5)], [0, 3, 3, 7, 7]);
  assert.ok(Math.abs(output.slowEnergy[0] - .15) < 1e-7);
  assert.ok(Math.abs(output.fastEnergy[0] - .65) < 1e-7);
  assert.equal(output.slowEnergy[1], output.slowEnergy[2]);
  assert.equal(output.slowEnergy[3], output.slowEnergy[4]);
});

test('audio envelope timing is frame-rate independent and render-only passes do not age it', () => {
  const settings = { ...createSettings(), trailCount: 1, sensitivity: 1 };
  const spectrum = new Uint8Array(100).fill(255);
  const a = createLightFallTrails(), b = createLightFallTrails();
  a.step(settings, spectrum, 1 / 60);
  b.step(settings, spectrum, 1 / 120);
  b.step(settings, spectrum, 1 / 120);
  assert.ok(Math.abs(a.output.slowEnergy[0] - b.output.slowEnergy[0]) < 1e-7);
  assert.ok(Math.abs(a.output.fastEnergy[0] - b.output.fastEnergy[0]) < 1e-7);
  assert.equal(a.output.time, b.output.time);
  const before = { time: a.output.time, slow: a.output.slowEnergy[0], fast: a.output.fastEnergy[0] };
  a.step({ ...settings, trailSpread: 6 }, new Uint8Array(100), 0);
  assert.deepEqual({ time: a.output.time, slow: a.output.slowEnergy[0], fast: a.output.fastEnergy[0] }, before);
});

test('reset erases temporal state without replacing seeded setup or buffers', () => {
  const settings = createSettings();
  const simulation = createLightFallTrails();
  const output = simulation.output;
  const layout = output.layout, slow = output.slowEnergy;
  const spectrum = new Uint8Array(100).fill(200);
  simulation.step(settings, spectrum, 1 / 60);
  const first = { time: output.time, slow: [...slow], tail: [...output.tailLength] };
  simulation.step(settings, spectrum, 5);
  simulation.reset();
  assert.equal(output.time, 0);
  assert.equal(output.bass, 0);
  assert.equal(output.layout, layout);
  assert.equal(output.slowEnergy, slow);
  assert.ok(slow.every(value => value === 0));
  assert.ok(output.fastEnergy.every(value => value === 0));
  simulation.step(settings, spectrum, 1 / 60);
  assert.deepEqual({ time: output.time, slow: [...slow], tail: [...output.tailLength] }, first);
});

test('fractional trail counts fade their last pair and extreme audio caps tail length', () => {
  const settings = { ...createSettings(), trailCount: 3.5 };
  const simulation = createLightFallTrails();
  const output = simulation.step(settings, new Uint8Array(100).fill(255), 1);
  assert.equal(output.count, 4);
  assert.deepEqual([...output.intensity.slice(0, 6)], [1, 1, 1, .5, 0, 0]);
  assert.equal(output.bass, 1);
  assert.equal(output.time, .05);
  assert.ok([...output.tailLength.slice(0, 4)].every(value => value <= .95));
  const silent = simulation.step(settings, new Uint8Array(), 1 / 60);
  assert.equal(silent.bass, 0);
  assert.ok(silent.slowEnergy.every(Number.isFinite));
  assert.equal(bendUv(200), 92.75 / (92.75 + 100 * Math.PI + .1));
  for (const radius of [1, 10, 200, 250]) assert.ok(bendUv(radius) > 0 && bendUv(radius) < 1);
});

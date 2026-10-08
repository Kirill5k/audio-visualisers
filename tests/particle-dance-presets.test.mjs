import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, DEFAULT_PRESET_ID } from '../js/particle-dance/particle-dance-presets.js';
import { createSettings, PARTICLE_CONTROLS } from '../js/particle-dance/particle-dance-settings.js';
import { resolveEffectOrder } from '../js/particle-dance/particle-dance-effect-settings.js';

test('six source variants retain registry order and the linked third variant is the default', () => {
  assert.deepEqual(PRESETS.map(preset => preset.id), [
    'config-1770146293356-684', 'config-1770160427378-550', 'config-1770417368156-780',
    'config-1770774636923-484', 'config-1783476441662-679', 'config-1785033162129-22',
  ]);
  assert.equal(DEFAULT_PRESET_ID, PRESETS[2].id);
  PRESETS.forEach((preset, i) => assert.equal(preset.name, `Particle Dance Variant #${i + 1}`));
  assert.equal(Object.keys(PARTICLE_CONTROLS).length, 18);
});

test('linked sparse preset inherits source defaults and the complete effect registry order', () => {
  const settings = createSettings();
  assert.equal(settings.particleCount, 2000);
  assert.equal(settings.particleSize, .35);
  assert.equal(settings.audioSizeReactivity, 2.9);
  assert.equal(settings.damping, .565);
  assert.equal(settings.fftSize, 1024);
  assert.equal(settings.spectrumCap, .35);
  assert.equal(settings.sensitivity, 5);
  assert.equal(settings.backgroundType, 'solid');
  assert.equal(settings.cameraState.position.x, -2.371686);
  assert.deepEqual(settings.cameraState.quaternion, [.232553, .741129, .544463, -.316554]);
  assert.deepEqual(resolveEffectOrder(settings), ['barrelDistortion', 'tiltShift', 'bleachBypass']);
});

test('preset loads reset effects and own independent nested camera, order and modulation data', () => {
  const modified = createSettings();
  modified.cameraState.position.x = 99;
  modified.effectOrder.reverse();
  modified.controlModulations.damping = { enabled: true };
  const clean = createSettings();
  assert.equal(clean.cameraState.position.x, -2.371686);
  assert.equal(clean.effectOrder[0], 'feedback');
  assert.deepEqual(clean.controlModulations, {});
  const historical = createSettings(PRESETS[0].id);
  assert.equal(historical.enablePostProcessing, false);
  assert.deepEqual(resolveEffectOrder(historical), []);
  assert.throws(() => createSettings('missing'), /Unknown Particle Dance preset/);
});

test('all preset particle controls and cameras have finite usable values', () => {
  for (const preset of PRESETS) {
    const settings = createSettings(preset.id);
    for (const [key, control] of Object.entries(PARTICLE_CONTROLS)) {
      if (control.type === 'number') assert.ok(Number.isFinite(settings[key]), `${preset.name}: ${key}`);
      else assert.equal(typeof settings[key], control.type === 'color' ? 'string' : 'boolean');
    }
    assert.equal(settings.cameraState.quaternion.length, 4);
    assert.ok(settings.cameraState.quaternion.every(Number.isFinite));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS, DEFAULT_PRESET_ID } from '../js/dot-grid/dot-grid-presets.js';
import { createSettings, DOT_GRID_CONTROLS, LOOM_CONTROLS } from '../js/dot-grid/dot-grid-settings.js';
import { resolveEffectOrder } from '../js/particle-dance/particle-dance-effect-settings.js';

test('the linked source preset opens the original 64 × 64 grid with its saved camera', () => {
  const settings = createSettings();
  assert.equal(DEFAULT_PRESET_ID, 'config-1766283127041-472');
  assert.equal(settings.gridWidth, 64);
  assert.equal(settings.gridHeight, 64);
  assert.equal(settings.dotSize, .02);
  assert.equal(settings.spacing, .4);
  assert.equal(settings.maxScale, 4.5);
  assert.equal(settings.colorReactivity, 1);
  assert.equal(settings.dotColor, '#aa4444');
  assert.equal(settings.fftSize, 16384);
  assert.deepEqual(settings.cameraState.position, { x: 0, y: 22.367304, z: -.000022 });
  assert.deepEqual(settings.cameraState.quaternion, [.001517, .707106, .707105, -.001517]);
  // Historical source presets retain dormant effect values without enabling them.
  assert.equal(settings.enablePostProcessing, false);
  assert.deepEqual(resolveEffectOrder(settings), []);
});

test('switching variants resets sparse fields and isolates nested camera, order and modulation settings', () => {
  const changed = createSettings(PRESETS[2].id);
  changed.cameraState.position.y = 999;
  changed.cameraState.quaternion[0] = 999;
  changed.effectOrder.push('ascii');
  changed.controlModulations.spiralIntensity.amount = 999;
  const clean = createSettings(PRESETS[2].id);
  assert.equal(clean.cameraState.position.y, -1.362505);
  assert.equal(clean.cameraState.quaternion[0], .014203);
  assert.equal(clean.effectOrder.includes('ascii'), false);
  assert.equal(clean.controlModulations.spiralIntensity.amount, 1);
  const initial = createSettings();
  assert.equal(initial.sphereIntensity, 0);
  assert.equal(initial.radialMode, false);
  assert.equal(initial.waveDelay, 0);
  assert.equal(initial.feedback_enabled, false);
  assert.deepEqual(initial.controlModulations, {});
});

test('all seven source variants resolve every grid control to usable values', () => {
  assert.equal(PRESETS.length, 7);
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, 7);
  for (const preset of PRESETS) {
    const settings = createSettings(preset.id);
    for (const [key, control] of Object.entries(DOT_GRID_CONTROLS)) {
      if (control.type === 'number') {
        assert.ok(Number.isFinite(settings[key]), `${preset.name}: ${key}`);
        assert.ok(settings[key] >= control.min && settings[key] <= control.max, `${preset.name}: ${key} outside control range`);
      } else if (control.type === 'select') assert.ok(Object.values(control.options).includes(settings[key]), `${preset.name}: invalid ${key}`);
      else assert.equal(typeof settings[key], control.type === 'color' ? 'string' : 'boolean');
    }
    assert.equal(settings.scrollingSpectrum, false);
    assert.ok(settings.cameraState.quaternion.every(Number.isFinite));
    assert.ok(Object.values(settings.cameraState.position).every(Number.isFinite));
  }
  assert.throws(() => createSettings('missing'), /Unknown Dot Grid preset/);
});

test('Scrolling Spectrum Mode provides complete isolated controls without changing the source presets', () => {
  assert.equal(DOT_GRID_CONTROLS.scrollingSpectrum.type, 'boolean');
  assert.equal(DOT_GRID_CONTROLS.scrollingSpectrum.label, 'Scrolling Spectrum Mode');
  const settings = createSettings();
  assert.equal(settings.scrollingSpectrum, false);
  assert.equal(settings.gridWidth, 64);
  assert.equal(settings.gridHeight, 64);
  assert.equal(settings.loomHorizontal, false);
  assert.equal(settings.loomGain, 1.3);
  assert.equal(settings.loomPersistence, 1);
  assert.equal(settings.loomBrightness, 1);
  for (const [key, control] of Object.entries(LOOM_CONTROLS)) {
    if (control.type === 'number') {
      assert.ok(Number.isFinite(settings[key]), key);
      assert.ok(settings[key] >= control.min && settings[key] <= control.max, `${key} outside control range`);
    } else assert.equal(typeof settings[key], control.type === 'color' ? 'string' : 'boolean');
  }
  assert.deepEqual(settings.controlModulations, {});
  assert.equal(settings.enablePostProcessing, false);
  assert.ok(settings.cameraState.position.y > 0);
  assert.ok(settings.cameraState.quaternion.every(Number.isFinite));
  settings.cameraState.position.y = 999;
  settings.loomHorizontal = true;
  settings.loomGain = 0;
  settings.scrollingSpectrum = true;
  const clean = createSettings();
  assert.notEqual(clean.cameraState.position.y, 999);
  assert.equal(clean.loomHorizontal, false);
  assert.equal(clean.loomGain, 1.3);
  assert.equal(clean.scrollingSpectrum, false);
});

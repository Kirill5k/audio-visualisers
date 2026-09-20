import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS, DEFAULT_PRESET_ID } from '../js/mesh-grid/mesh-grid-presets.js';
import {
  createSettings,
  MESH_CONTROLS,
  GLOBAL_DEFAULTS,
} from '../js/mesh-grid/mesh-grid-settings.js';
import { resolveEffectOrder } from '../js/mesh-grid/mesh-grid-effect-settings.js';

test('all 16 Mesh Grid variants preserve the current source UI order and stable IDs', () => {
  assert.equal(PRESETS.length, 16);
  assert.equal(new Set(PRESETS.map((preset) => preset.id)).size, 16);
  assert.deepEqual(
    PRESETS.map((preset) => preset.id),
    [
      'config-1741367309222-608',
      'config-1785030020745-582',
      'config-1785194067514-982',
      'config-1785005233398-8',
      'config-1785021591627-524',
      'config-1785007646472-485',
      'config-1740884813034-660',
      'config-1770772969796-306',
      'config-1770775205855-545',
      'config-1770951881130-725',
      'config-1771357737340-827',
      'config-1771264889154-560',
      'config-1784991574704-275',
      'config-1784990794004-896',
      'config-1784995830315-335',
      'config-1788733342537-16',
    ],
  );
  PRESETS.forEach((preset, index) => assert.equal(preset.name, `Mesh Grid Variant #${index + 1}`));
  assert.equal(PRESETS[5].id, DEFAULT_PRESET_ID);
});

test('linked preset resolves sparse source fields against actual upstream defaults', () => {
  const settings = createSettings();
  assert.equal(settings.gridSizeX, 177);
  assert.equal(settings.gridSizeY, 177);
  assert.equal(settings.sensitivity, 5);
  assert.equal(settings.waveComplexity, 1);
  assert.equal(settings.colorReactivity, 1);
  assert.equal(settings.fftSize, 16384);
  assert.equal(settings.flowMix, 0.6);
  assert.equal(settings.spectrumSpiral, 0.72);
  assert.equal(settings.dotSize, 1);
  assert.equal(settings.dotGlow, 1);
  assert.equal(settings.cameraState.position.x, 78.141602);
  assert.deepEqual(settings.cameraState.quaternion, [-0.258965, 0.500475, 0.159911, 0.810488]);
  assert.deepEqual(resolveEffectOrder(settings), ['gammaCorrection', 'feedback', 'concentricTile']);
});

test('loading another variant clears prior effects and modulation configuration', () => {
  const previous = createSettings();
  previous.gammaCorrection_hueSpeed = 9;
  previous.controlModulations.radialMix.amount = 99;
  const quiet = createSettings(PRESETS[0].id);
  assert.equal(quiet.enablePostProcessing, false);
  assert.equal(quiet.feedback_enabled, false);
  assert.deepEqual(quiet.controlModulations, {});
  assert.notEqual(quiet.gammaCorrection_hueSpeed, 9);
  assert.equal(createSettings().controlModulations.radialMix.amount, 2.2);
});

test('settings and nested camera/order/modulation objects are independent copies', () => {
  const first = createSettings();
  const second = createSettings();
  first.cameraState.position.x = 0;
  first.cameraState.quaternion[0] = 0;
  first.effectOrder.push('ascii');
  first.controlModulations.perlinNoiseIntensity.enabled = false;
  assert.equal(second.cameraState.position.x, 78.141602);
  assert.equal(second.cameraState.quaternion[0], -0.258965);
  assert.deepEqual(second.effectOrder, ['gammaCorrection']);
  assert.equal(second.controlModulations.perlinNoiseIntensity.enabled, true);
  assert.equal(PRESETS[5].data.cameraState.position.x, 78.141602);
});

test('global postprocessing gate still applies to historical sparse presets', () => {
  const historical = createSettings('config-1770772969796-306');
  assert.equal(historical.gridTile_enabled, true);
  assert.equal(historical.enablePostProcessing, false);
  assert.deepEqual(resolveEffectOrder(historical), []);
});

test('all mesh controls and saved camera records remain finite and usable', () => {
  assert.equal(Object.keys(MESH_CONTROLS).length, 29);
  assert.deepEqual(
    Object.entries(MESH_CONTROLS)
      .filter(([, control]) => control.structural)
      .map(([key]) => key),
    ['gridSizeX', 'gridSizeY'],
  );
  assert.equal(GLOBAL_DEFAULTS.smoothingTimeConstant, 0.75);
  for (const preset of PRESETS) {
    const settings = createSettings(preset.id);
    for (const [key, control] of Object.entries(MESH_CONTROLS)) {
      assert.equal(
        typeof settings[key],
        control.type === 'color' ? 'string' : control.type === 'boolean' ? 'boolean' : 'number',
        `${preset.name}: ${key}`,
      );
      if (control.type === 'number')
        assert.ok(Number.isFinite(settings[key]), `${preset.name}: ${key}`);
    }
    assert.equal(settings.cameraState.quaternion.length, 4);
    assert.ok(settings.cameraState.quaternion.every(Number.isFinite));
  }
  assert.throws(() => createSettings('missing'), /Unknown Mesh Grid preset/);
});

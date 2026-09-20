import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_ORDER, GRADIENT_PALETTES,
  resolveEffectOrder, effectiveTileCount, feedbackFrameUniforms,
} from '../js/mesh-grid/mesh-grid-effect-settings.js';

// In the linked variant Color Tone appears in the explicit order, but the
// enabled Echo Trails and Concentric Tile passes are omitted from that list.
test('enabled effects omitted from the explicit order retain registry order', () => {
  assert.deepEqual(resolveEffectOrder({
    enablePostProcessing: true,
    effectOrder: ['barrelDistortion', 'gammaCorrection'],
    gammaCorrection_enabled: true,
    feedback_enabled: true,
    concentricTile_enabled: true,
  }), ['gammaCorrection', 'feedback', 'concentricTile']);
});

test('effect ordering ignores unsupported, duplicate, and disabled entries', () => {
  assert.deepEqual(resolveEffectOrder({
    enablePostProcessing: true,
    effectOrder: ['sepia', 'sepia', 'unknown', 'crt'],
    sepia_enabled: true,
    crt_enabled: false,
    gradientMap_enabled: true,
  }), ['sepia', 'gradientMap']);
  assert.deepEqual(resolveEffectOrder({ sepia_enabled: true }), []);
  assert.deepEqual(resolveEffectOrder({ enablePostProcessing: true, effectOrder: null }), []);
});

test('all fourteen effect definitions have complete independent flat defaults', () => {
  assert.equal(EFFECT_ORDER.length, 14);
  for (const [effect, controls] of Object.entries(EFFECT_CONTROLS)) {
    for (const [key, control] of Object.entries(controls)) {
      assert.equal(EFFECT_DEFAULTS[`${effect}_${key}`], control.default);
      if (control.type === 'number') {
        assert.ok(control.default >= control.min && control.default <= control.max, `${effect}_${key}`);
      }
      if (control.type === 'select') assert.ok(Object.values(control.options).includes(control.default));
    }
  }
  assert.equal(EFFECT_DEFAULTS.gammaCorrection_gamma, 0.77);
  assert.equal(EFFECT_DEFAULTS.feedback_decay, 0.9);
  assert.equal(EFFECT_DEFAULTS.ledScreen_cellSize, 10);
  for (const palette of Object.values(GRADIENT_PALETTES)) assert.ok(palette.length >= 2 && palette.length <= 4);
});

test('feedback compensates decay, injection, transforms, and hue for frame duration', () => {
  const settings = {
    feedback_decay: 0.85, feedback_zoom: 1.01, feedback_rotate: 60,
    feedback_offsetX: 0.3, feedback_offsetY: -0.15, feedback_hueShift: 180,
    feedback_blendMode: 'add',
  };
  const one = feedbackFrameUniforms(settings, 1 / 60);
  const two = feedbackFrameUniforms(settings, 1 / 30);
  assert.equal(one.injectFrame, 1);
  assert.equal(two.blendModeInt, 1);
  assert.ok(Math.abs(two.decayFrame - one.decayFrame ** 2) < 1e-12);
  assert.ok(Math.abs(two.injectFrame - (1 + one.decayFrame)) < 1e-12);
  assert.equal(two.zoomFrame, one.zoomFrame ** 2);
  assert.equal(two.rotateFrame, 2 * one.rotateFrame);
  assert.deepEqual(two.offsetFrame, one.offsetFrame.map(value => 2 * value));
  assert.equal(two.hueFrame, 2 * one.hueFrame);
});

test('feedback at full persistence and at a frozen clock remains finite', () => {
  const full = feedbackFrameUniforms({ feedback_decay: 1 }, 1 / 30);
  assert.equal(full.injectFrame, 2);
  assert.equal(full.decayFrame, 1);
  const zero = feedbackFrameUniforms({}, 0);
  assert.equal(zero.injectFrame, 0);
  assert.equal(zero.decayFrame, 1);
  assert.equal(zero.zoomFrame, 1);
  assert.deepEqual(zero.offsetFrame, [0, 0]);
});

test('grid tile counts scale with the render surface and respect configured maximum', () => {
  assert.equal(effectiveTileCount(8, 800, 1600), 4);
  assert.equal(effectiveTileCount(8, 1920, 1600), 8);
  assert.equal(effectiveTileCount(8, 10, 1600), 1);
  assert.equal(effectiveTileCount(6, 450, 900), 3);
});

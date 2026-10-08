import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_ORDER, EFFECT_NAMES, resolveEffectOrder,
} from '../js/particle-dance/particle-dance-effect-settings.js';
import {
  EFFECT_CONTROLS as LEGACY_CONTROLS, EFFECT_ORDER as LEGACY_ORDER,
  resolveEffectOrder as resolveLegacyOrder,
} from '../js/mesh-grid/mesh-grid-effect-settings.js';
import { createGrainTimeline, effectClockRate, EFFECT_ENUMS } from '../js/particle-dance/particle-dance-effect-dynamics.js';

test('Particle Dance extends the source registry without changing Mesh Grid defaults', () => {
  assert.equal(EFFECT_ORDER.length, 32);
  assert.equal(LEGACY_ORDER.length, 14);
  assert.equal(new Set(EFFECT_ORDER).size, 32);
  for (const effect of LEGACY_ORDER) assert.equal(EFFECT_CONTROLS[effect], LEGACY_CONTROLS[effect]);
  const settings = { enablePostProcessing: true, barrelDistortion_enabled: true, rgbShift_enabled: true };
  assert.deepEqual(resolveEffectOrder(settings), ['barrelDistortion', 'rgbShift']);
  assert.deepEqual(resolveLegacyOrder(settings), []);
  for (const effect of EFFECT_ORDER) {
    assert.ok(EFFECT_NAMES[effect]);
    assert.equal(EFFECT_DEFAULTS[`${effect}_enabled`], false);
    for (const [key, control] of Object.entries(EFFECT_CONTROLS[effect])) {
      assert.equal(EFFECT_DEFAULTS[`${effect}_${key}`], control.default);
      if (control.type === 'number') {
        assert.ok(control.default >= control.min && control.default <= control.max, `${effect}_${key}`);
      } else if (control.type === 'select') {
        assert.ok(Object.values(control.options).includes(control.default), `${effect}_${key}`);
      }
    }
  }
});

test('sparse Particle Dance presets preserve master enable and source effect ordering', () => {
  // Variants 1 and 2 store enabled effects but omit the false-by-default master.
  assert.deepEqual(resolveEffectOrder({ barrelDistortion_enabled: true, bleachBypass_enabled: true }), []);
  const enabled = names => Object.fromEntries(names.map(name => [`${name}_enabled`, true]));
  const resolve = (names, order) => resolveEffectOrder({
    enablePostProcessing: true, ...enabled(names), ...(order ? { effectOrder: order } : {}),
  });
  assert.deepEqual(resolve(['bleachBypass', 'tiltShift', 'barrelDistortion']),
    ['barrelDistortion', 'tiltShift', 'bleachBypass']);
  assert.deepEqual(resolve(['barrelDistortion', 'radialBlur', 'rgbShift', 'gammaCorrection', 'gradientMap'],
    ['barrelDistortion', 'radialBlur', 'rgbShift']),
    ['barrelDistortion', 'radialBlur', 'rgbShift', 'gradientMap', 'gammaCorrection']);
  assert.deepEqual(resolve(['gradientMap', 'concentricTile'], []), ['gradientMap', 'concentricTile']);
  const sixth = ['kaleidoscope', 'gradientMap', 'gammaCorrection', 'concentricTile'];
  assert.deepEqual(resolve(sixth, sixth), sixth);
  assert.deepEqual(resolve(['rgbShift'], ['unknown', 'rgbShift', 'rgbShift']), ['rgbShift']);
});

test('effect clock rates preserve source frame normalization and reflection speed', () => {
  assert.equal(effectClockRate('film'), 1.2);
  assert.equal(effectClockRate('waterDistortion'), 1.2);
  assert.equal(effectClockRate('ripple'), 1.92);
  assert.equal(effectClockRate('reflection', 0), 0);
  assert.equal(effectClockRate('reflection', 2.5), 4.8);
});

test('animated grain resets exactly, stays frozen at zero delta and isolates instances', () => {
  const first = createGrainTimeline(), other = createGrainTimeline();
  assert.deepEqual(first.advance(0), { indexA: 0, indexB: 7, phase: 0 });
  const run = () => Array.from({ length: 120 }, () => first.advance(1 / 60));
  const reference = run();
  const end = first.advance(0);
  assert.deepEqual(first.advance(0), end);
  assert.deepEqual(first.advance(-1), end);
  assert.deepEqual(first.advance(NaN), end);
  assert.deepEqual(other.advance(0), { indexA: 0, indexB: 7, phase: 0 });
  first.reset();
  assert.deepEqual(run(), reference);
  for (const state of reference) {
    assert.ok(state.phase >= 0 && state.phase < 1);
    assert.equal(state.indexB, (state.indexA + 7) % 16);
  }
});

test('every source effect enum option has a numeric shader mapping', () => {
  for (const [effect, mappings] of Object.entries(EFFECT_ENUMS)) {
    for (const [control, mapping] of Object.entries(mappings)) {
      for (const value of Object.values(EFFECT_CONTROLS[effect][control].options)) {
        assert.ok(Number.isInteger(mapping.values[value]), `${effect}_${control}: ${value}`);
      }
    }
  }
});

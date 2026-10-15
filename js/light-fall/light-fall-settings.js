/**
 * Light Fall adapted from Vizz.fm with the author’s permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-d2d9ec860a756c37.js
 * Source SHA-256: b5a11ca462673f6660f4a9cec6a3f551f0df9a874e8fe2897e67c2cad55cb416
 * Retrieved 2026-10-12. No additional license is granted.
 */

import { PRESETS, DEFAULT_PRESET_ID } from './light-fall-presets.js';
import { GLOBAL_CONTROLS as SHARED_CONTROLS, GLOBAL_DEFAULTS as SHARED_DEFAULTS } from '../mesh-grid/mesh-grid-settings.js';
import { EFFECT_DEFAULTS, EFFECT_ORDER } from '../particle-dance/particle-dance-effect-settings.js';

export const LIGHT_FALL_CONTROLS = {
  "trailCount": {
    "type": "number",
    "label": "Trail Count",
    "min": 1,
    "max": 700,
    "step": 1,
    "default": 100
  },
  "trailSpread": {
    "type": "number",
    "label": "Spread",
    "min": 0.25,
    "max": 6,
    "step": 0.05,
    "default": 1
  },
  "trailBrightness": {
    "type": "number",
    "label": "Trail Brightness",
    "min": 0.1,
    "max": 5,
    "step": 0.05,
    "default": 4
  },
  "speedMultiplier": {
    "type": "number",
    "label": "Speed",
    "min": 0,
    "max": 1,
    "step": 0.01,
    "default": 0.1
  },
  "inverseMotion": {
    "type": "boolean",
    "label": "Inverse Motion",
    "default": false
  },
  "audioReactivity": {
    "type": "number",
    "label": "Audio Reactivity",
    "min": 0,
    "max": 3,
    "step": 0.05,
    "default": 0
  },
  "audioColorShift": {
    "type": "number",
    "label": "Audio Color Shift",
    "min": 0,
    "max": 1,
    "step": 0.01,
    "default": 0
  },
  "dotDensity": {
    "type": "number",
    "label": "Dot Density",
    "min": 10,
    "max": 100,
    "step": 1,
    "default": 70
  },
  "dotSize": {
    "type": "number",
    "label": "Dot Size",
    "min": 0.05,
    "max": 0.5,
    "step": 0.01,
    "default": 0.25
  },
  "dotSpeed": {
    "type": "number",
    "label": "Dot Speed",
    "min": 0.5,
    "max": 3,
    "step": 0.05,
    "default": 1.5
  },
  "arcRadius": {
    "type": "number",
    "label": "Arc Radius",
    "min": 1,
    "max": 250,
    "step": 1,
    "default": 10
  },
  "pathMeander": {
    "type": "number",
    "label": "Path Meander",
    "min": 0,
    "max": 25,
    "step": 0.25,
    "default": 0
  },
  "color0": {
    "type": "color",
    "label": "Color",
    "default": "#004c94"
  }
};

export const GLOBAL_CONTROLS = {
  ...SHARED_CONTROLS,
  backgroundAudioReactivity: { ...SHARED_CONTROLS.backgroundAudioReactivity, max: 10 },
  antiAliasing: { type: 'boolean', label: 'Anti-aliasing', default: false, group: 'Rendering' },
  renderScale: { type: 'number', label: 'Render Scale', min: .25, max: 2, step: .05, default: 1, group: 'Rendering' },
};
export const GLOBAL_DEFAULTS = { ...SHARED_DEFAULTS, visualizationType: 'light-trails' };
export const LIGHT_FALL_DEFAULTS = Object.fromEntries(Object.entries(LIGHT_FALL_CONTROLS).map(([key, control]) => [key, control.default]));

/** Sparse source presets always start from a fresh complete state. */
export function createSettings(presetId = DEFAULT_PRESET_ID) {
  const preset = PRESETS.find(item => item.id === presetId);
  if (!preset) throw new RangeError('Unknown Light Fall preset: ' + presetId);
  return structuredClone({
    ...GLOBAL_DEFAULTS, ...LIGHT_FALL_DEFAULTS, ...EFFECT_DEFAULTS,
    effectOrder: [...EFFECT_ORDER], controlModulations: {}, ...preset.data,
  });
}

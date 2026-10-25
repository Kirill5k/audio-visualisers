/**
 * Dot Grid adapted from Vizz.fm with the author's permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/9583-5bcee8001b3090e9.js
 * Source SHA-256: 049859defa821b49da55dd5e2aa55a68489e73c1bd528081dd1507ba80971cc9
 * Retrieved 2026-10-25. No additional license is granted.
 */

import { PRESETS, DEFAULT_PRESET_ID } from './dot-grid-presets.js';
import { GLOBAL_CONTROLS as SHARED_CONTROLS, GLOBAL_DEFAULTS as SHARED_DEFAULTS } from '../mesh-grid/mesh-grid-settings.js';
import { EFFECT_DEFAULTS, EFFECT_ORDER } from '../particle-dance/particle-dance-effect-settings.js';

export const DOT_GRID_CONTROLS = {
  scrollingSpectrum: { type: 'boolean', label: 'Scrolling Spectrum Mode', default: false },
  "dotColor": {
    "type": "color",
    "label": "Dot Color",
    "default": "#00ffff"
  },
  "gridWidth": {
    "type": "number",
    "label": "Grid Width",
    "min": 4,
    "max": 300,
    "step": 1,
    "default": 16,
    "structural": true
  },
  "gridHeight": {
    "type": "number",
    "label": "Grid Height",
    "min": 4,
    "max": 300,
    "step": 1,
    "default": 16,
    "structural": true
  },
  "dotSize": {
    "type": "number",
    "label": "Base Dot Size",
    "min": 0,
    "max": 0.5,
    "step": 0.01,
    "default": 0.1
  },
  "spacing": {
    "type": "number",
    "label": "Spacing",
    "min": 0.2,
    "max": 2,
    "step": 0.1,
    "default": 0.5
  },
  "maxScale": {
    "type": "number",
    "label": "Max Scale",
    "min": 1,
    "max": 10,
    "step": 0.5,
    "default": 4
  },
  "colorReactivity": {
    "type": "number",
    "label": "Color Reactivity",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 0.5
  },
  "radialMode": {
    "type": "boolean",
    "label": "Radial Mode",
    "default": false
  },
  "symmetricMode": {
    "type": "boolean",
    "label": "Symmetric Mode",
    "default": false
  },
  "mirrorY": {
    "type": "boolean",
    "label": "Mirror Y Only",
    "default": false
  },
  "trailIntensity": {
    "type": "number",
    "label": "Trail Intensity",
    "min": 0,
    "max": 0.95,
    "step": 0.05,
    "default": 0.5
  },
  "spiralIntensity": {
    "type": "number",
    "label": "Spiral Intensity",
    "min": 0,
    "max": 3,
    "step": 0.05,
    "default": 0
  },
  "symmetry": {
    "type": "number",
    "label": "Symmetry",
    "min": 1,
    "max": 8,
    "step": 1,
    "default": 1
  },
  "waveDelay": {
    "type": "number",
    "label": "Wave Delay",
    "min": 0,
    "max": 3,
    "step": 0.05,
    "default": 0
  },
  "heightDisplacement": {
    "type": "number",
    "label": "Height Displacement",
    "min": 0,
    "max": 5,
    "step": 0.1,
    "default": 0.1
  },
  "terrainSmoothing": {
    "type": "number",
    "label": "Terrain Smoothing",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 1
  },
  "waveModulation": {
    "type": "number",
    "label": "Wave Modulation",
    "min": 0,
    "max": 2,
    "step": 0.1,
    "default": 2
  },
  "sphereIntensity": {
    "type": "number",
    "label": "Sphere Intensity",
    "min": 0,
    "max": 1,
    "step": 0.01,
    "default": 0
  }
};

/** Local spectrum-history mode, reusing LED Grid's calibrated analysis. */
export const LOOM_CONTROLS = {
  loomHorizontal: { type: 'boolean', label: 'Horizontal scrolling', default: false },
  loomGain: { type: 'number', label: 'Spectrum gain', min: 0, max: 4, step: .05, default: 1.3 },
  loomPersistence: { type: 'number', label: 'History persistence', min: .15, max: 3, step: .05, default: 1 },
  loomBrightness: { type: 'number', label: 'Light level', min: 0, max: 3, step: .05, default: 1 },
  loomViolet: { type: 'color', label: 'Violet', default: '#7446ff' },
  loomBlue: { type: 'color', label: 'Blue', default: '#2f5bff' },
  loomAmber: { type: 'color', label: 'Amber', default: '#ffa53d' },
  loomWhite: { type: 'color', label: 'Peak white', default: '#fff1d0' },
};
export const LOOM_DEFAULTS = Object.fromEntries(Object.entries(LOOM_CONTROLS).map(([key, control]) => [key, control.default]));

export const GLOBAL_CONTROLS = {
  ...SHARED_CONTROLS,
  backgroundAudioReactivity: { ...SHARED_CONTROLS.backgroundAudioReactivity, max: 10 },
  antiAliasing: { type: 'boolean', label: 'Anti-aliasing', default: false, group: 'Rendering' },
  renderScale: { type: 'number', label: 'Render Scale', min: .25, max: 2, step: .05, default: 1, group: 'Rendering' },
};
export const GLOBAL_DEFAULTS = { ...SHARED_DEFAULTS, visualizationType: 'dot-grid' };
export const DOT_GRID_DEFAULTS = Object.fromEntries(Object.entries(DOT_GRID_CONTROLS).map(([key, control]) => [key, control.default]));

/** Sparse source presets always start from a fresh complete state. */
export function createSettings(presetId = DEFAULT_PRESET_ID) {
  const preset = PRESETS.find(item => item.id === presetId);
  if (!preset) throw new RangeError('Unknown Dot Grid preset: ' + presetId);
  return structuredClone({
    ...GLOBAL_DEFAULTS, ...DOT_GRID_DEFAULTS, ...LOOM_DEFAULTS, ...EFFECT_DEFAULTS,
    effectOrder: [...EFFECT_ORDER], controlModulations: {}, ...preset.data,
  });
}

/* Particle Dance adapted with the author's permission from vizz.fm.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source release 6283820, retrieved 2026-10-08. No additional license granted.
 * https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 */

import { PRESETS, DEFAULT_PRESET_ID } from './particle-dance-presets.js';
import { GLOBAL_CONTROLS as SHARED_CONTROLS, GLOBAL_DEFAULTS as SHARED_DEFAULTS } from '../mesh-grid/mesh-grid-settings.js';
import { EFFECT_DEFAULTS, EFFECT_ORDER } from './particle-dance-effect-settings.js';

export const PARTICLE_CONTROLS = {
  "particleColor": {
    "type": "color",
    "label": "Particle Color",
    "default": "#ffffff"
  },
  "particleCount": {
    "type": "number",
    "label": "Particle Count",
    "min": 50,
    "max": 2000,
    "step": 10,
    "default": 200
  },
  "particleSize": {
    "type": "number",
    "label": "Particle Size",
    "min": 0.05,
    "max": 0.5,
    "step": 0.01,
    "default": 0.15
  },
  "audioSizeReactivity": {
    "type": "number",
    "label": "Audio Size Reactivity",
    "min": 0,
    "max": 10,
    "step": 0.1,
    "default": 0
  },
  "rainbowAmount": {
    "type": "number",
    "label": "Rainbow Amount",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 0
  },
  "spread": {
    "type": "number",
    "label": "Spread",
    "min": 2,
    "max": 20,
    "step": 0.5,
    "default": 8
  },
  "attractionStrength": {
    "type": "number",
    "label": "Attraction Strength",
    "min": 0,
    "max": 2,
    "step": 0.1,
    "default": 0.5
  },
  "damping": {
    "type": "number",
    "label": "Velocity Damping",
    "min": 0,
    "max": 0.999,
    "step": 0.001,
    "default": 0.98
  },
  "breezeStrength": {
    "type": "number",
    "label": "Breeze Strength",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 0
  },
  "decayRate": {
    "type": "number",
    "label": "Decay Rate",
    "min": 0,
    "max": 2,
    "step": 0.05,
    "default": 1
  },
  "fadeInDuration": {
    "type": "number",
    "label": "Fade In Duration",
    "min": 0,
    "max": 0.5,
    "step": 0.05,
    "default": 0.2
  },
  "showConnections": {
    "type": "boolean",
    "label": "Show Connections",
    "default": true
  },
  "connectionOpacity": {
    "type": "number",
    "label": "Connection Opacity",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 0.3
  },
  "showHotspots": {
    "type": "boolean",
    "label": "Show Hotspots",
    "default": true
  },
  "hotspotCount": {
    "type": "number",
    "label": "Hotspot Count",
    "min": 1,
    "max": 20,
    "step": 1,
    "default": 3
  },
  "hotspotSize": {
    "type": "number",
    "label": "Hotspot Size",
    "min": 0.5,
    "max": 5,
    "step": 0.1,
    "default": 2
  },
  "hotspotIntensity": {
    "type": "number",
    "label": "Hotspot Intensity",
    "min": 0,
    "max": 1,
    "step": 0.05,
    "default": 0.5
  },
  "densityGlow": {
    "type": "boolean",
    "label": "Density Glow",
    "default": true
  }
};

export const GLOBAL_CONTROLS = {
  ...SHARED_CONTROLS,
  backgroundAudioReactivity: { ...SHARED_CONTROLS.backgroundAudioReactivity, max: 10 },
  antiAliasing: { type: 'boolean', label: 'Anti-aliasing', default: false, group: 'Rendering' },
  renderScale: { type: 'number', label: 'Render Scale', min: .25, max: 2, step: .05, default: 1, group: 'Rendering' },
};

export const GLOBAL_DEFAULTS = { ...SHARED_DEFAULTS, visualizationType: 'particleDance' };
export const PARTICLE_DEFAULTS = Object.fromEntries(Object.entries(PARTICLE_CONTROLS).map(([key, control]) => [key, control.default]));

/** Each sparse upstream preset starts from fresh defaults, including nested state. */
export function createSettings(presetId = DEFAULT_PRESET_ID) {
  const preset = PRESETS.find(item => item.id === presetId);
  if (!preset) throw new RangeError('Unknown Particle Dance preset: ' + presetId);
  return structuredClone({ ...GLOBAL_DEFAULTS, ...PARTICLE_DEFAULTS, ...EFFECT_DEFAULTS, effectOrder: [...EFFECT_ORDER], ...preset.data });
}

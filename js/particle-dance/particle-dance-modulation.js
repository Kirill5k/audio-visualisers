/** Slider modulation fields adapted from Vizz.fm's public application, with permission.
 * Copyright (c) 2026 Mathew Preziotte. Retrieved 2026-10-08.
 * https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 * No additional licence is granted.
 */
export const FREQUENCY_RANGES = {
  bass: { label: 'Bass (sub + low)', start: 0, end: .1 },
  lowMid: { label: 'Low-mid', start: .1, end: .25 },
  mid: { label: 'Mid', start: .25, end: .5 },
  highMid: { label: 'High-mid', start: .5, end: .75 },
  treble: { label: 'Treble', start: .75, end: 1 },
  full: { label: 'Full spectrum', start: 0, end: 1 },
};

export const MODULATION_CONTROLS = {
  enabled: { type: 'boolean', label: 'Enabled', default: true },
  mode: { type: 'select', label: 'Mode', default: 'oscillate', options: { Audio: 'audio', Oscillate: 'oscillate', 'Ramp up': 'ramp-up', 'Ramp down': 'ramp-down' } },
  amount: { type: 'number', label: 'Amount', min: 0, max: 5, step: .1, default: 1, mode: 'audio' },
  contrast: { type: 'number', label: 'Contrast', min: .25, max: 4, step: .05, default: 1, mode: 'audio' },
  source: { type: 'select', label: 'Audio source', default: 'amplitude', options: { Amplitude: 'amplitude', 'Flux (onsets)': 'flux', 'Centroid (brightness)': 'centroid', 'Active bands': 'activeBands' }, mode: 'audio' },
  fluxTiming: { type: 'select', label: 'Flux timing', default: 'onset', options: { 'Tight (on-beat)': 'onset', 'Lagged (smoothed)': 'smoothed' }, mode: 'flux' },
  invert: { type: 'boolean', label: 'Invert', default: false, mode: 'audio' },
  anchor: { type: 'select', label: 'Anchor', default: 'slider', options: { 'Slider value': 'slider', 'Min / max': 'range' }, mode: 'audio' },
  attackMs: { type: 'number', label: 'Attack (ms)', min: 0, max: 500, step: 5, default: 10, mode: 'audio' },
  releaseMs: { type: 'number', label: 'Release (ms)', min: 0, max: 2000, step: 10, default: 200, mode: 'audio' },
  speed: { type: 'number', label: 'Period (s)', min: 1, max: 120, step: .5, default: 2, mode: 'temporal' },
  easing: { type: 'select', label: 'Easing', default: 'sine', options: { Linear: 'linear', Sine: 'sine', Cubic: 'cubic', Smootherstep: 'smootherstep' }, mode: 'temporal' },
};

export function createModulation(spec, mode = 'oscillate') {
  return {
    ...Object.fromEntries(Object.entries(MODULATION_CONTROLS).map(([key, control]) => [key, control.default])),
    mode, freqStart: 0, freqEnd: 1, min: spec.min ?? 0, max: spec.max ?? 1,
  };
}

/** A restrained bass envelope around the manual Spread value. */
export function createSpreadAudioModulation(baseSpread, spec) {
  const low = spec.min ?? 2, high = spec.max ?? 20;
  const clamp = value => Math.max(low, Math.min(high, value));
  const base = clamp(Number.isFinite(baseSpread) ? baseSpread : (spec.default ?? 8));
  const step = spec.step > 0 ? spec.step : .5;
  const endpoint = value => clamp(Number((low + Math.round((value - low) / step) * step).toFixed(12)));
  return {
    ...createModulation(spec, 'audio'),
    source: 'amplitude', freqStart: FREQUENCY_RANGES.bass.start, freqEnd: FREQUENCY_RANGES.bass.end,
    anchor: 'range', amount: 1, attackMs: 120, releaseMs: 650,
    min: endpoint(.8 * base), max: endpoint(1.2 * base),
  };
}

/** Toggle the one Spread mapping while retaining the saved manual slider value.
 * Returns the existing/new mapping, or null when disabling an unmapped slider.
 */
export function setSpreadAudioReactive(settings, enabled, spec) {
  const current = settings.controlModulations?.spread;
  if (!enabled) {
    if (current) current.enabled = false;
    return current ?? null;
  }
  settings.controlModulations ||= {};
  const modulation = current?.mode === 'audio' ? current : createSpreadAudioModulation(settings.spread, spec);
  modulation.enabled = true;
  settings.controlModulations.spread = modulation;
  return modulation;
}

/** Editable modulation endpoints stay ordered inside their target's safe range. */
export function setModulationBound(modulation, key, value, spec) {
  if (!['min', 'max'].includes(key) || !Number.isFinite(value)) return false;
  const low = spec.min ?? 0, high = spec.max ?? 1;
  const otherKey = key === 'min' ? 'max' : 'min';
  const other = Math.max(low, Math.min(high, modulation[otherKey] ?? (key === 'min' ? high : low)));
  modulation[key] = key === 'min' ? Math.max(low, Math.min(other, value)) : Math.min(high, Math.max(other, value));
  return true;
}

/** Match Vizz's registry: visualizer sliders and enabled effects, not global/audio controls. */
export function eligibleModulationTargets(particleControls, effectControls, settings, effectNames = {}) {
  const result = Object.fromEntries(Object.entries(particleControls)
    .filter(([, control]) => control.type === 'number' && !control.structural));
  if (settings.enablePostProcessing) {
    for (const [effect, controls] of Object.entries(effectControls)) {
      if (!settings[`${effect}_enabled`]) continue;
      for (const [key, control] of Object.entries(controls)) {
        if (control.type === 'number') result[`${effect}_${key}`] = { ...control, label: `${effectNames[effect] || effect}: ${control.label}` };
      }
    }
  }
  return result;
}

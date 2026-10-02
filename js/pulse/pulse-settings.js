export const PULSE_COLOR_PRESETS = Object.freeze({
  atlas: { name: 'Atlas', colors: { colorLow:'#68c8bd',colorMid:'#e3ad73',colorHigh:'#aaa3d7',colorText:'#eee9df',colorGuides:'#8f999a' } },
  cardiogram: { name: 'Cardiogram', colors: { colorLow:'#4dfbd0',colorMid:'#74e8ad',colorHigh:'#9ff7ff',colorText:'#e0fff6',colorGuides:'#4b8f82' } },
  ocean: { name: 'Ocean', colors: { colorLow:'#70d6ff',colorMid:'#5d9eff',colorHigh:'#b9a7ff',colorText:'#e6f2ff',colorGuides:'#788da5' } },
  ember: { name: 'Ember', colors: { colorLow:'#ffbc72',colorMid:'#ff7e79',colorHigh:'#ffd99e',colorText:'#fff0df',colorGuides:'#aa8d81' } },
  orchid: { name: 'Orchid', colors: { colorLow:'#c6a2ff',colorMid:'#f1a5cd',colorHigh:'#92ceff',colorText:'#f4edff',colorGuides:'#a199b2' } },
});

export const PULSE_TRACE_DEFAULTS = Object.freeze({
  gain:1.15, height:1.9, baseline:-.9, transient:.85,
  waveSmoothness:.1, waveThickness:1.6, waveGlow:.14, head:.98,
});

export const PULSE_CHARTS = Object.freeze({
  'rhythm-lanes': 'Rhythm lanes',
  'energy-ribbons': 'Energy ribbons',
  'timbre-trail': 'Timbre trail',
  'activity-strip': 'Activity strip',
});

export function selectedPulseCharts(settings) {
  const left = Object.hasOwn(PULSE_CHARTS, settings.leftChart) ? settings.leftChart : 'rhythm-lanes';
  const right = Object.hasOwn(PULSE_CHARTS, settings.rightChart) && settings.rightChart !== left
    ? settings.rightChart : Object.keys(PULSE_CHARTS).find(id => id !== left);
  return [left, right];
}

export function matchingPulsePreset(settings) {
  return Object.entries(PULSE_COLOR_PRESETS).find(([, preset]) =>
    Object.entries(preset.colors).every(([key,value]) => String(settings[key]).toLowerCase() === value.toLowerCase()))?.[0] || 'custom';
}

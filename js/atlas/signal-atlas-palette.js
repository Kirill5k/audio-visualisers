// Shared instrument and typography colours. The spectrogram keeps its own LUT.
export const ATLAS_COLORS = Object.freeze({
  black: '#000000',
  white: '#FFFFFF',
  pearl: '#F2F0E8',
  silver: '#A5AFBD',
  ivory: '#D8D0BD',
  copper: '#C58D6B',
  olive: '#A6AC7E',
  amber: '#E8C574',
  coral: '#F07D82',
});

export const ATLAS_COLOR_DEFAULTS = Object.freeze({
  colorPrimary: ATLAS_COLORS.ivory,
  colorAccent: ATLAS_COLORS.copper,
  colorText: ATLAS_COLORS.pearl,
  colorGuides: ATLAS_COLORS.silver,
  colorSpectrogramLow: '#2D0C5F',
  colorSpectrogramMid: '#E65019',
  colorSpectrogramHigh: '#FFFFF0',
});

export const ATLAS_COLOR_PRESETS = Object.freeze({
  original: Object.freeze({ label: 'Original', colors: ATLAS_COLOR_DEFAULTS }),
  ocean: Object.freeze({ label: 'Ocean', colors: Object.freeze({
    colorPrimary: '#BEE9F4',
    colorAccent: '#45A8E6',
    colorText: '#EDF8FC',
    colorGuides: '#86A4B8',
    colorSpectrogramLow: '#082A68',
    colorSpectrogramMid: '#128BC1',
    colorSpectrogramHigh: '#D8FCFF',
  }) }),
  aurora: Object.freeze({ label: 'Aurora', colors: Object.freeze({
    colorPrimary: '#CBF4DB',
    colorAccent: '#63DAB5',
    colorText: '#EFFAF4',
    colorGuides: '#9AB5AD',
    colorSpectrogramLow: '#1B215C',
    colorSpectrogramMid: '#36B8A0',
    colorSpectrogramHigh: '#F0FFE0',
  }) }),
  ember: Object.freeze({ label: 'Ember', colors: Object.freeze({
    colorPrimary: '#F2D6AD',
    colorAccent: '#E99A67',
    colorText: '#FFF3E5',
    colorGuides: '#BFA38D',
    colorSpectrogramLow: '#471A32',
    colorSpectrogramMid: '#DA5A2C',
    colorSpectrogramHigh: '#FFF3B0',
  }) }),
  violet: Object.freeze({ label: 'Violet', colors: Object.freeze({
    colorPrimary: '#E6D6FA',
    colorAccent: '#B693EA',
    colorText: '#F7F1FF',
    colorGuides: '#ACA0BE',
    colorSpectrogramLow: '#291455',
    colorSpectrogramMid: '#805BD7',
    colorSpectrogramHigh: '#F9E7FF',
  }) }),
});

export function atlasColorSetting(settings, key) {
  const value = settings?.[key];
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    ? value.toUpperCase() : ATLAS_COLOR_DEFAULTS[key];
}

export function matchingAtlasColorPreset(settings) {
  const keys = Object.keys(ATLAS_COLOR_DEFAULTS);
  return Object.entries(ATLAS_COLOR_PRESETS).find(([, preset]) =>
    keys.every(key => atlasColorSetting(settings, key) === preset.colors[key]))?.[0] || 'custom';
}

export function resolveAtlasColors(settings) {
  return { ...ATLAS_COLORS,
    ivory: atlasColorSetting(settings, 'colorPrimary'),
    copper: atlasColorSetting(settings, 'colorAccent'),
    pearl: atlasColorSetting(settings, 'colorText'),
    silver: atlasColorSetting(settings, 'colorGuides'),
  };
}

export function paletteRgb(color) {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
}

export function paletteRgba(color, opacity) {
  return `rgba(${paletteRgb(color).map(value => Math.round(value * 255)).join(',')},${opacity})`;
}

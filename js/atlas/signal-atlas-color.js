import { ATLAS_COLOR_DEFAULTS, atlasColorSetting, paletteRgb } from './signal-atlas-palette.js';

// Display-RGB stops from the reference's interactive spectrogram.
export const SPECTROGRAM_STOPS = [
  [0, [4, 3, 12]], [.15, [14, 10, 42]], [.30, [45, 12, 95]],
  [.45, [110, 20, 130]], [.60, [185, 30, 85]], [.75, [230, 80, 25]],
  [.88, [255, 175, 20]], [.96, [255, 235, 80]], [1, [255, 255, 240]],
];

function colorStops(settings) {
  // Adjust the three main colours while retaining the reference gradient's
  // intermediate hues and dark floor. Defaults reproduce every original stop.
  const anchors = [[0, [0, 0, 0]], ...[
    [.30, 'colorSpectrogramLow'], [.75, 'colorSpectrogramMid'], [1, 'colorSpectrogramHigh'],
  ].map(([position, key]) => {
    const original = paletteRgb(ATLAS_COLOR_DEFAULTS[key]);
    const selected = paletteRgb(atlasColorSetting(settings, key));
    return [position, selected.map((value, i) => Math.round(value * 255) - Math.round(original[i] * 255))];
  })];
  return SPECTROGRAM_STOPS.map(([position, color]) => {
    let index = 0;
    while (index < anchors.length - 2 && position > anchors[index + 1][0]) index++;
    const [low, a] = anchors[index], [high, b] = anchors[index + 1];
    const fraction = (position - low) / (high - low);
    return [position, color.map((channel, i) => Math.max(0, Math.min(255,
      Math.round(channel + a[i] + (b[i] - a[i]) * fraction))))];
  });
}

function sampleColor(value, stops) {
  const t = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  let index = 0;
  while (index < stops.length - 2 && t > stops[index + 1][0]) index++;
  const [low, a] = stops[index];
  const [high, b] = stops[index + 1];
  const fraction = (t - low) / (high - low);
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * fraction));
}

export function spectrogramColor(value, settings) {
  return sampleColor(value, settings ? colorStops(settings) : SPECTROGRAM_STOPS);
}

export function createSpectrogramPalette(settings) {
  const stops = settings ? colorStops(settings) : SPECTROGRAM_STOPS;
  const data = new Uint8Array(1024 * 4);
  for (let i = 0; i < 1024; i++) {
    data.set(sampleColor(i / 1023, stops), i * 4);
    data[i * 4 + 3] = 255;
  }
  return data;
}

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

export function paletteRgb(color) {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
}

export function paletteRgba(color, opacity) {
  return `rgba(${paletteRgb(color).map(value => Math.round(value * 255)).join(',')},${opacity})`;
}

// Display-RGB stops from the reference's interactive spectrogram.
export const SPECTROGRAM_STOPS = [
  [0, [4, 3, 12]], [.15, [14, 10, 42]], [.30, [45, 12, 95]],
  [.45, [110, 20, 130]], [.60, [185, 30, 85]], [.75, [230, 80, 25]],
  [.88, [255, 175, 20]], [.96, [255, 235, 80]], [1, [255, 255, 240]],
];

export function spectrogramColor(value) {
  const t = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  let index = 0;
  while (index < SPECTROGRAM_STOPS.length - 2 && t > SPECTROGRAM_STOPS[index + 1][0]) index++;
  const [low, a] = SPECTROGRAM_STOPS[index];
  const [high, b] = SPECTROGRAM_STOPS[index + 1];
  const fraction = (t - low) / (high - low);
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * fraction));
}

export function createSpectrogramPalette() {
  const data = new Uint8Array(1024 * 4);
  for (let i = 0; i < 1024; i++) {
    data.set(spectrogramColor(i / 1023), i * 4);
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** Frequency mapping shared by the live crest and its GPU history field. */
export const FREQUENCY_CURVE = 2.32;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function sampleShaped(data, u, { minFrequency, maxFrequency, nyquist, gain }) {
  const frequency = minFrequency + (maxFrequency - minFrequency)
    * Math.pow(clamp(u, 0, 1), FREQUENCY_CURVE);
  // A linearly filtered texture's sample coordinates address texel centers.
  const position = clamp(frequency / nyquist * data.length - .5, 0, data.length - 1);
  const left = Math.floor(position);
  const right = Math.min(left + 1, data.length - 1);
  const raw = (data[left] + (data[right] - data[left]) * (position - left)) / 255;
  return Math.pow(clamp(Math.pow(raw, 1.18) * gain, 0, 1), 1.55);
}

/**
 * Sample an active byte spectrum. Pass only fftSize / 2 entries, rather than
 * the analyser's potentially larger reusable buffer capacity.
 * Smooth the shaped heights so the CPU crest and GPU history agree.
 */
export function sampleSpectrum(data, u, settings, smoothness = 0) {
  if (data.length === 0) return 0;
  const radius = Math.max(0, smoothness) * .012;
  if (radius === 0) return sampleShaped(data, u, settings);

  let height = 0;
  for (let offset = -2; offset <= 2; offset++) {
    height += sampleShaped(data, u + offset * radius, settings) * (3 - Math.abs(offset));
  }
  return height / 9;
}

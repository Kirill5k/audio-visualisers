/** Pure audio-time patterns. Nothing here depends on prior render calls. */
import { writeCalligraphy } from './led-calligraphy-pattern.js';
import { writeChoreography } from './led-choreography-pattern.js';
export const LED_COLUMNS = 96;
export const LED_ROWS = 54;
export const LED_COUNT = LED_COLUMNS * LED_ROWS;

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const feature = value => clamp(Number(value) || 0);
const empty = new Float32Array(LED_COUNT);
const writers = { calligraphy: writeCalligraphy, choreography: writeChoreography };

/** Four floats per diode: emitted energy, cool mix, amber mix, peak whiteness. */
export function evaluateLEDPattern(data = {}, settings = {}, output = new Float32Array(LED_COUNT * 4)) {
  const time = Math.max(0, Number(data.time) || 0);
  const gain = Math.max(0, Number.isFinite(Number(settings.gain)) ? Number(settings.gain) : 1.3);
  const persistence = clamp(Number(settings.persistence) || 1, .15, 3);
  const history = data.history || empty;
  const mode = Object.hasOwn(writers, settings.mode) ? settings.mode : 'loom';
  if (mode !== 'loom') {
    writers[mode](data, settings, output);
  } else {
    for (let row = 0; row < LED_ROWS; row++) {
      for (let column = 0; column < LED_COLUMNS; column++) {
        const index = row * LED_COLUMNS + column;
        let intensity = 0, cool = .4, warm = 0, peak = 0;
        // The newest history row is physically at the bottom of the panel.
        const age = row / (LED_ROWS - 1);
        const value = feature(history[index]);
        const previous = feature(history[Math.min(LED_ROWS - 1, row + 1) * LED_COLUMNS + column]);
        const onset = Math.max(0, value - previous);
        const weight = Math.pow(Math.max(0, value - .11), 1.45);
        intensity = weight * 2.5 * Math.exp(-age / (3.25 * persistence)) * gain;
        // Discrete spectral filaments remain colourful even in dense passages.
        cool = clamp(.16 + (column / LED_COLUMNS) * .72 + age * .24);
        warm = clamp((value - .40) * 2.05 + onset * 1.2);
        peak = clamp((value - .81) * 4 + onset * .45) * (1 - age * .3);
        const offset = index * 4;
        output[offset] = clamp(intensity, 0, 5);
        output[offset + 1] = cool;
        output[offset + 2] = clamp(warm);
        output[offset + 3] = clamp(peak);
      }
    }
  }
  let lit = 0, bright = 0, sum = 0, max = 0, amber = 0, weightedRow = 0;
  for (let index = 0; index < LED_COUNT; index++) {
    const intensity = output[index * 4];
    if (intensity > .085) lit++;
    if (intensity > 1) bright++;
    if (intensity > .085 && output[index * 4 + 2] > .5) amber++;
    max = Math.max(max, intensity);
    sum += intensity;
    weightedRow += Math.floor(index / LED_COLUMNS) * intensity;
  }
  const eventCount = (data.events || []).filter(event => event.time <= time && time - event.time < 4.5 * persistence).length;
  return { values: output, litCoverage: lit / LED_COUNT, brightCoverage: bright / LED_COUNT,
    meanIntensity: sum / LED_COUNT, maxIntensity: max, amberCoverage: amber / LED_COUNT,
    centroidRow: sum > 0 ? weightedRow / sum : null,
    eventCount, time, mode };
}

/** Pure audio-time patterns. Nothing here depends on prior render calls. */
import { writeCalligraphy } from './led-calligraphy-pattern.js';
import { writeChoreography } from './led-choreography-pattern.js';
export const LED_COLUMNS = 96;
export const LED_ROWS = 54;
export const LED_COUNT = LED_COLUMNS * LED_ROWS;
export const LED_FULL_HEIGHT_ROWS = 69;

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const feature = value => clamp(Number(value) || 0);
const empty = new Float32Array(LED_COUNT);
const writers = { calligraphy: writeCalligraphy, choreography: writeChoreography };
export const getLEDRowCount = (settings = {}) =>
  !Object.hasOwn(writers, settings.mode) && settings.loomFullHeight ? LED_FULL_HEIGHT_ROWS : LED_ROWS;

// Fixed area weights stretch the smooth six-second history across display cells.
// An isolated traveling peak retains its total emitted light through the remap.
const ageWeights = count => Array.from({ length: count }, (_, index) => {
  const start = index * LED_ROWS / count;
  const end = (index + 1) * LED_ROWS / count;
  const first = Math.floor(start), last = Math.ceil(end) - 1;
  return { first, last, weight: (Math.min(end, first + 1) - start) / (end - start) };
});
const horizontalAges = ageWeights(LED_COLUMNS);
const fullHeightAges = ageWeights(LED_FULL_HEIGHT_ROWS);
const frequencyBands = rows => Array.from({ length: rows }, (_, row) => ({
  first: Math.floor(row * LED_COLUMNS / rows),
  end: Math.floor((row + 1) * LED_COLUMNS / rows),
}));
const horizontalBands = frequencyBands(LED_ROWS);
const fullHeightBands = frequencyBands(LED_FULL_HEIGHT_ROWS);
function horizontalSample(source, column, bands, component = 0, stride = 1, older = 0) {
  const age = horizontalAges[column];
  const firstOffset = Math.min(LED_ROWS - 1, age.first + older) * LED_COLUMNS;
  const lastOffset = Math.min(LED_ROWS - 1, age.last + older) * LED_COLUMNS;
  let first = 0, last = 0;
  for (let band = bands.first; band < bands.end; band++) {
    // Every analysed frequency band contributes; narrow peaks are not skipped
    // when the frequency axis occupies fewer LEDs than analysed bands.
    first = Math.max(first, source[(firstOffset + band) * stride + component]);
    last = Math.max(last, source[(lastOffset + band) * stride + component]);
  }
  return first * age.weight + last * (1 - age.weight);
}
function fullHeightSample(source, column, row, component = 0, stride = 1, older = 0) {
  const age = fullHeightAges[row];
  const first = Math.min(LED_ROWS - 1, age.first + older) * LED_COLUMNS + column;
  const last = Math.min(LED_ROWS - 1, age.last + older) * LED_COLUMNS + column;
  return source[first * stride + component] * age.weight + source[last * stride + component] * (1 - age.weight);
}

/** Four floats per diode: emitted energy, cool mix, amber mix, peak whiteness. */
export function evaluateLEDPattern(data = {}, settings = {}, output = new Float32Array(LED_COLUMNS * getLEDRowCount(settings) * 4)) {
  const time = Math.max(0, Number(data.time) || 0);
  const gain = Math.max(0, Number.isFinite(Number(settings.gain)) ? Number(settings.gain) : 1.3);
  const persistence = clamp(Number(settings.persistence) || 1, .15, 3);
  const history = data.history || empty;
  const mode = Object.hasOwn(writers, settings.mode) ? settings.mode : 'loom';
  const rows = getLEDRowCount(settings), count = LED_COLUMNS * rows;
  if (output.length < count * 4) output = new Float32Array(count * 4);
  // The scene reuses a buffer large enough for the extended panel. Switching
  // layouts must not leave light in rows that are no longer part of the grid.
  output.fill(0, count * 4);
  if (mode !== 'loom') {
    writers[mode](data, settings, output);
  } else {
    const horizontal = Boolean(settings.loomHorizontal);
    const extended = rows !== LED_ROWS;
    const bands = extended ? fullHeightBands : horizontalBands;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < LED_COLUMNS; column++) {
        const index = row * LED_COLUMNS + column;
        let intensity = 0, cool = .4, warm = 0, peak = 0;
        // New light enters at the bottom by default, or at the left when the
        // horizontal layout is selected. Physical LED positions stay fixed.
        const age = horizontal ? column / (LED_COLUMNS - 1) : row / (rows - 1);
        const offset = index * 4;
        if (data.loomLight) {
          // These are already-emitted palette contributions. Reconstruct the
          // shader's nested colour mixes without applying spectral thresholds
          // again: a handover must not turn a white/amber peak violet midway.
          const violet = horizontal ? horizontalSample(data.loomLight, column, bands[row], 0, 4)
            : extended ? fullHeightSample(data.loomLight, column, row, 0, 4) : data.loomLight[offset];
          const blue = horizontal ? horizontalSample(data.loomLight, column, bands[row], 1, 4)
            : extended ? fullHeightSample(data.loomLight, column, row, 1, 4) : data.loomLight[offset + 1];
          const amber = horizontal ? horizontalSample(data.loomLight, column, bands[row], 2, 4)
            : extended ? fullHeightSample(data.loomLight, column, row, 2, 4) : data.loomLight[offset + 2];
          const white = horizontal ? horizontalSample(data.loomLight, column, bands[row], 3, 4)
            : extended ? fullHeightSample(data.loomLight, column, row, 3, 4) : data.loomLight[offset + 3];
          const coolLight = violet + blue, colouredLight = coolLight + amber;
          const light = colouredLight + white;
          intensity = light * 2.5 * Math.exp(-age / (3.25 * persistence)) * gain;
          cool = coolLight > 0 ? blue / coolLight : 0;
          warm = colouredLight > 0 ? amber / colouredLight : 0;
          peak = light > 0 ? white / light / .82 : 0;
        } else {
          // History-only callers retain the original mapping. Live playback and
          // export supply pre-mapped light so their colour fades stay continuous.
          const value = feature(horizontal ? horizontalSample(history, column, bands[row])
            : extended ? fullHeightSample(history, column, row) : history[index]);
          const previous = feature(horizontal ? horizontalSample(history, column, bands[row], 0, 1, 1)
            : extended ? fullHeightSample(history, column, row, 0, 1, 1)
              : history[Math.min(LED_ROWS - 1, row + 1) * LED_COLUMNS + column]);
          const onset = Math.max(0, value - previous);
          const weight = Math.pow(Math.max(0, value - .11), 1.45);
          intensity = weight * 2.5 * Math.exp(-age / (3.25 * persistence)) * gain;
          // Discrete spectral filaments remain colourful even in dense passages.
          const frequency = horizontal ? (bands[row].first + bands[row].end - 1) * .5 : column;
          cool = clamp(.16 + (frequency / LED_COLUMNS) * .72 + age * .24);
          warm = clamp((value - .40) * 2.05 + onset * 1.2);
          peak = clamp((value - .81) * 4 + onset * .45) * (1 - age * .3);
        }
        output[offset] = clamp(intensity, 0, 5);
        output[offset + 1] = cool;
        output[offset + 2] = clamp(warm);
        output[offset + 3] = clamp(peak);
      }
    }
  }
  let lit = 0, bright = 0, sum = 0, max = 0, amber = 0, weightedRow = 0;
  for (let index = 0; index < count; index++) {
    const intensity = output[index * 4];
    if (intensity > .085) lit++;
    if (intensity > 1) bright++;
    if (intensity > .085 && output[index * 4 + 2] > .5) amber++;
    max = Math.max(max, intensity);
    sum += intensity;
    weightedRow += Math.floor(index / LED_COLUMNS) * intensity;
  }
  const eventCount = (data.events || []).filter(event => event.time <= time && time - event.time < 4.5 * persistence).length;
  return { values: output, litCoverage: lit / count, brightCoverage: bright / count,
    meanIntensity: sum / count, maxIntensity: max, amberCoverage: amber / count,
    centroidRow: sum > 0 ? weightedRow / sum : null,
    eventCount, time, mode };
}

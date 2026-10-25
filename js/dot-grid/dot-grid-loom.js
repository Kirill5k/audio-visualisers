/** Remap LED Grid's emitted spectral light onto the Dot Grid's fixed spheres.
 * Keep palette coefficients in linear light so resampling does not introduce
 * new thresholds, recolor traveling peaks, or depend on prior display frames. */
const SOURCE_COLUMNS = 96;
const SOURCE_ROWS = 54;
const COMPONENTS = 4;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function frequencyCells(count) {
  return Array.from({ length: count }, (_, index) => {
    if (count <= SOURCE_COLUMNS) return {
      first: Math.floor(index * SOURCE_COLUMNS / count),
      end: Math.floor((index + 1) * SOURCE_COLUMNS / count),
    };
    const position = clamp((index + .5) * SOURCE_COLUMNS / count - .5, 0, SOURCE_COLUMNS - 1);
    const first = Math.floor(position);
    return { first, end: Math.min(SOURCE_COLUMNS - 1, first + 1), mix: position - first };
  });
}

function ageCells(count) {
  return Array.from({ length: count }, (_, index) => {
    const start = index * SOURCE_ROWS / count, end = (index + 1) * SOURCE_ROWS / count;
    const first = Math.floor(start), last = Math.ceil(end) - 1;
    // Include every overlapping source row, including coarse destination grids
    // covering more than two rows. The weights conserve light through resizing.
    const weights = Float64Array.from({ length: last - first + 1 }, (_, offset) =>
      (Math.min(end, first + offset + 1) - Math.max(start, first + offset)) / (end - start));
    return { first, weights };
  });
}

/** map() returns reused row-major violet/blue/amber/white coefficients, after
 * Loom gain and age attenuation. Copy the result before retaining it. Source
 * data is read-only; its absolute audio-time history belongs to LED analysis.
 * Vertical: newest at the final grid row, low frequencies on the left.
 * Horizontal: newest at column zero, low frequencies at the final grid row. */
export function createDotGridLoomMapper() {
  let output = new Float32Array(0), frequencyLight = new Float32Array(0);
  let frequencies = [], ages = [], frequencyCount = 0, ageCount = 0;

  function map(frame, settings = {}, columns, rows) {
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new RangeError('Loom grid dimensions must be positive integers.');
    }
    const horizontal = Boolean(settings.loomHorizontal);
    const nextFrequencyCount = horizontal ? rows : columns;
    const nextAgeCount = horizontal ? columns : rows;
    if (nextFrequencyCount !== frequencyCount) {
      frequencyCount = nextFrequencyCount;
      frequencies = frequencyCells(frequencyCount);
      frequencyLight = new Float32Array(SOURCE_ROWS * frequencyCount * COMPONENTS);
    }
    if (nextAgeCount !== ageCount) {
      ageCount = nextAgeCount;
      ages = ageCells(ageCount);
    }
    const length = columns * rows * COMPONENTS;
    if (output.length !== length) output = new Float32Array(length);
    const source = frame?.loomLight;
    const gain = Math.max(0, number(settings.loomGain, 1.3));
    const persistence = clamp(number(settings.loomPersistence, 1), .15, 3);
    if (!source || source.length < SOURCE_ROWS * SOURCE_COLUMNS * COMPONENTS || gain === 0) {
      output.fill(0);
      return output;
    }

    // Reduce each frequency interval before resampling time. Independent
    // component maxima retain neighboring peaks with different palette colors.
    // More frequency cells than source bands use center-aligned interpolation.
    for (let age = 0; age < SOURCE_ROWS; age++) for (let frequency = 0; frequency < frequencyCount; frequency++) {
      const cell = frequencies[frequency];
      const target = (age * frequencyCount + frequency) * COMPONENTS;
      for (let component = 0; component < COMPONENTS; component++) {
        let value = 0;
        if (frequencyCount <= SOURCE_COLUMNS) {
          for (let band = cell.first; band < cell.end; band++) {
            value = Math.max(value, source[(age * SOURCE_COLUMNS + band) * COMPONENTS + component]);
          }
        } else {
          value = source[(age * SOURCE_COLUMNS + cell.first) * COMPONENTS + component] * (1 - cell.mix)
            + source[(age * SOURCE_COLUMNS + cell.end) * COMPONENTS + component] * cell.mix;
        }
        frequencyLight[target + component] = value;
      }
    }
    for (let age = 0; age < ageCount; age++) {
      const cell = ages[age];
      const ageFraction = ageCount > 1 ? age / (ageCount - 1) : 0;
      const attenuation = 2.5 * gain * Math.exp(-ageFraction / (3.25 * persistence));
      for (let frequency = 0; frequency < frequencyCount; frequency++) {
        const row = horizontal ? rows - 1 - frequency : rows - 1 - age;
        const column = horizontal ? age : frequency;
        const target = (row * columns + column) * COMPONENTS;
        for (let component = 0; component < COMPONENTS; component++) {
          let value = 0;
          for (let sample = 0; sample < cell.weights.length; sample++) {
            value += frequencyLight[((cell.first + sample) * frequencyCount + frequency) * COMPONENTS + component] * cell.weights[sample];
          }
          output[target + component] = value * attenuation;
        }
      }
    }
    return output;
  }
  return { map };
}

export const TERRAIN_COLUMNS = 16384;
export const TERRAIN_RIDGES = 120;
export const TERRAIN_HISTORY_ROWS = 722;
export const TERRAIN_RIDGE_SECONDS = 6 / (TERRAIN_RIDGES - 1);
export const TERRAIN_RIDGE_SPACING = 10.5 / (TERRAIN_RIDGES - 1);
export const TERRAIN_MAX_RIDGES = 239;

/** History adds older ridges at the original cadence and world-space spacing.
 * Existing ridges keep their time and position when the duration changes. */
export function terrainHistoryLayout(historySeconds) {
  if (!Number.isFinite(historySeconds)) throw new RangeError('History duration must be finite');
  const seconds = Math.max(2, Math.min(12, historySeconds));
  const ridges = Math.min(TERRAIN_MAX_RIDGES, Math.floor(seconds / TERRAIN_RIDGE_SECONDS + 1e-8) + 1);
  return { seconds, ridges, depth: (ridges - 1) * TERRAIN_RIDGE_SPACING,
    timeStep: TERRAIN_RIDGE_SECONDS, depthStep: TERRAIN_RIDGE_SPACING };
}

/** The original terrain's soft-log axis, with an inclusive peak interval for
 * every column. Build once per sample rate, never in the vertex shader. */
export function createTerrainColumnRanges(sampleRate, columns = TERRAIN_COLUMNS, bins = 16384, fftSize = 32768) {
  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) throw new RangeError('Sample rate must be positive');
  if (!Number.isInteger(columns) || columns < 2 || !Number.isInteger(bins) || bins < 2 || bins > 65536) {
    throw new RangeError('At least two columns and two valid FFT bins are required');
  }
  const first = new Uint16Array(columns), last = new Uint16Array(columns);
  const start = new Float64Array(columns), end = new Float64Array(columns);
  const knee = 30 * fftSize / sampleRate;
  const logRange = Math.log1p((bins - 1) / knee);
  const binAt = x => knee * Math.expm1(logRange * Math.max(0, Math.min(1, x)));
  for (let column = 0; column < columns; column++) {
    start[column] = Math.max(0, Math.min(bins - 1, binAt((column - .5) / (columns - 1))));
    end[column] = Math.max(0, Math.min(bins - 1, binAt((column + .5) / (columns - 1))));
    first[column] = Math.floor(start[column]);
    last[column] = Math.ceil(end[column]);
  }
  return { first, last, start, end };
}

/** Map raw 16-bit amplitudes before half-float conversion. Intervals overlap
 * deliberately, so isolated FFT peaks cannot fall between terrain columns. */
export function mapTerrainColumns(spectrum, ranges, target = new Uint16Array(ranges.first.length)) {
  if (target.length !== ranges.first.length || ranges.last.length !== target.length
      || spectrum.length <= ranges.last[ranges.last.length - 1]) {
    throw new RangeError('Spectrum and target must match the column mapping');
  }
  for (let column = 0; column < target.length; column++) {
    let peak = 0;
    for (let bin = ranges.first[column]; bin <= ranges.last[column]; bin++) peak = Math.max(peak, spectrum[bin]);
    target[column] = peak;
  }
  return target;
}

/** Peak-preserving reconstruction of the continuous, piecewise-linear FFT
 * envelope. Sub-bin footprints interpolate their boundaries instead of holding
 * a whole neighboring bin, avoiding staircase cliffs in the enlarged bass.
 * Every integer-bin peak lies inside a footprint and survives at full height. */
export function mapTerrainEnvelope(spectrum, ranges, target = new Uint16Array(ranges.first.length)) {
  if (target.length !== ranges.first.length || spectrum.length <= ranges.last[ranges.last.length - 1]) {
    throw new RangeError('Spectrum and target must match the column mapping');
  }
  const sample = bin => {
    const low = Math.floor(bin), high = Math.min(spectrum.length - 1, low + 1);
    return spectrum[low] + (spectrum[high] - spectrum[low]) * (bin - low);
  };
  for (let column = 0; column < target.length; column++) {
    const start = ranges.start[column], end = ranges.end[column];
    let peak = Math.max(sample(start), sample(end));
    for (let bin = Math.ceil(start); bin <= Math.floor(end); bin++) peak = Math.max(peak, spectrum[bin]);
    target[column] = Math.round(peak);
  }
  return target;
}

/** Deterministic loudness-driven colour motion from the original terrain. */
export function terrainEnergy(levels) {
  const left = Number.isFinite(levels?.lRms) ? Math.max(0, levels.lRms) : 0;
  const right = Number.isFinite(levels?.rRms) ? Math.max(0, levels.rRms) : 0;
  const db = 20 * Math.log10(Math.max(Math.hypot(left, right) / Math.SQRT2, 1e-6));
  const amount = Math.max(0, Math.min(1, (db + 42) / 32));
  return amount * amount * (3 - 2 * amount);
}

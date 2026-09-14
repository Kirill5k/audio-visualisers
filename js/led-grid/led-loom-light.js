/** Light-domain Loom history. These dimensions match the fixed LED analysis
 * format; keeping this module independent avoids a reader/core import cycle. */
const COLUMNS = 96;
const ROWS = 54;
const FPS = 60;
const HISTORY_SECONDS = 6;
const FEATURE_STRIDE = 10;
const ROWS_PER_SECOND = ROWS / HISTORY_SECONDS;
const clamp = value => Math.max(0, Math.min(1, value));
// The immutable 16-bit lookup avoids repeating the nonlinear transfer for
// every historical spectrum at every display refresh.
const intensityByValue = Float64Array.from({ length: 65536 }, (_, value) =>
  Math.pow(Math.max(0, value / 65535 - .11), 1.45));

/** Returns a reused array of four nonnegative linear-light palette coefficients
 * per LED: violet, blue, amber, white. Gain and persistence belong to the caller.
 * Source colors are fixed before deposition. The entrance is calibrated for
 * steady tones; mature traveling peaks conserve their energy through the wider
 * handover. Only immutable, causal six-second data is read.
 */
export function createLoomLightReader(timeline) {
  const output = new Float32Array(COLUMNS * ROWS * 4);
  const buckets = new Float64Array(COLUMNS * (ROWS + 1) * 4);
  const accumulated = new Float64Array(output.length);
  const rowWeights = new Float64Array(ROWS);
  const coolByColumn = Float64Array.from({ length: COLUMNS }, (_, column) =>
    clamp(.16 + column / COLUMNS * .72));
  const groupByColumn = Uint8Array.from({ length: COLUMNS }, (_, column) => {
    const range = timeline.ranges?.[column];
    if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) {
      return Math.min(2, Math.floor(column * 3 / COLUMNS));
    }
    const frequency = (range.low + range.high) * .5;
    return frequency < 250 ? 0 : frequency < 4000 ? 1 : 2;
  });

  return function atTime(time) {
    if (!Number.isFinite(time)) throw new Error('Loom light time must be finite');
    const bounded = Math.max(0, Math.min(timeline.duration, time));
    const last = Math.min(timeline.frames - 1, Math.floor(bounded * FPS + 1e-7));
    const first = Math.max(0, Math.ceil((bounded - HISTORY_SECONDS) * FPS));
    const position = bounded * ROWS_PER_SECOND;
    const tick = Math.floor(position), phase = position - tick;
    const bands = timeline.bands, features = timeline.features;
    buckets.fill(0);
    for (let sourceFrame = first; sourceFrame <= last; sourceFrame++) {
      const age = (bounded - sourceFrame / FPS) * ROWS_PER_SECOND;
      if (age < 0 || age >= ROWS) continue;
      // Track-anchored buckets prevent the 60 Hz source lattice from beating
      // against moving interpolation kernels. Completed steady-spectrum buckets
      // are identical, so their emitted light stays perfectly steady in motion.
      const depth = tick - Math.floor(sourceFrame * ROWS_PER_SECOND / FPS);
      if (depth < 0 || depth > ROWS) continue;
      const bucketOffset = depth * COLUMNS * 4;
      const fadePhase = Math.max(0, age - ROWS + 1);
      const fade = 1 - fadePhase * fadePhase * (3 - 2 * fadePhase);
      const sourceOffset = sourceFrame * COLUMNS;
      const featureOffset = sourceFrame * FEATURE_STRIDE + 7;
      const onsetBass = clamp(features?.[featureOffset] || 0);
      const onsetMids = clamp(features?.[featureOffset + 1] || 0);
      const onsetHighs = clamp(features?.[featureOffset + 2] || 0);
      for (let column = 0; column < COLUMNS; column++) {
        const encoded = bands[sourceOffset + column];
        const intensity = intensityByValue[encoded] * fade;
        if (!(intensity > 0)) continue;
        const value = encoded / 65535;
        const group = groupByColumn[column];
        const onset = group === 0 ? onsetBass : group === 1 ? onsetMids : onsetHighs;
        const cool = coolByColumn[column];
        const warm = clamp((value - .4) * 2.05 + onset * 1.2);
        const white = .82 * clamp((value - .81) * 4 + onset * .45);
        const colored = intensity * (1 - white);
        const coolEnergy = colored * (1 - warm);
        const violetEnergy = coolEnergy * (1 - cool);
        const blueEnergy = coolEnergy * cool;
        const amberEnergy = colored * warm;
        const whiteEnergy = intensity * white;
        const target = bucketOffset + column * 4;
        // Max aggregation preserves every brief source peak and is continuous
        // when the winner changes. Different overlapping colors can contribute
        // their separate maxima; unlike averaging, this never dilutes a peak.
        buckets[target] = Math.max(buckets[target], violetEnergy);
        buckets[target + 1] = Math.max(buckets[target + 1], blueEnergy);
        buckets[target + 2] = Math.max(buckets[target + 2], amberEnergy);
        buckets[target + 3] = Math.max(buckets[target + 3], whiteEnergy);
      }
    }
    const rowStride = COLUMNS * 4;
    const t2 = phase * phase, t3 = t2 * phase;
    // A positive cubic reconstruction keeps both fade speed and acceleration
    // continuous at row boundaries. Two-row fades conserve linear light but
    // still pulse visibly after the display tone curve, especially for white.
    const cubic = [(1 - phase) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6,
      (-3 * t3 + 3 * t2 + 3 * phase + 1) / 6, t3 / 6];
    accumulated.fill(0);
    rowWeights.fill(0);
    for (let depth = 1; depth <= ROWS; depth++) {
      const sourceOffset = depth * rowStride;
      const centre = depth - 1 + phase;
      const ramp = Math.min(1, centre / 2);
      const blend = ramp * ramp * (3 - 2 * ramp);
      // Blend per source before calibrating the entrance. Fold out-of-board
      // support into the edge; the existing six-second fade bounds its lifetime.
      for (let tap = 0; tap < 4; tap++) {
        const linear = tap === 1 ? 1 - phase : tap === 2 ? phase : 0;
        const weight = linear * (1 - blend) + cubic[tap] * blend;
        if (weight === 0) continue;
        const row = Math.max(0, Math.min(ROWS - 1, depth - 2 + tap));
        const target = row * rowStride;
        rowWeights[row] += weight;
        for (let component = 0; component < rowStride; component++) accumulated[target + component] += buckets[sourceOffset + component] * weight;
      }
    }
    for (let row = 0; row < ROWS; row++) for (let component = 0; component < rowStride; component++) {
      const target = row * rowStride + component;
      // At the entrance only, the changing kernel support otherwise makes a
      // constant tone breathe. This is a geometric weight, independent of the
      // audio level: quiet music is never normalized to full brightness.
      const weight = row > 0 && row < 4 ? rowWeights[row] : 1;
      const light = accumulated[target] / weight;
      // Keep the causal input row's attack and release independent of the
      // wider history support. Older pulses must not make this row re-flash.
      output[target] = row === 0 ? Math.max(buckets[component], buckets[rowStride + component] * (1 - phase)) : light;
    }
    return output;
  };
}

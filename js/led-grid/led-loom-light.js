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
 * Source colors are fixed before deposition, so crossing a row never changes a
 * musical peak's color or energy. Only immutable, causal six-second data is read.
 */
export function createLoomLightReader(timeline) {
  const output = new Float32Array(COLUMNS * ROWS * 4);
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
    const bands = timeline.bands, features = timeline.features;
    output.fill(0);
    for (let sourceFrame = first; sourceFrame <= last; sourceFrame++) {
      const age = (bounded - sourceFrame / FPS) * ROWS_PER_SECOND;
      if (age < 0 || age >= ROWS) continue;
      const row = Math.floor(age), phase = age - row;
      const blend = phase * phase * (3 - 2 * phase);
      const firstWeight = 1 - blend, secondWeight = blend;
      const firstOffset = row * COLUMNS * 4;
      const secondOffset = (row + 1) * COLUMNS * 4;
      const sourceOffset = sourceFrame * COLUMNS;
      const featureOffset = sourceFrame * FEATURE_STRIDE + 7;
      const onsetBass = clamp(features?.[featureOffset] || 0);
      const onsetMids = clamp(features?.[featureOffset + 1] || 0);
      const onsetHighs = clamp(features?.[featureOffset + 2] || 0);
      for (let column = 0; column < COLUMNS; column++) {
        const encoded = bands[sourceOffset + column];
        const intensity = intensityByValue[encoded];
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
        const target = firstOffset + column * 4;
        // Max aggregation preserves every brief source peak and is continuous
        // when the winner changes. Different overlapping colors can contribute
        // their separate maxima; unlike averaging, this never dilutes a peak.
        output[target] = Math.max(output[target], violetEnergy * firstWeight);
        output[target + 1] = Math.max(output[target + 1], blueEnergy * firstWeight);
        output[target + 2] = Math.max(output[target + 2], amberEnergy * firstWeight);
        output[target + 3] = Math.max(output[target + 3], whiteEnergy * firstWeight);
        if (row < ROWS - 1 && secondWeight > 0) {
          const next = secondOffset + column * 4;
          output[next] = Math.max(output[next], violetEnergy * secondWeight);
          output[next + 1] = Math.max(output[next + 1], blueEnergy * secondWeight);
          output[next + 2] = Math.max(output[next + 2], amberEnergy * secondWeight);
          output[next + 3] = Math.max(output[next + 3], whiteEnergy * secondWeight);
        }
        // The final row transfers to darkness rather than retaining any source
        // older than six seconds; its smoothstep reaches zero without a pop.
      }
    }
    return output;
  };
}

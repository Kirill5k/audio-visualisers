export const RTA_FFT_SIZE = 2048;
export const RTA_MIN_DB = -90;
export const SCOPE_TRAIL_SECONDS = .16;
export const SCOPE_DECAY_SECONDS = .06;
export const RTA_PRESETS = Object.freeze({
  full: Object.freeze({ min: 20, max: 20000 }),
  bass: Object.freeze({ min: 20, max: 500 }),
  mids: Object.freeze({ min: 500, max: 4000 }),
  highs: Object.freeze({ min: 4000, max: 20000 }),
});

function frequencyNumber(value) {
  if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return NaN;
  return Number(value);
}

/** Validate user input, limiting the upper endpoint to the decoded Nyquist. */
export function validateRange(minimum, maximum, sampleRate = 48000) {
  const min = frequencyNumber(minimum), requestedMax = frequencyNumber(maximum);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Sample rate must be positive.');
  if (!Number.isFinite(min) || !Number.isFinite(requestedMax) || min <= 0 || requestedMax <= min) {
    throw new RangeError('Enter positive frequencies with minimum below maximum.');
  }
  const max = Math.min(requestedMax, sampleRate / 2);
  if (min >= max) throw new RangeError('Minimum frequency must be below the track’s Nyquist frequency.');
  return { min, max };
}

/** A new lower-rate track can invalidate a previously valid view range. */
export function clampRange(minimum = 20, maximum = 20000, sampleRate = 48000) {
  try { return validateRange(minimum, maximum, sampleRate); }
  catch {
    const nyquist = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate / 2 : 24000;
    return { min: Math.min(20, nyquist / 2), max: Math.min(20000, nyquist) };
  }
}

export function amplitudeToDb(amplitude) {
  return Number.isFinite(amplitude) && amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

export function dbToUnit(db) {
  return Math.max(0, Math.min(1, (db - RTA_MIN_DB) / -RTA_MIN_DB)) || 0;
}

export function frequencyAt(position, min, max) {
  return min * Math.pow(max / min, Math.max(0, Math.min(1, position)));
}

/** Fade actual older samples instead of interpolating stereo coordinates. */
export function phaseTrailWeight(ageSeconds) {
  if (ageSeconds <= 0) return 1;
  if (ageSeconds >= SCOPE_TRAIL_SECONDS) return 0;
  const edge = Math.exp(-SCOPE_TRAIL_SECONDS / SCOPE_DECAY_SECONDS);
  return (Math.exp(-ageSeconds / SCOPE_DECAY_SECONDS) - edge) / (1 - edge);
}

// Sample age depends only on the window size and sample rate. Retain one table
// in double precision so weighted correlation stays identical after any seek.
// Larger custom windows use the direct calculation, keeping storage <= 512 KiB.
const MAX_CACHED_TRAIL_SAMPLES = 65536;
let trailWeightCache = null;
function phaseTrailWeights(samples, sampleRate) {
  if (samples > MAX_CACHED_TRAIL_SAMPLES) return null;
  if (trailWeightCache?.sampleRate !== sampleRate || trailWeightCache.weights.length !== samples) {
    const weights = new Float64Array(samples);
    for (let age = 0; age < samples; age++) weights[age] = phaseTrailWeight(age / sampleRate);
    trailWeightCache = { sampleRate, weights };
  }
  return trailWeightCache.weights;
}

/** Populate reusable point/opacity buffers from a trailing PCM window. Absolute
 * sample alignment prevents decimation from choosing a new sample set each
 * frame. Correlation uses every raw sample, including those not drawn.
 */
export function fillPhaseTrail(frame, sampleRate, positions, weights) {
  const left = frame?.left, right = frame?.right || left;
  if (!left?.length || !(sampleRate > 0)) return { count: 0, correlation: 0, duration: 0, stride: 1 };
  const capacity = Math.min(weights.length, Math.floor(positions.length / 3));
  if (!capacity) return { count: 0, correlation: 0, duration: 0, stride: 1 };
  const samples = Math.min(left.length, Math.max(1, Math.round(sampleRate * SCOPE_TRAIL_SECONDS)));
  const first = left.length - samples;
  const stride = Math.max(1, Math.ceil(samples / capacity));
  const startSample = Number.isInteger(frame.startSample) ? frame.startSample : 0;
  const ageWeights = phaseTrailWeights(samples, sampleRate);
  let count = 0, squareLeft = 0, squareRight = 0, product = 0;
  for (let index = first; index < left.length; index++) {
    const l = left[index] || 0, r = right[index] || 0;
    const age = left.length - 1 - index;
    const weight = ageWeights ? ageWeights[age] : phaseTrailWeight(age / sampleRate);
    squareLeft += l * l * weight;
    squareRight += r * r * weight;
    product += l * r * weight;
    if ((startSample + index) % stride !== 0) continue;
    positions[count * 3] = r - l;
    positions[count * 3 + 1] = l + r;
    positions[count * 3 + 2] = 0;
    weights[count] = weight;
    count++;
  }
  const denominator = Math.sqrt(squareLeft * squareRight);
  return { count, correlation: denominator > 1e-12 ? Math.max(-1, Math.min(1, product / denominator)) : 0,
    duration: samples / sampleRate, stride };
}

/** Interpolate narrow intervals and retain every peak in wider log-axis pixels.
 * Inputs and results are calibrated dBFS; display boost is deliberately absent.
 */
export function sampleSpectrum(data, frequency, sampleRate = 48000, endFrequency = frequency) {
  if (!data?.length || !(sampleRate > 0) || !Number.isFinite(frequency) || !Number.isFinite(endFrequency)) return -Infinity;
  const binWidth = sampleRate / RTA_FFT_SIZE;
  const first = Math.max(0, Math.min(data.length - 1, Math.min(frequency, endFrequency) / binWidth));
  const last = Math.max(0, Math.min(data.length - 1, Math.max(frequency, endFrequency) / binWidth));
  const read = bin => Number.isFinite(data[bin]) ? data[bin] : -Infinity;
  if (last - first > 1) {
    let peak = -Infinity;
    for (let bin = Math.max(0, Math.floor(first - .5)); bin <= Math.min(data.length - 1, Math.ceil(last + .5)); bin++) {
      peak = Math.max(peak, read(bin));
    }
    return peak;
  }
  const exact = (first + last) / 2;
  const before = Math.floor(exact), fraction = exact - before;
  const a = read(before), b = read(Math.min(data.length - 1, before + 1));
  if (fraction === 0 || before === data.length - 1) return a;
  if (a === -Infinity && b === -Infinity) return -Infinity;
  // A finite numerical floor only bridges an isolated zero FFT bin. Actual
  // silent intervals retain −Infinity and are reported as such by the hover.
  return Math.max(-150, a) * (1 - fraction) + Math.max(-150, b) * fraction;
}

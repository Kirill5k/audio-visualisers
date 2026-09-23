/** Deep Drift's musical response is precomputed from the immutable feature
 * timeline. Rendering, seeking and export read the same values; display refresh
 * rates and the full-spectrum worker's availability cannot affect the result. */
const FPS = 60;
const BANDS = 32;
const SCALARS = ['bass', 'mids', 'highs', 'energy', 'kick', 'breath', 'accent', 'rms'];
const LEVEL_OFFSET = SCALARS.length;
const ONSET_OFFSET = LEVEL_OFFSET + BANDS;
const STRIDE = ONSET_OFFSET + BANDS;
const MIN_ACCENT_FRAMES = 15;

const preset = (label, values) => Object.freeze({ label, values: Object.freeze(values) });
export const RESPONSE_PRESETS = Object.freeze({
  cinematic: preset('Cinematic', { gain: 1, smoothness: 1.45, bassMotion: .7, midFlow: .8, trebleShimmer: .5, pulse: .65 }),
  fluid: preset('Fluid', { gain: 1.15, smoothness: 1, bassMotion: 1, midFlow: 1, trebleShimmer: .85, pulse: 1 }),
  energetic: preset('Energetic', { gain: 1.3, smoothness: .65, bassMotion: 1.2, midFlow: 1.1, trebleShimmer: 1.15, pulse: 1.25 }),
});
export const DEFAULT_RESPONSE_SETTINGS = RESPONSE_PRESETS.fluid.values;

// Capture suspends the preview, including a preset fade already in progress.
// Store elapsed time rather than a wall-clock origin so export duration cannot
// finish that fade behind the frozen preview.
export function saveResponseTransition(transition, now) {
  return transition ? { from: structuredClone(transition.from), elapsed: Math.max(0, now - transition.start) } : null;
}
export function restoreResponseTransition(saved, now) {
  return saved ? { from: structuredClone(saved.from), start: now - saved.elapsed } : null;
}

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
// Gain is applied here, once. A soft shoulder keeps strong sections expressive
// without flattening their peaks against a hard 0..1 clamp.
const excite = (value, gain) => -Math.expm1(-Math.max(0, finite(value)) * gain * 1.6);
const coefficient = seconds => -Math.expm1(-1 / (FPS * seconds));

function outputFrame(output) {
  const result = output || {};
  if (!(result.levels instanceof Float32Array) || result.levels.length !== BANDS) result.levels = new Float32Array(BANDS);
  if (!(result.onsets instanceof Float32Array) || result.onsets.length !== BANDS) result.onsets = new Float32Array(BANDS);
  return result;
}

/** getFeatureFrame may return { features } (the starfield analysis interface)
 * or the features directly. Settings are captured at construction: rebuild this
 * small timeline after a response setting changes. Sampling never consumes an
 * event or changes smoothing history. Continuous fields interpolate; event
 * triggers are exposed only at exact canonical 60 Hz frame timestamps. */
export function createDeepDriftResponseTimeline({ frameCount, getFeatureFrame, settings = {} }) {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new RangeError('Response frame count must be a nonnegative integer.');
  if (typeof getFeatureFrame !== 'function') throw new TypeError('A feature-frame reader is required.');
  const config = {};
  for (const [key, fallback] of Object.entries(DEFAULT_RESPONSE_SETTINGS)) {
    config[key] = clamp(finite(settings[key], fallback), key === 'smoothness' ? .25 : 0, key === 'smoothness' ? 2 : 3);
  }
  const data = new Float32Array(frameCount * STRIDE);
  const triggers = new Float32Array(frameCount);
  const accentBands = new Int8Array(frameCount).fill(-1);
  const state = new Float64Array(STRIDE);
  const previousOnsets = new Float32Array(BANDS);
  const attacks = [.18, .18, .08, .06, .045, .35].map(seconds => coefficient(seconds * config.smoothness));
  const releases = [.8, .8, .32, .4, .35, 1.15].map(seconds => coefficient(seconds * config.smoothness));
  const levelAttack = coefficient(.08 * config.smoothness), levelRelease = coefficient(.42 * config.smoothness);
  const onsetAttack = coefficient(.035 * config.smoothness), onsetRelease = coefficient(.3 * config.smoothness);
  const accentSlowDecay = Math.exp(-1 / (FPS * .4 * config.smoothness));
  const accentFastDecay = Math.exp(-1 / (FPS * .06 * config.smoothness));
  let lastAccentFrame = -MIN_ACCENT_FRAMES;
  let accentSlow = 0, accentFast = 0;

  function follow(index, target, attack, release) {
    state[index] += (target - state[index]) * (target > state[index] ? attack : release);
    return state[index];
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const input = getFeatureFrame(frame);
    const features = input?.features || input || {};
    const rms = Math.max(0, finite(features.rms));
    const audible = rms > .00001;
    const base = frame * STRIDE;
    const targets = audible ? [
      excite(features.bass, config.gain * config.bassMotion),
      excite(features.mids, config.gain * config.midFlow),
      excite(features.highs, config.gain * config.trebleShimmer),
      excite(features.energy, config.gain),
      excite(features.kick, config.gain * config.pulse),
      excite(finite(features.mids) * .65 + finite(features.energy) * .35, config.gain * config.midFlow),
    ] : [0, 0, 0, 0, 0, 0];
    for (let channel = 0; channel < targets.length; channel++) {
      data[base + channel] = follow(channel, targets[channel], attacks[channel], releases[channel]);
    }

    let strongest = 0, strongestBand = -1;
    for (let band = 0; band < BANDS; band++) {
      const amount = band < 10 ? config.bassMotion : band < 24 ? config.midFlow : config.trebleShimmer;
      const level = audible ? excite(features.levels?.[band], config.gain * amount) : 0;
      const onset = audible ? Math.max(0, finite(features.onsets?.[band])) : 0;
      data[base + LEVEL_OFFSET + band] = follow(LEVEL_OFFSET + band, level, levelAttack, levelRelease);
      data[base + ONSET_OFFSET + band] = follow(ONSET_OFFSET + band, excite(onset, config.gain * config.pulse), onsetAttack, onsetRelease);
      // The analyser emits impulses, but requiring a genuine rise also keeps a
      // held/custom input from re-firing whenever the cooldown expires.
      if (onset >= .16 && onset > previousOnsets[band] + .035 && onset > strongest) {
        strongest = onset; strongestBand = band;
      }
      previousOnsets[band] = onset;
    }

    accentSlow *= accentSlowDecay;
    accentFast *= accentFastDecay;
    if (strongestBand >= 0 && frame - lastAccentFrame >= MIN_ACCENT_FRAMES) {
      const strength = excite(strongest * 1.6, config.gain * config.pulse);
      if (strength > 0) {
        triggers[frame] = strength;
        accentBands[frame] = strongestBand;
        lastAccentFrame = frame;
        // Equal deposits mean the envelope is zero at a new event's birth.
        // It opens smoothly on following frames, without an interpolated flash
        // in the interval immediately preceding the trigger.
        accentSlow += strength;
        accentFast += strength;
      }
    }
    data[base + 6] = -Math.expm1(-Math.max(0, accentSlow - accentFast) * 2);
    data[base + 7] = rms;
  }

  return {
    frameCount,
    sample(time, output) {
      if (!Number.isFinite(time)) throw new RangeError('Response sample time must be finite.');
      const result = outputFrame(output);
      if (!frameCount) {
        for (const key of SCALARS) result[key] = 0;
        result.levels.fill(0); result.onsets.fill(0);
        result.accentTrigger = 0; result.accentBand = -1;
        return result;
      }
      let position = clamp(time * FPS, 0, frameCount - 1);
      const nearest = Math.round(position);
      const canonical = Math.abs(position - nearest) < 1e-7;
      if (canonical) position = nearest;
      const first = Math.floor(position), last = Math.min(first + 1, frameCount - 1);
      const blend = position - first, a = first * STRIDE, b = last * STRIDE;
      for (let channel = 0; channel < SCALARS.length; channel++) {
        result[SCALARS[channel]] = data[a + channel] + (data[b + channel] - data[a + channel]) * blend;
      }
      for (let band = 0; band < BANDS; band++) {
        result.levels[band] = data[a + LEVEL_OFFSET + band] + (data[b + LEVEL_OFFSET + band] - data[a + LEVEL_OFFSET + band]) * blend;
        result.onsets[band] = data[a + ONSET_OFFSET + band] + (data[b + ONSET_OFFSET + band] - data[a + ONSET_OFFSET + band]) * blend;
      }
      result.accentTrigger = canonical ? triggers[first] : 0;
      result.accentBand = canonical && triggers[first] > 0 ? accentBands[first] : -1;
      return result;
    },
  };
}

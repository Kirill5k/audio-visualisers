export const SCOPE_WINDOWS_MS = Object.freeze([23, 46, 93]);
export const SCOPE_MAX_POINTS = 1024;
export const SCOPE_MAX_TRACES = 16;
export const SCOPE_TRACE_SPACING_FRAMES = 2;
const TRIGGER_CUTOFF_HZ = 200;
const TRIGGER_WARMUP = 256;
const GAIN_SECONDS = .5;

const midAt = (left, right, index) => index >= 0 && index < left.length ? (left[index] + right[index]) * .5 : 0;

export function scopeSpan(windowMs, sampleRate) {
  const ms = SCOPE_WINDOWS_MS.includes(windowMs) ? windowMs : 46;
  return Math.max(64, Math.round(ms * sampleRate / 1000));
}

/**
 * Latest rising zero crossing of the 200 Hz low-passed mid signal in [latest − search, latest].
 * Bass cycles lock in place while higher detail moves; without a crossing the trace free-runs at `latest`.
 */
export function findScopeTrigger(left, right, latest, search, sampleRate) {
  const start = Math.max(1, latest - search), a = 1 - Math.exp(-2 * Math.PI * TRIGGER_CUTOFF_HZ / sampleRate);
  let y = 0;
  for (let i = Math.max(0, start - TRIGGER_WARMUP); i < start; i++) y += (midAt(left, right, i) - y) * a;
  let found = latest;
  for (let i = start; i <= latest; i++) {
    const previous = y;
    y += (midAt(left, right, i) - y) * a;
    if (previous < 0 && y >= 0) found = i;
  }
  return found;
}

/** Display gain that brings the mid peak of the last half second to 85% of the graticule, between ×1 and ×16. */
export function scopeAutoGain(left, right, end, sampleRate = 48000) {
  let peak = 0;
  for (let i = Math.max(0, end - Math.round(GAIN_SECONDS * sampleRate)); i < end; i++) peak = Math.max(peak, Math.abs(midAt(left, right, i)));
  return Math.max(1, Math.min(16, .85 / (peak + 1e-6)));
}

/**
 * Sample windows for the current trace and its fading predecessors, each re-triggered at its own time.
 * Trace k ends 2k frames before `time`; every window lies entirely in audio already heard.
 */
export function scopeTraces(left, right, sampleRate, time, { span, traces }) {
  const result = [];
  const count = Math.max(1, Math.min(SCOPE_MAX_TRACES, Math.round(traces)));
  for (let k = 0; k < count; k++) {
    const end = Math.min(left.length, Math.round((time - k * SCOPE_TRACE_SPACING_FRAMES / 60) * sampleRate));
    if (end < span * 3) continue;
    result.push({ age: k, start: findScopeTrigger(left, right, end - span, span * 2, sampleRate) });
  }
  return result;
}

/** Evenly decimated mid values for one trace window, at most SCOPE_MAX_POINTS long. */
export function scopeSamples(left, right, start, span, output = new Float32Array(SCOPE_MAX_POINTS)) {
  const step = Math.max(1, Math.ceil(span / SCOPE_MAX_POINTS));
  const count = Math.min(output.length, Math.floor(span / step));
  for (let i = 0; i < count; i++) output[i] = midAt(left, right, start + i * step);
  return { values: output, count, step };
}

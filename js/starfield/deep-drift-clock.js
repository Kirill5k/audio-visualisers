// Derived from the project's LED presentation clock; kept local to Deep Drift.
const CORRECTION_SECONDS = .2;
const MAX_CORRECTION_RATE = .03;
const MAX_FRAME_GAP_SECONDS = .25;
const TRANSPORT_JUMP_SECONDS = .1;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Interpolate preview time between the audio device's clock updates.
 * Audio remains the authority: a bounded phase correction follows drift, while
 * RAF supplies smooth elapsed time. This is only a presentation clock; seeking,
 * paused frames and offline export continue to use exact audio timestamps.
 */
export function createDeepDriftClock() {
  let initialized = false, previousNow = 0, previousAudio = 0, displayed = 0;

  function reset() { initialized = false; }

  function sample(audioTime, rafNow, duration, { running = true } = {}) {
    if (![audioTime, rafNow, duration].every(Number.isFinite) || duration < 0) {
      throw new RangeError('Presentation clock needs finite times and a nonnegative duration');
    }
    const observed = clamp(audioTime, 0, duration);
    const elapsed = (rafNow - previousNow) / 1000;
    const transportJump = Math.abs(observed - previousAudio - elapsed) > TRANSPORT_JUMP_SECONDS;
    if (!initialized || !running || elapsed < 0 || elapsed > MAX_FRAME_GAP_SECONDS || transportJump) {
      displayed = observed;
    } else if (elapsed > 0) {
      const predicted = displayed + elapsed;
      const correction = (observed - predicted) * -Math.expm1(-elapsed / CORRECTION_SECONDS);
      const limit = MAX_CORRECTION_RATE * elapsed;
      displayed = clamp(predicted + clamp(correction, -limit, limit), 0, duration);
    }
    displayed = clamp(displayed, 0, duration);
    previousNow = rafNow;
    previousAudio = observed;
    // A caller must mark a suspended/paused audio context as nonrunning. The
    // next running frame then anchors afresh, with no hidden elapsed time.
    initialized = running;
    return displayed;
  }

  return { sample, reset };
}

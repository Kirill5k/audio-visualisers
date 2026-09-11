/** A bounded, causal PCM view. No FFT or whole-track pass is needed here. */
export const LED_WAVEFORM_POINTS = 193;
const TRAIL_AGES = [0, 1 / 30, 2 / 30];
const WINDOW_SECONDS = .032;

/**
 * Retains read-only views of the decoded channels, and returns a reusable
 * { time, sampleRate, pointCount, frames } object. Every frame contains age,
 * time, left/right Float32Arrays, rmsLeft/Right and peakLeft/Right. Mono is
 * duplicated; stereo is never summed, so opposite phase cannot disappear.
 * Arrays are overwritten on the next read. Copy them if retaining a frame.
 */
export function createLEDWaveformReader(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !(sampleRate > 0)) {
    throw new TypeError('Waveform analysis requires PCM channels and a sample rate');
  }
  const left = channels[0];
  const right = channels[1] || left;
  if (!left?.length || right.length !== left.length) throw new TypeError('PCM channels must have equal nonzero lengths');
  const windowSize = Math.max(LED_WAVEFORM_POINTS, Math.round(WINDOW_SECONDS * sampleRate));
  const triggerSize = Math.max(1, Math.round(.018 * sampleRate));
  const filterSize = Math.max(1, Math.round(.0007 * sampleRate));
  const scratch = new Float32Array(triggerSize + filterSize + 2);
  const result = {
    time: 0, sampleRate, pointCount: LED_WAVEFORM_POINTS,
    frames: TRAIL_AGES.map(age => ({ age, time: 0,
      left: new Float32Array(LED_WAVEFORM_POINTS), right: new Float32Array(LED_WAVEFORM_POINTS),
      rmsLeft: 0, rmsRight: 0, peakLeft: 0, peakRight: 0 })),
  };
  const pcm = (channel, index) => index >= 0 && index < channel.length ? channel[index] : 0;

  function readFrame(frame, time) {
    frame.time = time;
    frame.left.fill(0); frame.right.fill(0);
    frame.rmsLeft = frame.rmsRight = frame.peakLeft = frame.peakRight = 0;
    if (time <= 0 || time > left.length / sampleRate + WINDOW_SECONDS) return;
    // End is exclusive: even at an exact sample timestamp there is no lookahead.
    const end = Math.min(left.length, Math.max(0, Math.floor(time * sampleRate)));
    const first = Math.max(0, end - windowSize);
    let powerLeft = 0, powerRight = 0, recentPower = 0, earlierPower = 0;
    const recentSize = Math.max(1, Math.round(sampleRate * .002));
    for (let index = first; index < end; index++) {
      const l = left[index], r = right[index];
      powerLeft += l * l; powerRight += r * r;
      frame.peakLeft = Math.max(frame.peakLeft, Math.abs(l));
      frame.peakRight = Math.max(frame.peakRight, Math.abs(r));
      if (index >= end - recentSize) recentPower += l * l + r * r;
      else if (index >= end - recentSize * 5) earlierPower += l * l + r * r;
    }
    frame.rmsLeft = Math.sqrt(powerLeft / windowSize);
    frame.rmsRight = Math.sqrt(powerRight / windowSize);
    if (powerLeft + powerRight === 0) return;

    // Lock periodic contours to a recent positive crossing of a lightly
    // filtered channel. A fresh attack bypasses the trigger, retaining its
    // exact current contour instead of waiting for a complete wave cycle.
    let anchor = end;
    if (!(recentPower > earlierPower * .7 && recentPower > .00001)) {
      const triggerChannel = powerRight > powerLeft ? right : left;
      const scratchFirst = end - scratch.length;
      let sum = 0;
      for (let index = 0; index < scratch.length; index++) {
        sum += pcm(triggerChannel, scratchFirst + index);
        if (index >= filterSize) sum -= pcm(triggerChannel, scratchFirst + index - filterSize);
        scratch[index] = sum / filterSize;
      }
      for (let index = scratch.length - 1; index > filterSize; index--) {
        if (scratch[index - 1] <= 0 && scratch[index] > 0) {
          anchor = scratchFirst + index + 1;
          break;
        }
      }
    }

    // Area-sample each display interval. This keeps a 96-column stroke
    // legible instead of turning high frequency PCM into aliased vertical
    // stripes; a small signed peak term retains brief transient detail.
    for (let point = 0; point < LED_WAVEFORM_POINTS; point++) {
      const a = Math.floor(anchor - windowSize + point / LED_WAVEFORM_POINTS * windowSize);
      const b = Math.floor(anchor - windowSize + (point + 1) / LED_WAVEFORM_POINTS * windowSize);
      let sumLeft = 0, sumRight = 0, peakLeft = 0, peakRight = 0;
      for (let index = a; index < b; index++) {
        const l = pcm(left, index), r = pcm(right, index);
        sumLeft += l; sumRight += r;
        if (Math.abs(l) > Math.abs(peakLeft)) peakLeft = l;
        if (Math.abs(r) > Math.abs(peakRight)) peakRight = r;
      }
      const count = Math.max(1, b - a);
      frame.left[point] = sumLeft / count * .92 + peakLeft * .08;
      frame.right[point] = sumRight / count * .92 + peakRight * .08;
    }
  }

  return function readWaveform(timeSeconds) {
    result.time = Math.max(0, Number(timeSeconds) || 0);
    for (const frame of result.frames) readFrame(frame, result.time - frame.age);
    return result;
  };
}

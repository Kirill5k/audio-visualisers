import { createFFT, FFT_SIZE, FFT_BINS, ANALYSIS_FPS } from '../starfield/starfield-analysis-core.js';

export { FFT_SIZE, FFT_BINS, ANALYSIS_FPS };
export const LEVEL_STRIDE = 9;
export const OVERVIEW_BINS = 16384;
export const RTA_FFT_SIZE = 2048;
export const RTA_BINS = RTA_FFT_SIZE / 2;
export const RTA_FLOOR_DB = -120;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Preview, meters, seeks and export use the same absolute 60 Hz clock. The
 * endpoint includes a partial final interval instead of dropping its samples. */
export function signalFrameIndex(time, duration) {
  if (!(duration > 0)) return 0;
  if (!Number.isFinite(time)) throw new Error('Signal time must be finite');
  if (time >= duration) return Math.max(1, Math.ceil(duration * ANALYSIS_FPS - 1e-7));
  return Math.max(0, Math.floor(time * ANALYSIS_FPS + 1e-7));
}

/** A reusable raw PCM window. Sampling never advances hidden analyser state. */
export function createSignalFrame(sampleCount = 4096) {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('PCM window size must be a positive integer');
  return { left: new Float32Array(sampleCount), right: new Float32Array(sampleCount), startSample: 0,
    lRms: 0, rRms: 0, lPeak: 0, rPeak: 0, correlation: 0 };
}

export function fillSignalFrame(channels, sampleRate, time, frame, { trailing = false } = {}) {
  if (!Number.isFinite(time)) throw new Error('PCM sample time must be finite');
  const left = channels[0];
  const right = channels[1] || left;
  const count = frame.left.length;
  const start = Math.round(time * sampleRate) - (trailing ? count : Math.floor(count / 2));
  frame.startSample = start;
  let lSquare = 0, rSquare = 0, product = 0, lPeak = 0, rPeak = 0;
  for (let i = 0; i < count; i++) {
    const index = start + i;
    const l = index >= 0 && index < left.length ? left[index] : 0;
    const r = index >= 0 && index < right.length ? right[index] : 0;
    frame.left[i] = l;
    frame.right[i] = r;
    lSquare += l * l;
    rSquare += r * r;
    product += l * r;
    lPeak = Math.max(lPeak, Math.abs(l));
    rPeak = Math.max(rPeak, Math.abs(r));
  }
  frame.lRms = Math.sqrt(lSquare / count);
  frame.rRms = Math.sqrt(rSquare / count);
  frame.lPeak = lPeak;
  frame.rPeak = rPeak;
  const denominator = Math.sqrt(lSquare * rSquare);
  frame.correlation = denominator > 1e-12 ? clamp(product / denominator, -1, 1) : 0;
  return frame;
}

/** Blackman windows END at the absolute 60 Hz frame time. Channel powers are
 * averaged after the FFT, preserving anti-phase audio and right-only tracks.
 * Every bin encodes -90..0 dBFS directly into the full 16-bit range. */
export function createStereoSpectrum(channels, sampleRate) {
  const fft = createFFT(FFT_SIZE);
  const power = new Float64Array(FFT_BINS);
  return function spectrumAt(frame) {
    const spectrum = new Uint16Array(FFT_BINS);
    if (frame <= 0) return spectrum;
    const endSample = Math.round(frame * sampleRate / ANALYSIS_FPS);
    power.fill(0);
    for (const channel of channels) {
      const magnitudes = fft.magnitudes(channel, endSample);
      for (let bin = 0; bin < FFT_BINS; bin++) power[bin] += magnitudes[bin] * magnitudes[bin];
    }
    for (let bin = 0; bin < FFT_BINS; bin++) {
      const db = 10 * Math.log10(Math.max(1e-18, power[bin] / channels.length));
      spectrum[bin] = Math.round(clamp((db + 90) / 90, 0, 1) * 65535);
    }
    return spectrum;
  };
}

/** Short, calibrated per-channel FFTs keep the RTA responsive without changing
 * the detailed frequency history. Every window ends at an absolute frame time:
 * no analyser state, display gain, or playback history affects these dB values. */
export function createStereoRta(channels, sampleRate) {
  if (!channels.length || !(sampleRate > 0)) throw new Error('Decoded channels and sample rate are required');
  const fft = createFFT(RTA_FFT_SIZE);
  const left = channels[0], right = channels[1] || left;

  function transform(channel, endSample, output) {
    const magnitudes = fft.magnitudes(channel, endSample);
    for (let bin = 0; bin < RTA_BINS; bin++) {
      // createFFT compensates the Blackman coherent gain and doubles positive
      // frequencies. DC has no negative-frequency counterpart to combine.
      const magnitude = magnitudes[bin] * (bin === 0 ? 0.5 : 1);
      output[bin] = 20 * Math.log10(Math.max(1e-6, magnitude));
    }
  }

  return function rtaAt(frame) {
    const rtaLeft = new Float32Array(RTA_BINS);
    const rtaRight = new Float32Array(RTA_BINS);
    if (frame <= 0) {
      rtaLeft.fill(RTA_FLOOR_DB);
      rtaRight.fill(RTA_FLOOR_DB);
    } else {
      const endSample = Math.round(frame * sampleRate / ANALYSIS_FPS);
      transform(left, endSample, rtaLeft);
      if (right === left) rtaRight.set(rtaLeft);
      else transform(right, endSample, rtaRight);
    }
    return { rtaLeft, rtaRight };
  };
}

/** Reference-style ballistics reconstructed from track time, never render order.
 * A 2 s warmup leaves less than 0.05 dB of a 120 dB initial-state difference.
 * Two retained 2 s blocks bound worker memory to 1.875 MiB at any track length. */
export function createSmoothedStereoRta(channels, sampleRate) {
  const rawAt = createStereoRta(channels, sampleRate);
  const blockFrames = ANALYSIS_FPS * 2;
  const blocks = new Map();
  const attack = 1 - Math.exp(-1 / (ANALYSIS_FPS * .04));
  const release = 1 - Math.exp(-1 / (ANALYSIS_FPS * .25));

  function buildBlock(start) {
    const left = new Float64Array(RTA_BINS).fill(RTA_FLOOR_DB);
    const right = new Float64Array(RTA_BINS).fill(RTA_FLOOR_DB);
    const block = { left: new Float32Array(blockFrames * RTA_BINS), right: new Float32Array(blockFrames * RTA_BINS) };
    for (let frame = Math.max(0, start - blockFrames); frame < start + blockFrames; frame++) {
      const raw = rawAt(frame);
      for (let bin = 0; bin < RTA_BINS; bin++) {
        left[bin] += (raw.rtaLeft[bin] - left[bin]) * (raw.rtaLeft[bin] > left[bin] ? attack : release);
        right[bin] += (raw.rtaRight[bin] - right[bin]) * (raw.rtaRight[bin] > right[bin] ? attack : release);
      }
      if (frame >= start) {
        const offset = (frame - start) * RTA_BINS;
        block.left.set(left, offset);
        block.right.set(right, offset);
      }
    }
    blocks.set(start, block);
    while (blocks.size > 2) blocks.delete(blocks.keys().next().value);
    return block;
  }

  function smoothedRtaAt(frame) {
    if (!Number.isFinite(frame)) throw new Error('RTA frame must be finite');
    frame = Math.floor(frame);
    if (frame <= 0) return rawAt(frame);
    const start = Math.floor(frame / blockFrames) * blockFrames;
    const block = blocks.get(start) || buildBlock(start);
    const offset = (frame - start) * RTA_BINS;
    // These copies can be transferred to the main thread without detaching the
    // retained block or changing a subsequent request for the same frame.
    return { rtaLeft: block.left.slice(offset, offset + RTA_BINS), rtaRight: block.right.slice(offset, offset + RTA_BINS) };
  }
  smoothedRtaAt.getCacheBytes = () => {
    let bytes = 0;
    for (const block of blocks.values()) bytes += block.left.byteLength + block.right.byteLength;
    return bytes;
  };
  return smoothedRtaAt;
}

/** Compact, immutable whole-track data only: overview and stereo meters.
 * Full-resolution FFT histories are generated separately on demand.
 * step() yields control to the worker between bounded blocks of PCM. */
export function createSignalSummaryBuilder(channels, sampleRate, { overviewBins = OVERVIEW_BINS } = {}) {
  if (!channels.length || !(sampleRate > 0)) throw new Error('Decoded channels and sample rate are required');
  const length = channels[0].length;
  const duration = length / sampleRate;
  const frames = signalFrameIndex(duration, duration) + 1;
  const peaks = new Float32Array(overviewBins);
  const rmsPeaks = new Float32Array(overviewBins);
  const overviewPower = new Float64Array(overviewBins);
  const overviewCounts = new Uint32Array(overviewBins);
  const levels = new Float32Array(frames * LEVEL_STRIDE);
  const left = channels[0];
  const right = channels[1] || left;
  const rmsSamples = Math.max(1, Math.round(sampleRate * 0.05));
  // Monotonic queues retain the exact trailing 50 ms sample maximum in O(n)
  // total work; rescanning a PCM window for every output frame is unnecessary.
  function createPeakWindow(channel) {
    const indices = new Uint32Array(rmsSamples + 1);
    let head = 0, tail = 0;
    return {
      push(index, magnitude) {
        while (head < tail && indices[head % indices.length] <= index - rmsSamples) head++;
        while (head < tail && Math.abs(channel[indices[(tail - 1) % indices.length]]) <= magnitude) tail--;
        indices[tail++ % indices.length] = index;
      },
      get peak() { return head < tail ? Math.abs(channel[indices[head % indices.length]]) : 0; },
    };
  }
  const lPeakWindow = createPeakWindow(left), rPeakWindow = createPeakWindow(right);
  const holdFrames = Math.ceil(ANALYSIS_FPS * 0.75);
  const lHold = new Float32Array(holdFrames);
  const rHold = new Float32Array(holdFrames);
  const attack = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.01));
  const release = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.20));
  const displayRelease = Math.exp(-1 / (ANALYSIS_FPS * 0.20));
  let frame = 0, sample = 0, peakMaximum = 0;
  let lSquare = 0, rSquare = 0, product = 0, lEnvelope = 0, rEnvelope = 0;
  let lDisplayPeak = 0, rDisplayPeak = 0;
  let done = false;

  function step(sampleBudget = 262144) {
    const stop = sample + Math.max(1, sampleBudget);
    while (frame < frames && sample < stop) {
      const end = Math.min(length, Math.round(frame * sampleRate / ANALYSIS_FPS));
      let lPeak = 0, rPeak = 0;
      for (; sample < end; sample++) {
        const l = left[sample], r = right[sample];
        lSquare += l * l;
        rSquare += r * r;
        product += l * r;
        const expired = sample - rmsSamples;
        if (expired >= 0) {
          lSquare -= left[expired] * left[expired];
          rSquare -= right[expired] * right[expired];
          product -= left[expired] * right[expired];
        }
        const lMagnitude = Math.abs(l), rMagnitude = Math.abs(r);
        lPeak = Math.max(lPeak, lMagnitude);
        rPeak = Math.max(rPeak, rMagnitude);
        lPeakWindow.push(sample, lMagnitude);
        rPeakWindow.push(sample, rMagnitude);
        let peak = 0, power = 0;
        for (const channel of channels) {
          const value = channel[sample];
          peak = Math.max(peak, Math.abs(value));
          power += value * value;
        }
        const bin = Math.min(overviewBins - 1, Math.floor(sample * overviewBins / length));
        peaks[bin] = Math.max(peaks[bin], peak);
        overviewPower[bin] += power;
        overviewCounts[bin]++;
        peakMaximum = Math.max(peakMaximum, peak);
      }
      const lRms = Math.sqrt(Math.max(0, lSquare) / rmsSamples);
      const rRms = Math.sqrt(Math.max(0, rSquare) / rmsSamples);
      lEnvelope += (lRms - lEnvelope) * (lRms > lEnvelope ? attack : release);
      rEnvelope += (rRms - rEnvelope) * (rRms > rEnvelope ? attack : release);
      lHold[frame % holdFrames] = lPeak;
      rHold[frame % holdFrames] = rPeak;
      let lHeld = 0, rHeld = 0;
      for (let i = 0; i < holdFrames; i++) {
        lHeld = Math.max(lHeld, lHold[i]);
        rHeld = Math.max(rHeld, rHold[i]);
      }
      const base = frame * LEVEL_STRIDE;
      levels[base] = lEnvelope;
      levels[base + 1] = rEnvelope;
      levels[base + 2] = lHeld;
      levels[base + 3] = rHeld;
      const denominator = Math.sqrt(Math.max(0, lSquare) * Math.max(0, rSquare));
      levels[base + 4] = denominator > 1e-12 ? clamp(product / denominator, -1, 1) : 0;
      // Keep instantaneous measurements separate from display ballistics and
      // held readings, including sample magnitudes above full scale.
      levels[base + 5] = lPeak;
      levels[base + 6] = rPeak;
      lDisplayPeak = Math.max(lPeakWindow.peak, lDisplayPeak * displayRelease);
      rDisplayPeak = Math.max(rPeakWindow.peak, rDisplayPeak * displayRelease);
      levels[base + 7] = lDisplayPeak;
      levels[base + 8] = rDisplayPeak;
      frame++;
    }
    if (frame === frames && !done) {
      // Repeating each source sample avoids empty artificial gaps in tiny clips.
      if (length > 0 && length < overviewBins) {
        for (let bin = 0; bin < overviewBins; bin++) {
          const index = Math.floor(bin * length / overviewBins);
          let peak = 0, power = 0;
          for (const channel of channels) {
            const value = channel[index];
            peak = Math.max(peak, Math.abs(value));
            power += value * value;
          }
          peaks[bin] = peak;
          overviewPower[bin] = power;
          overviewCounts[bin] = 1;
        }
      }
      // Retain both the transient outline and the energy envelope. A single
      // global RMS scale preserves variation between equally limited peaks;
      // averaging channel powers keeps opposing stereo phases from cancelling.
      let rmsMaximum = 0;
      for (let bin = 0; bin < overviewBins; bin++) {
        rmsPeaks[bin] = overviewCounts[bin]
          ? Math.sqrt(overviewPower[bin] / (overviewCounts[bin] * channels.length)) : 0;
        rmsMaximum = Math.max(rmsMaximum, rmsPeaks[bin]);
      }
      if (rmsMaximum > 0) for (let bin = 0; bin < overviewBins; bin++) rmsPeaks[bin] /= rmsMaximum;
      if (peakMaximum > 0) for (let bin = 0; bin < overviewBins; bin++) peaks[bin] /= peakMaximum;
      done = true;
    }
    return frame / frames;
  }
  return { step, get done() { return done; }, summary: {
    peaks, rmsPeaks, levels, levelStride: LEVEL_STRIDE, frames, sampleRate, duration,
  } };
}

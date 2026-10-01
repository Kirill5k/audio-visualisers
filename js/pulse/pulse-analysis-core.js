import { createFFT, ANALYSIS_FPS } from '../starfield/starfield-analysis-core.js';
import { signalFrameIndex, OVERVIEW_BINS } from '../atlas/signal-atlas-analysis-core.js';

export { ANALYSIS_FPS };
export const PULSE_FFT_SIZE = 8192;
export const PULSE_FFT_SIZES = Object.freeze([1024, 2048, 4096, 8192]);
export const PULSE_SMOOTHING = .2;
export const PULSE_FEATURE_STRIDE = 12;
export const PULSE_DEFAULT_BANDS = Object.freeze([
  Object.freeze({ min: 40, max: 120 }),
  Object.freeze({ min: 180, max: 1200 }),
  Object.freeze({ min: 6000, max: 14000 }),
]);

/** Bands are independent: overlap and gaps are both intentional. Defaults are
 * clipped for low-rate recordings; a custom range outside Nyquist is rejected
 * before replacing a loaded track. Return copies so UI edits cannot mutate the
 * configuration of a running analysis. */
export function validatePulseAnalysisOptions(options = {}, sampleRate) {
  if (!options || typeof options !== 'object') throw new Error('Audio analysis options must be an object');
  if (sampleRate !== undefined && (!Number.isFinite(sampleRate) || sampleRate <= 40)) {
    throw new Error('Sample rate must support frequency bands above 20 Hz');
  }
  const maximum = Math.min(22000, sampleRate === undefined ? 22000 : sampleRate / 2);
  const fftSize = options.fftSize ?? PULSE_FFT_SIZE;
  const smoothing = options.smoothing ?? PULSE_SMOOTHING;
  if (!PULSE_FFT_SIZES.includes(fftSize)) throw new Error('FFT size must be 1024, 2048, 4096 or 8192');
  if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > .95) throw new Error('FFT smoothing must be between 0 and 0.95');
  const inputBands = options.bands ?? PULSE_DEFAULT_BANDS;
  if (!Array.isArray(inputBands) || inputBands.length !== 3) throw new Error('Exactly three frequency bands are required');
  const bands = inputBands.map((band, index) => {
    let min = band?.min, max = band?.max;
    if (min === PULSE_DEFAULT_BANDS[index].min && max === PULSE_DEFAULT_BANDS[index].max) {
      min = Math.min(min, maximum - 1);
      max = Math.min(max, maximum);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 20 || max > maximum || min >= max) {
      throw new Error(`Frequency band ${index + 1} must have a minimum of at least 20 Hz and a larger maximum no higher than ${maximum} Hz (Nyquist)`);
    }
    return { min, max };
  });
  return { bands, fftSize, smoothing };
}

function validateChannels(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !(sampleRate > 0) || !Number.isFinite(sampleRate)
    || !channels[0]?.length || !channels.every(channel => channel instanceof Float32Array && channel.length === channels[0].length)) {
    throw new Error('Decoded channels of equal length and a finite positive sample rate are required');
  }
}

/** Raw powers and flux plus Cardiogram's fast/slow followers on an absolute
 * 60 Hz clock. FFT windows end at frame time; every channel is transformed
 * before powers are averaged, preserving opposite stereo phases.
 *
 * Cardiogram maps smoothed FFT magnitudes to frequency bytes at -100 dB and
 * an FFT-adjusted ceiling, averages bytes within each band, then applies 1.18
 * compression. Followers are precomputed so seeks/export share the live trace.
 * Display gain and transient subtraction remain editable in the scene. */
export function createPulseFeatureBuilder(channels, sampleRate, options = {}) {
  validateChannels(channels, sampleRate);
  const config = validatePulseAnalysisOptions(options, sampleRate);
  const { bands: ranges, fftSize, smoothing } = config;
  const length = channels[0].length;
  const duration = length / sampleRate;
  const frames = signalFrameIndex(duration, duration) + 1;
  const data = new Float32Array(frames * PULSE_FEATURE_STRIDE);
  const fft = createFFT(fftSize);
  const bins = fftSize / 2;
  const binMasks = new Uint8Array(bins);
  const bandCounts = new Uint32Array(3);
  const power = new Float64Array(bins);
  const previous = new Float64Array(bins);
  const smoothedMagnitude = new Float64Array(bins);
  const bands = new Float64Array(3);
  const flux = new Float64Array(3);
  const byteSums = new Float64Array(3);
  const fast = new Float64Array(3);
  const slow = new Float64Array(3);
  const binOf = frequency => Math.max(0, Math.min(bins - 1, Math.round(frequency * fftSize / sampleRate)));
  ranges.forEach((range, band) => {
    const low = binOf(range.min), high = Math.max(low, binOf(range.max));
    bandCounts[band] = high - low + 1;
    for (let bin = low; bin <= high; bin++) binMasks[bin] |= 1 << band;
  });
  // The shared FFT corrects Blackman coherent gain and doubles positive
  // frequencies. Undo that normalization for the Web Audio 1/N magnitude.
  const analyserScale = .21 * (fftSize - 1) / fftSize;
  const maxDecibels = -26 - 3 * Math.log2(fftSize / 2048);
  const byteScale = 255 / (maxDecibels + 100);
  let cursor = 0;

  function step(frameBudget = 120) {
    const target = Math.min(frames, cursor + Math.max(1, Math.floor(frameBudget)));
    for (; cursor < target; cursor++) {
      if (cursor === 0) continue;
      const endSample = Math.min(length, Math.round(cursor * sampleRate / ANALYSIS_FPS));
      power.fill(0);
      for (const channel of channels) {
        const magnitudes = fft.magnitudes(channel, endSample);
        for (let bin = 0; bin < bins; bin++) {
          if (binMasks[bin]) power[bin] += magnitudes[bin] * magnitudes[bin];
        }
      }
      bands.fill(0); flux.fill(0); byteSums.fill(0);
      for (let bin = 0; bin < bins; bin++) {
        const mask = binMasks[bin];
        if (!mask) continue;
        const averagedPower = power[bin] / channels.length;
        const magnitude = Math.sqrt(averagedPower);
        const change = Math.max(0, magnitude - previous[bin]);
        previous[bin] = magnitude;
        smoothedMagnitude[bin] = smoothing * smoothedMagnitude[bin] + (1 - smoothing) * magnitude * analyserScale;
        const db = 20 * Math.log10(Math.max(1e-20, smoothedMagnitude[bin]));
        const byte = Math.floor(Math.max(0, Math.min(255, (db + 100) * byteScale)));
        for (let band = 0; band < 3; band++) {
          if (!(mask & (1 << band))) continue;
          bands[band] += averagedPower;
          flux[band] += change;
          byteSums[band] += byte;
        }
      }
      for (let band = 0; band < 3; band++) {
        const energy = (byteSums[band] / bandCounts[band] / 255) ** 1.18;
        fast[band] += (energy - fast[band]) * .55;
        slow[band] += (energy - slow[band]) * .055;
      }
      const base = cursor * PULSE_FEATURE_STRIDE;
      data.set(bands, base);
      data.set(flux, base + 3);
      data.set(fast, base + 6);
      data.set(slow, base + 9);
    }
    return cursor / frames;
  }

  return { step, get done() { return cursor >= frames; }, timeline: { data, frames, sampleRate, duration, ...config } };
}

/** Return independent row values so scene code cannot mutate the shared track
 * timeline. Negative history and requests past the endpoint are silence. */
export function readPulseFrame(timeline, frameIndex) {
  if (!Number.isFinite(frameIndex)) throw new Error('Analysis frame must be finite');
  const frame = Math.floor(frameIndex);
  const row = { frame, time: Math.min(timeline.duration, frame / ANALYSIS_FPS), bands: [0, 0, 0], flux: [0, 0, 0], fast: [0, 0, 0], slow: [0, 0, 0] };
  if (frame < 0 || frame >= timeline.frames) return row;
  const base = frame * PULSE_FEATURE_STRIDE;
  for (let band = 0; band < 3; band++) {
    row.bands[band] = timeline.data[base + band];
    row.flux[band] = timeline.data[base + band + 3];
    row.fast[band] = timeline.data[base + band + 6];
    row.slow[band] = timeline.data[base + band + 9];
  }
  return row;
}

/** Signal Atlas's overview shape without its unused meter calculations: maximum
 * sample magnitude and channel-averaged RMS, each normalized once for the whole
 * track. All PCM samples/channels contribute, including the last partial bin. */
export function createPulseOverviewBuilder(channels, sampleRate, { overviewBins = OVERVIEW_BINS } = {}) {
  validateChannels(channels, sampleRate);
  if (!Number.isInteger(overviewBins) || overviewBins < 1) throw new Error('Overview bin count must be a positive integer');
  const length = channels[0].length;
  const peaks = new Float32Array(overviewBins);
  const rmsPeaks = new Float32Array(overviewBins);
  const powers = new Float64Array(overviewBins);
  const counts = new Uint32Array(overviewBins);
  let cursor = 0, done = false;

  function step(sampleBudget = 262144) {
    const target = Math.min(length, cursor + Math.max(1, Math.floor(sampleBudget)));
    for (; cursor < target; cursor++) {
      const bin = Math.min(overviewBins - 1, Math.floor(cursor * overviewBins / length));
      for (const channel of channels) {
        const value = channel[cursor];
        peaks[bin] = Math.max(peaks[bin], Math.abs(value));
        powers[bin] += value * value;
      }
      counts[bin]++;
    }
    if (cursor === length && !done) {
      // Expand source samples into adjacent bins for sub-bin-size clips; these
      // must not acquire artificial silent gaps simply due to their duration.
      if (length < overviewBins) {
        for (let bin = 0; bin < overviewBins; bin++) {
          const sample = Math.floor(bin * length / overviewBins);
          let peak = 0, power = 0;
          for (const channel of channels) {
            peak = Math.max(peak, Math.abs(channel[sample]));
            power += channel[sample] ** 2;
          }
          peaks[bin] = peak;
          powers[bin] = power;
          counts[bin] = 1;
        }
      }
      let maxPeak = 0, maxRms = 0;
      for (let bin = 0; bin < overviewBins; bin++) {
        rmsPeaks[bin] = counts[bin] ? Math.sqrt(powers[bin] / (counts[bin] * channels.length)) : 0;
        maxPeak = Math.max(maxPeak, peaks[bin]);
        maxRms = Math.max(maxRms, rmsPeaks[bin]);
      }
      for (let bin = 0; bin < overviewBins; bin++) {
        if (maxPeak > 0) peaks[bin] /= maxPeak;
        if (maxRms > 0) rmsPeaks[bin] /= maxRms;
      }
      done = true;
    }
    return cursor / length;
  }

  return { step, get done() { return done; }, summary: { peaks, rmsPeaks } };
}

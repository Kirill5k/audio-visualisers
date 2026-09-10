/** Pure, deterministic DSP used by the worker and the numerical tests. */
export const FFT_SIZE = 32768;
export const FFT_BINS = FFT_SIZE / 2;
export const FAST_FFT_SIZE = 2048;
export const ANALYSIS_FPS = 60;
export const BAND_COUNT = 32;
export const FEATURE_STRIDE = BAND_COUNT * 2 + 6;

const clamp01 = value => Math.max(0, Math.min(1, value));

/** FFT scratch storage is allocated once. Windows end at endSample (exclusive):
 * no lookahead, and missing samples on either side are zero-padded. */
export function createFFT(size) {
  if (size < 2 || (size & (size - 1))) throw new Error('FFT size must be a power of two');
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const bitRev = new Uint32Array(size);
  const window = new Float32Array(size);
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  const magnitudes = new Float32Array(size / 2);
  const bytes = new Uint8Array(size / 2);
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const phase = 2 * Math.PI * i / (size - 1);
    window[i] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2);
    windowSum += window[i];
  }
  for (let i = 1, reversed = 0; i < size; i++) {
    let bit = size >>> 1;
    while (reversed & bit) { reversed ^= bit; bit >>>= 1; }
    reversed ^= bit;
    bitRev[i] = reversed;
  }
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / size);
    sin[i] = Math.sin(-2 * Math.PI * i / size);
  }

  function transform(pcm, endSample) {
    const offset = Math.floor(endSample) - size;
    im.fill(0);
    for (let i = 0; i < size; i++) {
      const source = offset + i;
      re[bitRev[i]] = source >= 0 && source < pcm.length ? pcm[source] * window[i] : 0;
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >>> 1;
      const step = size / length;
      for (let start = 0; start < size; start += length) {
        for (let j = 0; j < half; j++) {
          const even = start + j;
          const odd = even + half;
          const table = j * step;
          const tr = re[odd] * cos[table] - im[odd] * sin[table];
          const ti = re[odd] * sin[table] + im[odd] * cos[table];
          re[odd] = re[even] - tr;
          im[odd] = im[even] - ti;
          re[even] += tr;
          im[even] += ti;
        }
      }
    }
    const scale = 2 / windowSum;
    for (let i = 0; i < magnitudes.length; i++) magnitudes[i] = Math.hypot(re[i], im[i]) * scale;
    return magnitudes;
  }

  return {
    size,
    magnitudes: transform,
    byteSpectrum(pcm, endSample, output = bytes) {
      transform(pcm, endSample);
      // 90 dB of usable detail, with 0 dBFS at the top rather than early clipping.
      for (let i = 0; i < output.length; i++) {
        output[i] = Math.round(clamp01((20 * Math.log10(Math.max(1e-12, magnitudes[i])) + 90) / 90) * 255);
      }
      return output;
    },
  };
}

function makeBandRanges(sampleRate) {
  const ranges = [];
  const maximum = Math.min(22000, sampleRate * 0.49);
  for (let band = 0; band < BAND_COUNT; band++) {
    const low = 35 * (maximum / 35) ** (band / BAND_COUNT);
    const high = 35 * (maximum / 35) ** ((band + 1) / BAND_COUNT);
    ranges.push({
      low: Math.max(1, Math.floor(low * FAST_FFT_SIZE / sampleRate)),
      high: Math.min(FAST_FFT_SIZE / 2 - 1, Math.max(1, Math.ceil(high * FAST_FFT_SIZE / sampleRate))),
      centre: Math.sqrt(low * high),
    });
  }
  return ranges;
}

/** Incremental form lets the worker report progress and yield for cancellation.
 * The compact feature timeline is independent of frame request order. */
export function createFeatureBuilder(pcm, sampleRate) {
  if (!(pcm instanceof Float32Array) || !(sampleRate > 0)) throw new Error('Invalid decoded audio');
  const frames = Math.ceil(pcm.length / sampleRate * ANALYSIS_FPS) + 1;
  const data = new Float32Array(frames * FEATURE_STRIDE);
  const fft = createFFT(FAST_FFT_SIZE);
  const ranges = makeBandRanges(sampleRate);
  const peaks = new Float32Array(BAND_COUNT).fill(0.00001);
  const previous = new Float32Array(BAND_COUNT);
  const envelopes = new Float32Array(BAND_COUNT);
  const fluxAverage = new Float32Array(BAND_COUNT);
  const lastOnset = new Int32Array(BAND_COUNT).fill(-100);
  let cursor = 0;
  let rmsPeak = 0.0001;
  let energyEnvelope = 0;
  let kickEnvelope = 0;
  const peakRelease = Math.exp(-1 / (ANALYSIS_FPS * 8));
  const levelAttack = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.025));
  const levelRelease = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.20));

  function step(count = 120) {
    const target = Math.min(frames, cursor + count);
    for (; cursor < target; cursor++) {
      const frame = cursor;
      const base = frame * FEATURE_STRIDE;
      const end = Math.round(frame * sampleRate / ANALYSIS_FPS);
      const begin = Math.max(0, Math.round((frame - 1) * sampleRate / ANALYSIS_FPS));
      let squareSum = 0;
      for (let sample = begin; sample < Math.min(end, pcm.length); sample++) squareSum += pcm[sample] * pcm[sample];
      const rms = Math.sqrt(squareSum / Math.max(1, end - begin));
      const silent = rms < 0.00008;
      rmsPeak = Math.max(rms, rmsPeak * peakRelease, 0.0001);
      const energyTarget = silent ? 0 : Math.pow(clamp01(rms / (rmsPeak * 1.35)), 0.75);
      energyEnvelope += (energyTarget - energyEnvelope) * (energyTarget > energyEnvelope ? levelAttack : levelRelease);
      const magnitudes = fft.magnitudes(pcm, end);
      let bass = 0, mids = 0, highs = 0, bassOnset = 0;
      let bassCount = 0, midCount = 0, highCount = 0;
      for (let band = 0; band < BAND_COUNT; band++) {
        const range = ranges[band];
        let rawSquare = 0;
        for (let bin = range.low; bin <= range.high; bin++) rawSquare += magnitudes[bin] ** 2;
        const raw = Math.sqrt(rawSquare / (range.high - range.low + 1));
        peaks[band] = Math.max(raw, peaks[band] * peakRelease, 0.00001);
        // Ignore spectral leakage and tiny noise: the threshold scales with the
        // track's recent loudness, so a quiet recording retains the same motion.
        const presence = clamp01((raw / Math.max(rmsPeak, 0.0001) - 0.003) / 0.018);
        const targetLevel = silent ? 0 : Math.pow(clamp01(raw / (peaks[band] * 1.4)), 0.72) * presence;
        envelopes[band] += (targetLevel - envelopes[band]) * (targetLevel > envelopes[band] ? levelAttack : levelRelease);
        const flux = Math.max(0, raw - previous[band]) / peaks[band];
        const threshold = 0.08 + fluxAverage[band] * 1.8;
        const event = !silent && presence > 0.15 && frame - lastOnset[band] >= 5 && flux > threshold
          ? clamp01((flux - threshold) * 1.8 + 0.2) * presence : 0;
        if (event > 0) lastOnset[band] = frame;
        fluxAverage[band] += (flux - fluxAverage[band]) * 0.045;
        previous[band] = raw;
        // Exact silence suppresses events immediately. Light levels then decay
        // naturally over 200 ms without fabricating continued musical activity.
        data[base + band] = envelopes[band];
        data[base + BAND_COUNT + band] = event;
        if (range.centre < 250) { bass += envelopes[band] ** 2; bassCount++; bassOnset = Math.max(bassOnset, event); }
        else if (range.centre < 4000) { mids += envelopes[band] ** 2; midCount++; }
        else { highs += envelopes[band] ** 2; highCount++; }
      }
      kickEnvelope = Math.max(bassOnset, kickEnvelope * Math.exp(-1 / (ANALYSIS_FPS * 0.13)));
      data[base + 64] = Math.sqrt(bass / Math.max(1, bassCount));
      data[base + 65] = Math.sqrt(mids / Math.max(1, midCount));
      data[base + 66] = Math.sqrt(highs / Math.max(1, highCount));
      data[base + 67] = energyEnvelope;
      data[base + 68] = rms;
      data[base + 69] = silent ? 0 : kickEnvelope;
    }
    return cursor / frames;
  }

  return { step, timeline: { data, frames, sampleRate, duration: pcm.length / sampleRate }, get done() { return cursor >= frames; } };
}

export function createFeatureTimeline(pcm, sampleRate) {
  const builder = createFeatureBuilder(pcm, sampleRate);
  builder.step(builder.timeline.frames);
  return builder.timeline;
}

export function readFeatures(timeline, frame) {
  const index = Math.max(0, Math.min(timeline.frames - 1, Math.floor(frame)));
  const base = index * FEATURE_STRIDE;
  const data = timeline.data;
  return {
    levels: data.subarray(base, base + BAND_COUNT),
    onsets: data.subarray(base + BAND_COUNT, base + BAND_COUNT * 2),
    bass: data[base + 64], mids: data[base + 65], highs: data[base + 66],
    energy: data[base + 67], rms: data[base + 68], kick: data[base + 69],
  };
}

/** FIFO keeps getCachedFrame read-only and memory independent of track length. */
export class SpectrumCache {
  constructor(capacity = 120) { this.capacity = Math.max(1, capacity); this.entries = new Map(); }
  get size() { return this.entries.size; }
  get bytes() {
    let bytes = 0;
    for (const spectrum of this.entries.values()) bytes += spectrum.byteLength;
    return bytes;
  }
  get(frame) { return this.entries.get(frame); }
  set(frame, spectrum) {
    this.entries.set(frame, spectrum);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value);
  }
  clear() { this.entries.clear(); }
}

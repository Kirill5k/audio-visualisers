import { createFFT, ANALYSIS_FPS } from '../starfield/starfield-analysis-core.js';
import { signalFrameIndex } from '../atlas/signal-atlas-analysis-core.js';
import { createPulseOverviewBuilder, PULSE_DEFAULT_BANDS } from '../pulse/pulse-analysis-core.js';

export { ANALYSIS_FPS };
export const PHOSPHOR_FFT_SIZE = 4096;
export const PHOSPHOR_CHROMA_FFT_SIZE = 16384;
export const PHOSPHOR_CHROMA_STEP = 6;
export const PHOSPHOR_FLOOR_DB = -96;
export const PHOSPHOR_BAND_FLOOR_DB = -60;
export const PHOSPHOR_BANDS = PULSE_DEFAULT_BANDS;
export const PHOSPHOR_FIELDS = Object.freeze([
  'loudness', 'rmsDb', 'peakDb', 'centroid', 'novelty', 'attackRate', 'tempo', 'key', 'keyScore',
  'correlation', 'sideShare', 'bandLow', 'bandMid', 'bandHigh', 'onset',
]);
export const PHOSPHOR_STRIDE = PHOSPHOR_FIELDS.length;
export const createPhosphorOverviewBuilder = createPulseOverviewBuilder;

const FIELD = Object.fromEntries(PHOSPHOR_FIELDS.map((name, index) => [name, index]));
const LOUDNESS_FRAMES = Math.round(.4 * ANALYSIS_FPS);
const LEVEL_FRAMES = Math.round(.1 * ANALYSIS_FPS);
const CORRELATION_FRAMES = Math.round(.2 * ANALYSIS_FPS);
const CENTROID_FRAMES = 10;
const SIDE_FRAMES = 30;
const NOVELTY_FRAMES = 30;
const ONSET_RADIUS = 4;
const ONSET_THRESHOLD = .35;
const ATTACK_FRAMES = 2 * ANALYSIS_FPS;
const TEMPO_FRAMES = 8 * ANALYSIS_FPS;
const KEY_FRAMES = 20 * ANALYSIS_FPS / PHOSPHOR_CHROMA_STEP;
const CHROMA_LOW_HZ = 80, CHROMA_HIGH_HZ = 5000;
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function validateChannels(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !(sampleRate > 0) || !Number.isFinite(sampleRate)
    || !channels[0]?.length || !channels.every(channel => channel instanceof Float32Array && channel.length === channels[0].length)) {
    throw new Error('Decoded channels of equal length and a finite positive sample rate are required');
  }
}

/** ITU-R BS.1770 K-weighting: a high-shelf pre-filter followed by the RLB high-pass. */
export function kWeightingCoefficients(sampleRate) {
  let f0 = 1681.974450955533, Q = .7071752369554196, K = Math.tan(Math.PI * f0 / sampleRate);
  const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** .4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444; Q = .5003270373238773; K = Math.tan(Math.PI * f0 / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
  return { shelf, highpass };
}

function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = Float64Array.from(values).sort();
  const index = Math.max(0, Math.min(1, p)) * (sorted.length - 1), low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function trailingMean(values, frame, count) {
  let sum = 0, n = 0;
  for (let j = Math.max(0, frame - count + 1); j <= frame; j++) if (Number.isFinite(values[j])) { sum += values[j]; n++; }
  return n ? sum / n : NaN;
}

function keyScores(chroma) {
  const scores = new Float64Array(24);
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += chroma[i] / 12;
  for (let mode = 0; mode < 2; mode++) {
    const profile = mode ? MINOR_PROFILE : MAJOR_PROFILE;
    let profileMean = 0;
    for (let i = 0; i < 12; i++) profileMean += profile[i] / 12;
    for (let tonic = 0; tonic < 12; tonic++) {
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < 12; i++) {
        const x = chroma[(i + tonic) % 12] - mean, y = profile[i] - profileMean;
        num += x * y; dx += x * x; dy += y * y;
      }
      scores[mode * 12 + tonic] = dx > 1e-12 ? num / Math.sqrt(dx * dy) : NaN;
    }
  }
  return scores;
}

/**
 * Whole-track telemetry on the shared 60 Hz clock. Frame f describes audio that ends at
 * round(f × sampleRate / 60):
 * - loudness: BS.1770 momentary (400 ms K-weighted, channel powers summed), LUFS
 * - rmsDb / peakDb: trailing 100 ms over every channel, dBFS
 * - centroid: power centroid of the mid channel (30 Hz–16 kHz), mean of the last 10 frames
 * - correlation: L/R phase correlation over the trailing 200 ms
 * - sideShare: side / (mid + side) power in the mid band, mean of the last 30 frames
 * - key / keyScore: Krumhansl profile fit to 20 s of 10 Hz chroma (index 0–11 major, 12–23 minor)
 * - bandLow/Mid/High: mid-channel band power relative to that band's 97th percentile for the track
 * - novelty / onset / attackRate / tempo: spectral flux above its trailing mean, scaled by the
 *   track's 98th percentile; onsets are confirmed 4 frames later, and attack rate and local tempo
 *   only use confirmed onsets and past novelty. Local tempo searches ±7% around the track tempo.
 * Undefined values (silence, mono side share, no tonal content) are NaN.
 */
export function createPhosphorFeatureBuilder(channels, sampleRate) {
  validateChannels(channels, sampleRate);
  const length = channels[0].length;
  const duration = length / sampleRate;
  const frames = signalFrameIndex(duration, duration) + 1;
  const L = channels[0], R = channels[1] || channels[0];
  const N = PHOSPHOR_FFT_SIZE, bins = N / 2, binHz = sampleRate / N;
  const NC = PHOSPHOR_CHROMA_FFT_SIZE, chromaBinHz = sampleRate / NC;
  const fftMid = createFFT(N), fftSide = createFFT(N), fftChroma = createFFT(NC);
  const midWindow = new Float32Array(N), sideWindow = new Float32Array(N), chromaWindow = new Float32Array(NC);
  const prevLog = new Float32Array(bins);
  const { shelf, highpass } = kWeightingCoefficients(sampleRate);
  const filterState = channels.map(() => new Float64Array(4));
  const segment = { k: new Float64Array(frames), square: new Float64Array(frames), peak: new Float32Array(frames),
    lr: new Float64Array(frames), ll: new Float64Array(frames), rr: new Float64Array(frames) };
  const loudness = new Float32Array(frames), rmsDb = new Float32Array(frames), peakDb = new Float32Array(frames);
  const correlation = new Float32Array(frames), centroidRaw = new Float32Array(frames), flux = new Float32Array(frames);
  const sideRaw = new Float32Array(frames), bandDb = Array.from({ length: 3 }, () => new Float32Array(frames));
  const chromaFrames = Math.floor((frames - 1) / PHOSPHOR_CHROMA_STEP) + 1;
  const chroma = new Float32Array(chromaFrames * 12);
  // Bins are shared between their two nearest pitch classes and each class is divided by its total
  // weight. Otherwise broadband bass energy favours whichever classes happen to get more low bins,
  // which shifts with the sample rate.
  const chromaBins = [], classWeight = new Float64Array(12);
  for (let bin = 1; bin < NC / 2; bin++) {
    const hz = bin * chromaBinHz;
    if (hz < CHROMA_LOW_HZ || hz > CHROMA_HIGH_HZ) continue;
    const pitch = 69 + 12 * Math.log2(hz / 440), below = Math.floor(pitch), fraction = pitch - below;
    const low = ((below % 12) + 12) % 12, high = (low + 1) % 12;
    chromaBins.push({ bin, low, high, lowWeight: 1 - fraction, highWeight: fraction });
    classWeight[low] += 1 - fraction; classWeight[high] += fraction;
  }
  const binOf = hz => Math.max(1, Math.min(bins - 1, Math.round(hz / binHz)));
  const bandBins = PHOSPHOR_BANDS.map(band => [binOf(band.min), Math.max(binOf(band.min), binOf(band.max))]);
  const spectrumLow = binOf(30), spectrumHigh = binOf(Math.min(16000, sampleRate / 2 - binHz));
  const endOf = frame => frame <= 0 ? 0 : Math.min(length, Math.round(frame * sampleRate / ANALYSIS_FPS));
  const data = new Float32Array(frames * PHOSPHOR_STRIDE);
  const timeline = { data, frames, sampleRate, duration, fps: ANALYSIS_FPS, bpm: NaN, bandReferences: [NaN, NaN, NaN] };
  let cursor = 0, finished = false;

  function measureSamples(frame, begin, end) {
    let k = 0, square = 0, peak = 0;
    channels.forEach((channel, index) => {
      const state = filterState[index];
      let [z1, z2, w1, w2] = state;
      for (let i = begin; i < end; i++) {
        const x = channel[i];
        const y = shelf.b0 * x + z1; z1 = shelf.b1 * x - shelf.a1 * y + z2; z2 = shelf.b2 * x - shelf.a2 * y;
        const v = highpass.b0 * y + w1; w1 = highpass.b1 * y - highpass.a1 * v + w2; w2 = highpass.b2 * y - highpass.a2 * v;
        k += v * v; square += x * x;
        const magnitude = x < 0 ? -x : x;
        if (magnitude > peak) peak = magnitude;
      }
      state[0] = z1; state[1] = z2; state[2] = w1; state[3] = w2;
    });
    let lr = 0, ll = 0, rr = 0;
    for (let i = begin; i < end; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
    segment.k[frame] = k; segment.square[frame] = square; segment.peak[frame] = peak;
    segment.lr[frame] = lr; segment.ll[frame] = ll; segment.rr[frame] = rr;
  }

  function trailing(frame, count, end) {
    const first = Math.max(0, frame - count + 1), samples = end - endOf(first - 1);
    let k = 0, square = 0, peak = 0, lr = 0, ll = 0, rr = 0;
    for (let j = first; j <= frame; j++) {
      k += segment.k[j]; square += segment.square[j]; peak = Math.max(peak, segment.peak[j]);
      lr += segment.lr[j]; ll += segment.ll[j]; rr += segment.rr[j];
    }
    return { samples, k, square, peak, lr, ll, rr };
  }

  function measureSpectrum(frame, end) {
    for (let i = 0; i < N; i++) {
      const source = end - N + i;
      const l = source >= 0 ? L[source] : 0, r = source >= 0 ? R[source] : 0;
      midWindow[i] = (l + r) * .5; sideWindow[i] = (l - r) * .5;
    }
    const mid = fftMid.magnitudes(midWindow, N), side = fftSide.magnitudes(sideWindow, N);
    let total = 0, weighted = 0, change = 0;
    for (let bin = 1; bin < bins; bin++) {
      const logMagnitude = Math.log1p(mid[bin] * 1000);
      const rise = Math.max(0, logMagnitude - prevLog[bin]);
      prevLog[bin] = logMagnitude;
      if (bin < spectrumLow || bin > spectrumHigh) continue;
      const power = mid[bin] * mid[bin];
      change += rise; total += power; weighted += power * bin * binHz;
    }
    flux[frame] = change;
    centroidRaw[frame] = total > 1e-12 ? weighted / total : NaN;
    bandBins.forEach(([low, high], band) => {
      let midPower = 0, sidePower = 0;
      for (let bin = low; bin <= high; bin++) { midPower += mid[bin] * mid[bin]; sidePower += side[bin] * side[bin]; }
      bandDb[band][frame] = midPower > 1e-10 ? 10 * Math.log10(midPower) : NaN;
      if (band === 1) sideRaw[frame] = midPower + sidePower > 1e-12 ? sidePower / (midPower + sidePower) : NaN;
    });
    if (frame % PHOSPHOR_CHROMA_STEP) return;
    for (let i = 0; i < NC; i++) {
      const source = end - NC + i;
      chromaWindow[i] = source >= 0 ? (L[source] + R[source]) * .5 : 0;
    }
    const magnitudes = fftChroma.magnitudes(chromaWindow, NC);
    const base = frame / PHOSPHOR_CHROMA_STEP * 12;
    for (const { bin, low, high, lowWeight, highWeight } of chromaBins) {
      if (magnitudes[bin] <= magnitudes[bin - 1] || magnitudes[bin] < magnitudes[bin + 1]) continue;
      const power = magnitudes[bin] * magnitudes[bin];
      chroma[base + low] += power * lowWeight;
      chroma[base + high] += power * highWeight;
    }
    let max = 0;
    for (let pitch = 0; pitch < 12; pitch++) {
      chroma[base + pitch] = classWeight[pitch] > 0 ? Math.sqrt(chroma[base + pitch] / classWeight[pitch]) : 0;
      max = Math.max(max, chroma[base + pitch]);
    }
    for (let pitch = 0; pitch < 12; pitch++) chroma[base + pitch] = max > 1e-5 ? chroma[base + pitch] / max : 0;
  }

  function measureFrame(frame) {
    const end = endOf(frame);
    measureSamples(frame, endOf(frame - 1), end);
    const toDb = power => Math.max(PHOSPHOR_FLOOR_DB, 10 * Math.log10(Math.max(1e-20, power)));
    const momentary = trailing(frame, LOUDNESS_FRAMES, end);
    loudness[frame] = momentary.samples && momentary.k > 0 ? Math.max(PHOSPHOR_FLOOR_DB, -.691 + 10 * Math.log10(momentary.k / momentary.samples)) : PHOSPHOR_FLOOR_DB;
    const level = trailing(frame, LEVEL_FRAMES, end);
    rmsDb[frame] = level.samples ? toDb(level.square / (level.samples * channels.length)) : PHOSPHOR_FLOOR_DB;
    peakDb[frame] = toDb(level.peak * level.peak);
    const stereo = trailing(frame, CORRELATION_FRAMES, end);
    correlation[frame] = stereo.samples && (stereo.ll + stereo.rr) / stereo.samples > 1e-10
      ? Math.max(-1, Math.min(1, stereo.lr / Math.sqrt(stereo.ll * stereo.rr || 1e-30))) : NaN;
    measureSpectrum(frame, end);
  }

  function finish() {
    const novelty = new Float32Array(frames), raw = new Float32Array(frames);
    let sum = 0;
    for (let f = 0; f < frames; f++) {
      const count = Math.min(f, NOVELTY_FRAMES);
      raw[f] = count && rmsDb[f] > -72 ? Math.max(0, flux[f] - sum / count) : 0;
      sum += flux[f];
      if (f >= NOVELTY_FRAMES) sum -= flux[f - NOVELTY_FRAMES];
    }
    const scale = percentile(raw.filter(value => value > 0), .98) || 1;
    for (let f = 0; f < frames; f++) novelty[f] = Math.min(1.5, raw[f] / scale);

    const onset = new Float32Array(frames), confirmed = [];
    for (let f = ONSET_RADIUS; f < frames - ONSET_RADIUS; f++) {
      if (novelty[f] < ONSET_THRESHOLD) continue;
      let peak = true;
      for (let j = f - ONSET_RADIUS; peak && j <= f + ONSET_RADIUS; j++) if (novelty[j] > novelty[f] || (novelty[j] === novelty[f] && j < f)) peak = false;
      if (peak) { onset[f] = Math.min(1, novelty[f]); confirmed.push(f + ONSET_RADIUS); }
    }
    const attackRate = new Float32Array(frames);
    for (let f = 0, first = 0, last = 0; f < frames; f++) {
      while (last < confirmed.length && confirmed[last] <= f) last++;
      while (first < last && confirmed[first] <= f - ATTACK_FRAMES) first++;
      attackRate[f] = (last - first) * ANALYSIS_FPS / ATTACK_FRAMES;
    }

    const autocorrelation = (lag, start, end) => {
      let s = 0;
      for (let j = start + lag; j < end; j++) s += novelty[j] * novelty[j - lag];
      return s;
    };
    const minLag = Math.floor(ANALYSIS_FPS * 60 / 180), maxLag = Math.ceil(ANALYSIS_FPS * 60 / 70);
    const global = [];
    let bestLag = 0, bestScore = 0;
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) global[lag] = autocorrelation(lag, 0, frames);
    for (let lag = minLag; lag <= maxLag; lag++) {
      const prior = Math.exp(-.5 * (Math.log2(ANALYSIS_FPS * 60 / lag / 124) / .45) ** 2);
      if (global[lag] * prior > bestScore) { bestScore = global[lag] * prior; bestLag = lag; }
    }
    const refine = (values, lag) => {
      const a = values[lag - 1], b = values[lag], c = values[lag + 1], curvature = a - 2 * b + c;
      return lag + (curvature < 0 ? Math.max(-.5, Math.min(.5, .5 * (a - c) / curvature)) : 0);
    };
    timeline.bpm = bestLag && confirmed.length >= 4 ? ANALYSIS_FPS * 60 / refine(global, bestLag) : NaN;
    const tempo = new Float32Array(frames).fill(NaN);
    if (Number.isFinite(timeline.bpm)) {
      const lag0 = ANALYSIS_FPS * 60 / timeline.bpm, low = Math.floor(lag0 * .93), high = Math.ceil(lag0 * 1.07);
      let held = NaN;
      for (let f = 0; f < frames; f++) {
        if (f % PHOSPHOR_CHROMA_STEP === 0) {
          const end = f + 1, start = Math.max(0, end - TEMPO_FRAMES), zero = autocorrelation(0, start, end);
          held = NaN;
          if (end - start >= TEMPO_FRAMES / 2 && zero >= 1) {
            const values = [];
            let lag = low;
            for (let candidate = low - 1; candidate <= high + 1; candidate++) values[candidate] = autocorrelation(candidate, start, end);
            for (let candidate = low; candidate <= high; candidate++) if (values[candidate] > values[lag]) lag = candidate;
            if (values[lag] / zero > .12) held = ANALYSIS_FPS * 60 / refine(values, lag);
          }
        }
        tempo[f] = held;
      }
    }

    const keyIndex = new Int8Array(chromaFrames).fill(-1), keyScore = new Float32Array(chromaFrames).fill(NaN);
    const window = new Float64Array(12);
    for (let c = 0; c < chromaFrames; c++) {
      for (let p = 0; p < 12; p++) {
        window[p] += chroma[c * 12 + p];
        if (c >= KEY_FRAMES) window[p] -= chroma[(c - KEY_FRAMES) * 12 + p];
      }
      const scores = keyScores(window);
      let best = -1;
      for (let i = 0; i < 24; i++) if (Number.isFinite(scores[i]) && (best < 0 || scores[i] > scores[best])) best = i;
      if (best >= 0) { keyIndex[c] = best; keyScore[c] = scores[best]; }
    }

    const references = bandDb.map(values => {
      const picked = [];
      for (let f = 0; f < frames; f += 5) if (rmsDb[f] > -72 && Number.isFinite(values[f])) picked.push(values[f]);
      return picked.length ? percentile(picked, .97) : NaN;
    });
    timeline.bandReferences = references;

    for (let f = 0; f < frames; f++) {
      const base = f * PHOSPHOR_STRIDE, c = Math.floor(f / PHOSPHOR_CHROMA_STEP);
      data[base + FIELD.loudness] = loudness[f];
      data[base + FIELD.rmsDb] = rmsDb[f];
      data[base + FIELD.peakDb] = peakDb[f];
      data[base + FIELD.centroid] = trailingMean(centroidRaw, f, CENTROID_FRAMES);
      data[base + FIELD.novelty] = novelty[f];
      data[base + FIELD.attackRate] = attackRate[f];
      data[base + FIELD.tempo] = tempo[f];
      data[base + FIELD.key] = keyIndex[c];
      data[base + FIELD.keyScore] = keyScore[c];
      data[base + FIELD.correlation] = correlation[f];
      data[base + FIELD.sideShare] = trailingMean(sideRaw, f, SIDE_FRAMES);
      for (let band = 0; band < 3; band++) {
        data[base + FIELD.bandLow + band] = Number.isFinite(references[band]) && Number.isFinite(bandDb[band][f]) && rmsDb[f] > -72
          ? Math.max(PHOSPHOR_BAND_FLOOR_DB, bandDb[band][f] - references[band]) : PHOSPHOR_BAND_FLOOR_DB;
      }
      data[base + FIELD.onset] = onset[f];
    }
    finished = true;
  }

  function step(frameBudget = 120) {
    const target = Math.min(frames, cursor + Math.max(1, Math.floor(frameBudget)));
    for (; cursor < target; cursor++) measureFrame(cursor);
    if (cursor >= frames && !finished) finish();
    return finished ? 1 : cursor / frames * .95;
  }

  return { step, get done() { return finished; }, timeline };
}

const SILENT_ROW = Object.freeze({
  loudness: PHOSPHOR_FLOOR_DB, rmsDb: PHOSPHOR_FLOOR_DB, peakDb: PHOSPHOR_FLOOR_DB, centroid: NaN, novelty: 0, attackRate: 0,
  tempo: NaN, key: -1, keyScore: NaN, correlation: NaN, sideShare: NaN, onset: 0,
});

/** Independent row values; frames before the start or past the end of the track read as silence. */
export function readPhosphorFrame(timeline, frameIndex) {
  if (!Number.isFinite(frameIndex)) throw new Error('Analysis frame must be finite');
  const frame = Math.floor(frameIndex);
  const time = Math.max(0, Math.min(timeline.duration, frame / ANALYSIS_FPS));
  if (frame < 0 || frame >= timeline.frames) {
    return { frame, time, ...SILENT_ROW, bands: Array(3).fill(PHOSPHOR_BAND_FLOOR_DB) };
  }
  const base = frame * PHOSPHOR_STRIDE, d = timeline.data;
  return {
    frame, time,
    loudness: d[base + FIELD.loudness], rmsDb: d[base + FIELD.rmsDb], peakDb: d[base + FIELD.peakDb],
    centroid: d[base + FIELD.centroid], novelty: d[base + FIELD.novelty], attackRate: d[base + FIELD.attackRate],
    tempo: d[base + FIELD.tempo], key: d[base + FIELD.key], keyScore: d[base + FIELD.keyScore],
    correlation: d[base + FIELD.correlation], sideShare: d[base + FIELD.sideShare],
    bands: [d[base + FIELD.bandLow], d[base + FIELD.bandMid], d[base + FIELD.bandHigh]], onset: d[base + FIELD.onset],
  };
}

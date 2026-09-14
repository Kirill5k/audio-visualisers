import { createFFT } from '../starfield/starfield-analysis-core.js';
import { createStereoSpectrum } from '../atlas/signal-atlas-analysis-core.js';

export const FFT_SIZE = 32768;
export const FFT_BINS = FFT_SIZE / 2;
export const FAST_FFT_SIZE = 2048;
export const ANALYSIS_FPS = 60;
export const BAND_COUNT = 96;
export const GRID_ROWS = 54;
export const HISTORY_SECONDS = 6;
export const FEATURE_STRIDE = 10;
const clamp01 = value => Math.max(0, Math.min(1, value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Soft logarithmic partition, including DC and the final retained bin. Each
 * frequency bin belongs to exactly one column; no sampled-column shortcuts. */
export function makeLEDBandRanges(sampleRate) {
  const nyquist = sampleRate / 2;
  const softness = 75;
  let previous = 0;
  return Array.from({ length: BAND_COUNT }, (_, band) => {
    const frequency = softness * (Math.exp(Math.log1p(nyquist / softness) * (band + 1) / BAND_COUNT) - 1);
    const end = band === BAND_COUNT - 1 ? FFT_BINS : clamp(Math.round(frequency * FFT_SIZE / sampleRate), previous + 1, FFT_BINS - (BAND_COUNT - band - 1));
    const range = { start: previous, end, low: previous * sampleRate / FFT_SIZE, high: end * sampleRate / FFT_SIZE };
    previous = end;
    return range;
  });
}

export const CHUNK_FRAMES = ANALYSIS_FPS;
const WARMUP_FRAMES = ANALYSIS_FPS * 3;

/** Analysis is cached in canonical one-second chunks. Only a small, fixed set
 * of calibration spectra is read up front. The inexpensive PCM summary gives
 * an absolute loudness scale, so quiet music is never normalized frame by frame.
 * Every chunk starts from the same bounded warmup, regardless of request order. */
export function createLEDChunkAnalyzer(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !(sampleRate > 0) || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length)) {
    throw new Error('Equal-length decoded channels and a positive sample rate are required');
  }
  const length = channels[0].length;
  const frames = Math.ceil(length / sampleRate * ANALYSIS_FPS) + 1;
  const ranges = makeLEDBandRanges(sampleRate);
  const pcm = new Float32Array(frames * 4);
  const maxima = new Float32Array(BAND_COUNT);
  const groupMaxima = new Float32Array(3);
  const spectrumAt = createStereoSpectrum(channels, sampleRate);
  const fastFFT = createFFT(FAST_FFT_SIZE);
  const fastPower = new Float64Array(FAST_FFT_SIZE / 2);
  const magnitudeLookup = Float32Array.from({ length: 65536 }, (_, value) => value === 0 ? 0 : 10 ** ((value / 65535 * 90 - 90) / 20));
  const left = channels[0], right = channels[1] || left;
  let rmsMaximum = 0, globalBandMaximum = 0;
  // A single linear PCM pass is cheap compared with thousands of large FFTs.
  // It also catches isolated impulses that sparse spectral calibration misses.
  for (let frame = 0; frame < frames; frame++) {
    const begin = Math.max(0, Math.round((frame - 1) * sampleRate / ANALYSIS_FPS));
    const end = Math.round(frame * sampleRate / ANALYSIS_FPS);
    const stop = Math.min(end, length);
    let power = 0, lPower = 0, rPower = 0, cross = 0;
    for (let sample = begin; sample < stop; sample++) {
      const l = left[sample], r = right[sample];
      lPower += l * l; rPower += r * r; cross += l * r;
      if (channels.length === 1) power += l * l;
      else if (channels.length === 2) power += l * l + r * r;
      else for (const channel of channels) power += channel[sample] ** 2;
    }
    const rms = Math.sqrt(power / (Math.max(1, end - begin) * channels.length));
    pcm[frame * 4] = rms;
    pcm[frame * 4 + 1] = lPower + rPower > 1e-15 ? (rPower - lPower) / (rPower + lPower) : 0;
    pcm[frame * 4 + 2] = lPower + rPower > 1e-15 ? Math.sqrt(clamp01((lPower + rPower - 2 * cross) / (2 * (lPower + rPower)))) : 0;
    rmsMaximum = Math.max(rmsMaximum, rms);
  }
  function fastGroups(frame) {
    const end = Math.round(frame * sampleRate / ANALYSIS_FPS);
    fastPower.fill(0);
    for (const channel of channels) {
      const magnitudes = fastFFT.magnitudes(channel, end);
      for (let bin = 0; bin < magnitudes.length; bin++) fastPower[bin] += magnitudes[bin] ** 2 / channels.length;
    }
    const groups = new Float64Array(3);
    for (let bin = 0; bin < fastPower.length; bin++) {
      const frequency = bin * sampleRate / FAST_FFT_SIZE;
      groups[frequency < 250 ? 0 : frequency < 4000 ? 1 : 2] += fastPower[bin];
    }
    for (let group = 0; group < 3; group++) groups[group] = Math.sqrt(groups[group]);
    return groups;
  }
  function spectralBands(frame, output) {
    const end = Math.round(frame * sampleRate / ANALYSIS_FPS);
    const spectrum = spectrumAt((end + FFT_SIZE / 2) / sampleRate * ANALYSIS_FPS);
    for (let band = 0; band < BAND_COUNT; band++) {
      const range = ranges[band];
      let sum = 0, maximum = 0;
      for (let bin = range.start; bin < range.end; bin++) {
        const magnitude = magnitudeLookup[spectrum[bin]];
        sum += magnitude * magnitude;
        maximum = Math.max(maximum, magnitude);
      }
      output[band] = maximum * 0.8 + Math.sqrt(sum / (range.end - range.start)) * 0.2;
    }
    return output;
  }
  // Fixed positions make the scale deterministic even when seeking before any
  // playback. The upper bound is independent of track length: 48, not every frame.
  const calibrationCount = Math.min(48, frames);
  const calibration = new Float32Array(BAND_COUNT);
  for (let index = 0; index < calibrationCount; index++) {
    const frame = Math.min(frames - 1, Math.floor((index + 0.5) * frames / calibrationCount));
    spectralBands(frame, calibration);
    const groups = fastGroups(frame);
    for (let group = 0; group < 3; group++) groupMaxima[group] = Math.max(groupMaxima[group], groups[group]);
    for (let band = 0; band < BAND_COUNT; band++) {
      maxima[band] = Math.max(maxima[band], calibration[band]);
      globalBandMaximum = Math.max(globalBandMaximum, calibration[band]);
    }
  }
  const metadata = { frames, sampleRate, duration: length / sampleRate, ranges, calibrationFrames: calibrationCount };
  function createChunk(chunkIndex) {
    const first = chunkIndex * CHUNK_FRAMES;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || first >= frames) throw new Error('Invalid analysis chunk');
    const count = Math.min(CHUNK_FRAMES, frames - first), stop = first + count;
    const bands = new Uint16Array(count * BAND_COUNT), features = new Float32Array(count * FEATURE_STRIDE), events = [];
    const envelopes = new Float64Array(4), previousGroups = new Float64Array(3), fluxAverage = new Float64Array(3), onsetEnvelopes = new Float64Array(3);
    const lastEvents = new Int32Array(3).fill(-100);
    const rawBands = new Float32Array(BAND_COUNT);
    const rmsScale = Math.max(0.0001, rmsMaximum);
    const attack = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.012));
    const release = 1 - Math.exp(-1 / (ANALYSIS_FPS * 0.19));
    let cursor = Math.max(0, first - WARMUP_FRAMES), previousRms = 0;
    function analyzeFrame(frame) {
      const local = frame - first, base = local * FEATURE_STRIDE;
      const rms = pcm[frame * 4];
      const energyTarget = rms < 0.000008 ? 0 : Math.pow(clamp01(rms / rmsScale), 0.82);
      envelopes[3] += (energyTarget - envelopes[3]) * (energyTarget > envelopes[3] ? attack : release);
      if (envelopes[3] < 0.00001) envelopes[3] = 0;
      const positiveRms = Math.max(0, rms - previousRms) / rmsScale;
      const active = rms >= 0.000008, groups = fastGroups(frame);
      for (let group = 0; group < 3; group++) {
        const rawLevel = groups[group];
        const scale = Math.max(groupMaxima[group], rmsScale * 0.025, 0.00001);
        const groupLevel = clamp01(rawLevel / scale);
        const target = active ? groupLevel ** 0.68 * energyTarget ** 0.4 : 0;
        envelopes[group] += (target - envelopes[group]) * (target > envelopes[group] ? attack : release);
        if (envelopes[group] < 0.00001) envelopes[group] = 0;
        const flux = Math.max(0, rawLevel - previousGroups[group]) / scale;
        const threshold = 0.07 + fluxAverage[group] * 1.5;
        const spectralShare = Math.sqrt(rawLevel / Math.max(groups[0], groups[1], groups[2], 1e-15));
        const edge = positiveRms * 0.8 * spectralShare;
        const novelty = Math.max(flux, edge);
        const onset = active && frame - lastEvents[group] >= 5 && novelty > threshold
          ? clamp01((novelty - threshold) * 1.8 + 0.16) * energyTarget : 0;
        if (onset > 0.025) {
          lastEvents[group] = frame;
          if (local >= 0) events.push({ time: frame / ANALYSIS_FPS, band: group, strength: onset, balance: pcm[frame * 4 + 1] });
        }
        onsetEnvelopes[group] = Math.max(onset, onsetEnvelopes[group] * Math.exp(-1 / (ANALYSIS_FPS * 0.075)));
        if (onsetEnvelopes[group] < 0.00001) onsetEnvelopes[group] = 0;
        if (local >= 0) { features[base + group] = envelopes[group]; features[base + 7 + group] = onsetEnvelopes[group]; }
        fluxAverage[group] += (flux - fluxAverage[group]) * 0.06;
        previousGroups[group] = rawLevel;
      }
      previousRms = rms;
      if (local < 0) return;
      features[base + 3] = envelopes[3]; features[base + 4] = rms;
      features[base + 5] = pcm[frame * 4 + 1]; features[base + 6] = pcm[frame * 4 + 2];
      spectralBands(frame, rawBands);
      for (let band = 0; band < BAND_COUNT; band++) {
        const scale = Math.max(maxima[band], globalBandMaximum * 0.04, 0.00003);
        const presence = clamp01((rawBands[band] - globalBandMaximum * 0.00015) / scale);
        const value = Math.pow(presence, 0.72) * Math.pow(envelopes[3], 0.78);
        bands[local * BAND_COUNT + band] = Math.round(clamp01(value) * 65535);
      }
    }
    return { chunk: { index: chunkIndex, first, count, bands, features, events },
      step(budget = 8) { const end = Math.min(stop, cursor + Math.max(1, Math.floor(budget))); for (; cursor < end; cursor++) analyzeFrame(cursor); return (cursor - Math.max(0, first - WARMUP_FRAMES)) / (stop - Math.max(0, first - WARMUP_FRAMES)); },
      get done() { return cursor >= stop; } };
  }
  return { metadata, createChunk };
}

/** Sequential utility for tests and callers that explicitly want a full
 * timeline. It uses the exact same canonical chunks as interactive playback. */
export function createLEDTimelineBuilder(channels, sampleRate) {
  const analyzer = createLEDChunkAnalyzer(channels, sampleRate), metadata = analyzer.metadata;
  const timeline = { ...metadata, bands: new Uint16Array(metadata.frames * BAND_COUNT), features: new Float32Array(metadata.frames * FEATURE_STRIDE), events: [] };
  let chunkIndex = 0, active = analyzer.createChunk(0), completed = 0;
  function step(frameBudget = 12) {
    if (!active) return 1;
    active.step(frameBudget);
    if (active.done) {
      const chunk = active.chunk;
      timeline.bands.set(chunk.bands, chunk.first * BAND_COUNT);
      timeline.features.set(chunk.features, chunk.first * FEATURE_STRIDE);
      timeline.events.push(...chunk.events); completed += chunk.count;
      chunkIndex++;
      active = completed < metadata.frames ? analyzer.createChunk(chunkIndex) : null;
    }
    return completed / metadata.frames;
  }
  return { timeline, step, get done() { return !active; } };
}

/** Returned frame, typed arrays, and events array are reused. Copy values before
 * retaining them. Reads only immutable timeline data; call order is irrelevant. */
export function createLEDFrameReader(timeline) {
  // Fixed source times keep historical musical gestures identical when seeking,
  // replaying or exporting. These are reads of cached analysis, not new FFTs.
  const flowPool = Array.from({ length: HISTORY_SECONDS * 5 + 1 }, () => ({
    time: 0, bands: new Float32Array(BAND_COUNT),
    features: { bass: 0, mids: 0, highs: 0, energy: 0, balance: 0, width: 0 },
  }));
  const output = { time: 0, frame: 0, bands: new Float32Array(BAND_COUNT), history: new Float32Array(BAND_COUNT * GRID_ROWS),
    features: { bass: 0, mids: 0, highs: 0, energy: 0, rms: 0, balance: 0, width: 0, onsets: new Float32Array(3) }, events: [], flowFrames: [] };
  return function atTime(time) {
    if (!Number.isFinite(time)) throw new Error('Analysis time must be finite');
    const bounded = clamp(time, 0, timeline.duration);
    const frame = Math.min(timeline.frames - 1, Math.floor(bounded * ANALYSIS_FPS + 1e-7));
    output.frame = frame; output.time = bounded;
    const base = frame * FEATURE_STRIDE;
    const values = timeline.features;
    Object.assign(output.features, { bass: values[base], mids: values[base + 1], highs: values[base + 2], energy: values[base + 3], rms: values[base + 4], balance: values[base + 5], width: values[base + 6] });
    for (let group = 0; group < 3; group++) output.features.onsets[group] = values[base + 7 + group];
    for (let band = 0; band < BAND_COUNT; band++) output.bands[band] = timeline.bands[frame * BAND_COUNT + band] / 65535;
    output.flowFrames.length = 0;
    const firstTick = Math.max(0, Math.ceil((bounded - HISTORY_SECONDS) * 5 - 1e-7));
    const lastTick = Math.floor(frame / (ANALYSIS_FPS / 5));
    for (let tick = firstTick; tick <= lastTick; tick++) {
      const snapshot = flowPool[output.flowFrames.length];
      const sourceFrame = tick * (ANALYSIS_FPS / 5);
      const source = sourceFrame * FEATURE_STRIDE;
      snapshot.time = tick / 5;
      for (let band = 0; band < BAND_COUNT; band++) snapshot.bands[band] = timeline.bands[sourceFrame * BAND_COUNT + band] / 65535;
      Object.assign(snapshot.features, { bass: values[source], mids: values[source + 1], highs: values[source + 2],
        energy: values[source + 3], balance: values[source + 5], width: values[source + 6] });
      output.flowFrames.push(snapshot);
    }
    output.history.fill(0);
    const rowsPerSecond = GRID_ROWS / HISTORY_SECONDS;
    const firstHistorical = Math.max(0, Math.ceil((bounded - HISTORY_SECONDS) * ANALYSIS_FPS));
    for (let historical = firstHistorical; historical <= frame; historical++) {
      const age = (bounded - historical / ANALYSIS_FPS) * rowsPerSecond;
      if (age < 0 || age >= GRID_ROWS) continue;
      const row = Math.floor(age), phase = age - row;
      let firstRow = row, secondRow = -1, firstWeight = 1, secondWeight = 0;
      // Transfer light across a boundary over half a row (55.6 ms). The LED
      // positions stay fixed. Equal-power weights keep brief peaks visible;
      // smoothstep gives the transfer a gentle start and finish.
      if (phase < .25 && row > 0) {
        const u = (phase + .25) * 2, blend = u * u * (3 - 2 * u);
        firstRow = row - 1; secondRow = row;
        firstWeight = Math.cos(blend * Math.PI * .5);
        secondWeight = Math.sin(blend * Math.PI * .5);
      } else if (phase > .75 && row < GRID_ROWS - 1) {
        const u = (phase - .75) * 2, blend = u * u * (3 - 2 * u);
        secondRow = row + 1;
        firstWeight = Math.cos(blend * Math.PI * .5);
        secondWeight = Math.sin(blend * Math.PI * .5);
      }
      // New attacks enter row zero immediately. Old light fades before the
      // six-second cache boundary, so removing it cannot cause a final pop.
      if (age > GRID_ROWS - .5) {
        const u = (age - GRID_ROWS + .5) * 2, blend = u * u * (3 - 2 * u);
        firstWeight *= Math.cos(blend * Math.PI * .5);
      }
      const source = historical * BAND_COUNT, firstTarget = firstRow * BAND_COUNT, secondTarget = secondRow * BAND_COUNT;
      for (let band = 0; band < BAND_COUNT; band++) {
        const value = timeline.bands[source + band] / 65535;
        // Max aggregation still visits every analysis sample in the complete
        // interval; a one-frame transient is never diluted by averaging.
        output.history[firstTarget + band] = Math.max(output.history[firstTarget + band], value * firstWeight);
        if (secondRow >= 0) output.history[secondTarget + band] = Math.max(output.history[secondTarget + band], value * secondWeight);
      }
    }
    output.events.length = 0;
    let low = 0, high = timeline.events.length;
    const earliest = bounded - HISTORY_SECONDS;
    while (low < high) { const middle = (low + high) >>> 1; if (timeline.events[middle].time < earliest) low = middle + 1; else high = middle; }
    for (let index = low; index < timeline.events.length && timeline.events[index].time <= bounded + 1e-7; index++) output.events.push(timeline.events[index]);
    return output;
  };
}

/** Deterministic eight-second representatives, frozen before visual review. */
export function selectReviewPassages(timeline) {
  const duration = 8;
  const latest = Math.max(0, timeline.duration - duration);
  let quiet = { start: 0, score: Infinity }, dense = { start: 0, score: -Infinity }, change = { start: 0, score: -Infinity };
  for (let start = 0; start <= latest + 1e-8; start += 0.5) {
    const first = Math.floor(start * ANALYSIS_FPS);
    const last = Math.min(timeline.frames, Math.floor((start + duration) * ANALYSIS_FPS));
    let sum = 0, before = 0, after = 0;
    const midpoint = Math.floor((first + last) / 2);
    for (let frame = first; frame < last; frame++) {
      const energy = timeline.features[frame * FEATURE_STRIDE + 3];
      sum += energy;
      if (frame < midpoint) before += energy; else after += energy;
    }
    const average = sum / Math.max(1, last - first);
    const contrast = Math.abs(before / Math.max(1, midpoint - first) - after / Math.max(1, last - midpoint));
    if (average < quiet.score) quiet = { start, score: average };
    if (average > dense.score) dense = { start, score: average };
    if (contrast > change.score) change = { start, score: contrast };
  }
  return [{ name: 'quiet', start: quiet.start, duration }, { name: 'dense', start: dense.start, duration }, { name: 'change', start: change.start, duration }];
}

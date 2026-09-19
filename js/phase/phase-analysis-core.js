import { createFFT } from '../starfield/starfield-analysis-core.js';

export { FFT_SIZE, FFT_BINS } from '../starfield/starfield-analysis-core.js';
import { FFT_SIZE, FFT_BINS } from '../starfield/starfield-analysis-core.js';
export const ANALYSIS_FPS = 60;
export const FEATURE_STRIDE = 6;
export const SHAPE_NAMES = ['Phase portrait', 'Closed orbit', 'Radial crown', 'Vertical rails', 'Hourglass'];
export const MORPH_SECONDS = 0.8;
const FAST_SIZE = 2048;
const DESCRIPTOR_BANDS = 12;
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => value * value * (3 - 2 * value);

function validate(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !(sampleRate > 0)
    || channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length)) {
    throw new Error('Equal-length decoded channels and a positive sample rate are required');
  }
}

/** Compact whole-track features. Stereo channel POWER is combined after each
 * FFT, so opposite-polarity stereo and single-sided recordings stay visible.
 * Only the 2048-point onset analysis is precomputed; display FFTs retain every
 * one of the 16,384 bins and are evaluated at the requested absolute time. */
export function createPhaseTimelineBuilder(channels, sampleRate) {
  validate(channels, sampleRate);
  const duration = channels[0].length / sampleRate;
  const frames = Math.ceil(duration * ANALYSIS_FPS) + 1;
  const data = new Float32Array(frames * FEATURE_STRIDE);
  const blockPeaks = new Float32Array(frames);
  const descriptors = new Float32Array(frames * DESCRIPTOR_BANDS);
  const bandLevels = new Float32Array(frames * DESCRIPTOR_BANDS);
  const fft = createFFT(FAST_SIZE);
  const power = new Float64Array(FAST_SIZE / 2);
  const descriptorPower = new Float64Array(DESCRIPTOR_BANDS);
  const binBand = Uint8Array.from({ length: power.length }, (_, bin) => Math.min(DESCRIPTOR_BANDS - 1,
    Math.max(0, Math.floor(Math.log1p(bin * sampleRate / FAST_SIZE / 45) / Math.log1p(sampleRate / 2 / 45) * DESCRIPTOR_BANDS))));
  let cursor = 0, finished = false, previousBass = 0, averageBass = 0, averageFlux = 0, kick = 0, lastKick = -100;
  const timeline = { data, frames, duration, sampleRate, sections: [] };

  function finish() {
    const scales = [0, 1, 2, 3].map(feature => {
      const values = Float32Array.from({ length: frames }, (_, frame) => data[frame * FEATURE_STRIDE + feature]);
      values.sort();
      return Math.max(0.0001, values[Math.floor((frames - 1) * 0.98)]);
    });
    // One fixed peak calibration preserves loud/quiet contrast. The robust
    // block-peak percentile puts typical peaks at 0.9 without letting a lone
    // click shrink the entire track; bounded gain keeps low noise unobtrusive.
    blockPeaks.sort();
    const scopePeak = Math.max(0.0001, blockPeaks[Math.floor((frames - 1) * 0.98)]);
    timeline.scopeGain = Math.min(8, Math.max(0.7, 0.9 / scopePeak));
    // Arrangement detection consumes raw powers, before display envelopes are normalized.
    timeline.sections = detectSections(timeline, descriptors, bandLevels);
    const envelopes = [0, 0, 0, 0];
    for (let frame = 0; frame < frames; frame++) {
      const base = frame * FEATURE_STRIDE;
      for (let feature = 0; feature < 4; feature++) {
        const raw = data[base + feature];
        const target = raw < 0.000015 ? 0 : Math.pow(clamp01(raw / scales[feature]), feature === 3 ? 0.8 : 0.72);
        const speed = target > envelopes[feature] ? 0.42 : 0.12;
        envelopes[feature] += (target - envelopes[feature]) * speed;
        data[base + feature] = envelopes[feature] < 1e-7 ? 0 : envelopes[feature];
      }
    }
    finished = true;
  }

  function step(count = 120) {
    if (finished) return 1;
    const target = Math.min(frames, cursor + Math.max(1, Math.floor(count)));
    for (; cursor < target; cursor++) {
      const end = Math.round(cursor * sampleRate / ANALYSIS_FPS);
      const begin = Math.max(0, Math.round((cursor - 1) * sampleRate / ANALYSIS_FPS));
      const stop = Math.min(end, channels[0].length);
      let square = 0, blockPeak = 0;
      power.fill(0); descriptorPower.fill(0);
      for (const channel of channels) {
        for (let sample = begin; sample < stop; sample++) {
          square += channel[sample] ** 2;
          blockPeak = Math.max(blockPeak, Math.abs(channel[sample]));
        }
        const magnitudes = fft.magnitudes(channel, end);
        for (let bin = 1; bin < power.length; bin++) power[bin] += magnitudes[bin] ** 2 / channels.length;
      }
      const rms = Math.sqrt(square / (Math.max(1, end - begin) * channels.length));
      blockPeaks[cursor] = blockPeak;
      let bass = 0, mids = 0, highs = 0, total = 0;
      for (let bin = 1; bin < power.length; bin++) {
        const hz = bin * sampleRate / FAST_SIZE;
        if (hz < 250) bass += power[bin];
        else if (hz < 4000) mids += power[bin];
        else highs += power[bin];
        descriptorPower[binBand[bin]] += power[bin];
        total += power[bin];
      }
      bass = Math.sqrt(bass); mids = Math.sqrt(mids); highs = Math.sqrt(highs);
      averageBass += (bass - averageBass) * 0.03;
      const flux = Math.max(0, bass - previousBass) / Math.max(0.003, averageBass);
      const threshold = Math.max(0.22, averageFlux * 2.2);
      let onset = 0;
      if (rms > 0.00008 && bass > 0.001 && flux > threshold && cursor - lastKick >= 7) {
        onset = clamp01((flux - threshold) * 0.65 + 0.25);
        lastKick = cursor;
      }
      averageFlux += (flux - averageFlux) * 0.04;
      previousBass = bass;
      kick = rms < 0.00008 ? 0 : Math.max(onset, kick * Math.exp(-1 / (ANALYSIS_FPS * 0.14)));
      const base = cursor * FEATURE_STRIDE;
      data[base] = bass; data[base + 1] = mids; data[base + 2] = highs;
      data[base + 3] = rms; data[base + 4] = kick; data[base + 5] = rms;
      for (let band = 0; band < DESCRIPTOR_BANDS; band++) {
        descriptors[cursor * DESCRIPTOR_BANDS + band] = total > 1e-12 ? descriptorPower[band] / total : 0;
        bandLevels[cursor * DESCRIPTOR_BANDS + band] = Math.sqrt(descriptorPower[band]);
      }
    }
    if (cursor >= frames) finish();
    return cursor / frames;
  }
  return { step, timeline, get done() { return finished; } };
}

/** Describe arrangement, not elapsed time or master gain. The entire decoded
 * track is available, so a boundary can be validated against the following
 * three seconds and still be placed at the musical event. Independent bass
 * sustain, percussion onset density and normalized spectral texture distinguish
 * layer entries/exits from isolated hits and ordinary beats. */
function detectSections(timeline, descriptors, bandLevels) {
  const { data, frames, duration, sampleRate } = timeline;
  const percentile = (values, quantile) => {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] || 0;
  };
  const rms95 = percentile(Array.from({ length: frames }, (_, i) => data[i * FEATURE_STRIDE + 5]), 0.95);
  const silenceFloor = Math.max(0.00008, rms95 * 0.008);
  // Normalize onset magnitudes by a slow local level, so the same rhythm
  // yields the same event rate after a master fade or gain change.
  const rmsPrefix = new Float64Array(frames + 1);
  for (let frame = 0; frame < frames; frame++) rmsPrefix[frame + 1] = rmsPrefix[frame] + data[frame * FEATURE_STRIDE + 5];
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.max(0, frame - 90), end = Math.min(frames, frame + 90);
    const localLevel = Math.max(silenceFloor, (rmsPrefix[end] - rmsPrefix[start]) / (end - start));
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) bandLevels[frame * DESCRIPTOR_BANDS + band] /= localLevel;
  }
  const bandScales = Array.from({ length: DESCRIPTOR_BANDS }, (_, band) => percentile(Array.from({ length: frames }, (_, i) => bandLevels[i * DESCRIPTOR_BANDS + band]), 0.95));
  const globalBandScale = Math.max(...bandScales);
  const floors = bandScales.map(scale => Math.max(0.000004, globalBandScale * 0.018, scale * 0.055));
  const bassFractions = new Float32Array(frames);
  const onsets = new Float32Array(frames);
  const percussion = new Float32Array(frames);
  const onsetNovelty = new Float32Array(frames), percussionNovelty = new Float32Array(frames);
  const bandCenter = band => 45 * (Math.expm1((band + 0.5) / DESCRIPTOR_BANDS * Math.log1p(sampleRate / 2 / 45)));
  for (let frame = 1; frame < frames; frame++) {
    const base = frame * FEATURE_STRIDE;
    const total = data[base] ** 2 + data[base + 1] ** 2 + data[base + 2] ** 2;
    if (data[base + 5] <= silenceFloor || total < 1e-12) continue;
    bassFractions[frame] = data[base] ** 2 / total;
    let bassFlux = 0, percussionFlux = 0, percussionWeight = 0, brightAttacks = 0;
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) {
      const current = bandLevels[frame * DESCRIPTOR_BANDS + band];
      const previous = bandLevels[(frame - 1) * DESCRIPTOR_BANDS + band];
      const floor = floors[band];
      // Log differences make a sustained gain change nearly irrelevant. The
      // track-relative floor prevents inaudible FFT leakage from becoming hats.
      const rise = current > floor * 2 ? Math.max(0, Math.log((current + floor) / (previous + floor))) : 0;
      const hz = bandCenter(band);
      if (hz < 250) bassFlux = Math.max(bassFlux, rise);
      else {
        if (hz > 700 && rise > 0.23 && current > floor * 2) brightAttacks++;
        const weight = Math.min(1, current / (globalBandScale * 0.06 + floor));
        percussionFlux += rise * weight;
        percussionWeight += weight;
      }
    }
    percussionFlux /= Math.max(1, percussionWeight);
    onsetNovelty[frame] = Math.max(percussionFlux, bassFlux * 0.4);
    percussionNovelty[frame] = brightAttacks >= 2 ? percussionFlux : bassFlux > 0.65 ? bassFlux * 0.35 : 0;
  }
  function pickOnsets(novelty, output, floor) {
    let last = -100;
    for (let frame = 3; frame < frames - 3; frame++) {
      const value = novelty[frame];
      if (value < floor || frame - last < 6) continue;
      let peak = true;
      for (let i = frame - 3; i <= frame + 3; i++) if (novelty[i] > value || (novelty[i] === value && i < frame)) peak = false;
      if (!peak) continue;
      const start = Math.max(0, frame - 24), end = Math.min(frames, frame + 25);
      let mean = 0;
      for (let i = start; i < end; i++) mean += novelty[i];
      mean /= end - start;
      if (value < mean * 1.6 + floor * 0.25) continue;
      output[frame] = 1;
      last = frame;
    }
  }
  pickOnsets(onsetNovelty, onsets, 0.085);
  pickOnsets(percussionNovelty, percussion, 0.11);
  // Compare spectral layers using amplitude shares. Power shares otherwise
  // let a loud bass note mask a new pad, melody or percussion layer entirely.
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) sum += Math.sqrt(descriptors[frame * DESCRIPTOR_BANDS + band]);
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) descriptors[frame * DESCRIPTOR_BANDS + band] = sum > 1e-8 ? Math.sqrt(descriptors[frame * DESCRIPTOR_BANDS + band]) / sum : 0;
  }
  const columns = DESCRIPTOR_BANDS * 2 + 3;
  const prefix = new Float64Array((frames + 1) * columns);
  for (let frame = 0; frame < frames; frame++) {
    const previous = frame * columns, next = previous + columns;
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) {
      prefix[next + band] = prefix[previous + band] + descriptors[frame * DESCRIPTOR_BANDS + band];
      const activity = bandScales[band] > globalBandScale * 0.018
        ? clamp01(bandLevels[frame * DESCRIPTOR_BANDS + band] / Math.max(floors[band] * 4, bandScales[band])) : 0;
      prefix[next + 15 + band] = prefix[previous + 15 + band] + activity;
    }
    prefix[next + 12] = prefix[previous + 12] + onsets[frame];
    prefix[next + 13] = prefix[previous + 13] + percussion[frame];
    prefix[next + 14] = prefix[previous + 14] + (data[frame * FEATURE_STRIDE + 5] > silenceFloor ? 1 : 0);
  }
  function descriptor(from, to) {
    const start = Math.max(0, Math.min(frames - 1, Math.round(from * ANALYSIS_FPS)));
    const end = Math.max(start + 1, Math.min(frames, Math.round(to * ANALYSIS_FPS)));
    const count = end - start, seconds = count / ANALYSIS_FPS;
    const values = Array.from({ length: columns }, (_, column) => (prefix[end * columns + column] - prefix[start * columns + column]) / count);
    const spectrum = values.slice(0, 12);
    const active = values[14];
    const layers = values.slice(15, 27);
    const layerActivity = layers.reduce((sum, value) => sum + value, 0) / DESCRIPTOR_BANDS;
    const spectralDiversity = clamp01(-spectrum.reduce((sum, value) => sum + (value > 1e-8 ? value * Math.log(value) : 0), 0) / Math.log(DESCRIPTOR_BANDS));
    const bandOccupancy = spectrum.filter(value => value > 0.025).length / DESCRIPTOR_BANDS;
    const onsetRate = values[12] * ANALYSIS_FPS;
    const percussionRate = values[13] * ANALYSIS_FPS;
    // The lower quantile rejects the bass energy of short kicks: a bassline
    // must remain present between attacks to register as an entering layer.
    const bassWindow = bassFractions.subarray(start, end);
    const bassFloor = percentile(bassWindow, 0.35);
    const bassMean = bassWindow.reduce((sum, value) => sum + value, 0) / count;
    const bassPresence = active > 0.5 ? smoothstep(clamp01((bassFloor - 0.055) / 0.58)) : 0;
    // At least three attacks are needed. One crash/fill is not a drum passage.
    const drumPresence = values[13] * count >= Math.max(3, seconds * 0.7) ? 1 - Math.exp(-Math.max(0, percussionRate - 0.35) / 3.5) : 0;
    const onsetDensity = clamp01(onsetRate / 11);
    const complexity = active > 0.15 ? clamp01(onsetDensity * 0.32 + spectralDiversity * 0.16 + bandOccupancy * 0.14 + layerActivity * 0.38) : 0;
    const metrics = { complexity, size: 0.7 + complexity * 0.6, bassPresence, drumPresence, onsetDensity, spectralDiversity, bandOccupancy, layerActivity };
    return { spectrum, layers, active, bassFloor, bassMean, onsetRate, percussionRate, metrics };
  }
  const timbreDistance = (a, b) => a.spectrum.reduce((sum, value, band) => sum + Math.abs(value - b.spectrum[band]), 0) * 0.5;
  const layerDistance = (a, b) => a.layers.reduce((sum, value, band) => sum + Math.abs(value - b.layers[band]), 0) / DESCRIPTOR_BANDS;
  function compare(left, right, first, second) {
    const bass = right.metrics.bassPresence - left.metrics.bassPresence;
    const drums = right.metrics.drumPresence - left.metrics.drumPresence;
    const complexity = right.metrics.complexity - left.metrics.complexity;
    const timbre = timbreDistance(left, right);
    const rate = right.percussionRate - left.percussionRate;
    const stable = (key, delta, minimum) => [first, second].every(part => Math.sign(delta) * (part.metrics[key] - left.metrics[key]) > minimum);
    const evidence = { bassChange: bass, percussionChange: drums, percussionRateChange: rate, complexityChange: complexity, timbreDistance: timbre };
    const events = [];
    if (Math.abs(bass) > 0.23 && stable('bassPresence', bass, 0.13)) events.push({ score: Math.max(1.01, Math.abs(right.bassMean - left.bassMean) / 0.2), reason: bass > 0 ? (left.metrics.bassPresence < 0.2 && right.metrics.bassPresence > 0.5 ? 'Bass enters' : 'Bass becomes stronger') : (left.metrics.bassPresence > 0.5 && right.metrics.bassPresence < 0.2 ? 'Bass drops out' : 'Bass recedes') });
    if (Math.abs(drums) > 0.24 && Math.abs(rate) > 0.85 && stable('drumPresence', drums, 0.12)) events.push({ score: Math.abs(drums) / 0.24, reason: drums > 0 ? (left.metrics.drumPresence < 0.2 && right.metrics.drumPresence > 0.5 ? 'Percussion enters' : 'Percussion becomes busier') : (left.metrics.drumPresence > 0.5 && right.metrics.drumPresence < 0.2 ? 'Percussion drops out' : 'Percussion thins out') });
    if (Math.abs(complexity) > 0.14 && timbre > 0.16 && stable('complexity', complexity, 0.085)) events.push({ score: Math.abs(complexity) / 0.14, reason: complexity > 0 ? 'Arrangement becomes busier' : 'Arrangement becomes sparser' });
    if (timbre > 0.3 && timbreDistance(left, first) > 0.24 && timbreDistance(left, second) > 0.24) events.push({ score: timbre / 0.3, reason: 'Sustained timbre change' });
    if (left.active < 0.1 && right.active > 0.8 && first.active > 0.7 && second.active > 0.7) events.push({ score: 2, reason: 'Music enters' });
    if (left.active > 0.8 && right.active < 0.1 && first.active < 0.2 && second.active < 0.2) events.push({ score: 2, reason: 'Music falls silent' });
    // Prefer musically interpretable layer events over a generic timbre label.
    const event = events.find(item => /Bass|Percussion/.test(item.reason)) || events.sort((a, b) => b.score - a.score)[0];
    // Signed window means locate the edge; quantiles establish persistence.
    return event ? { ...event, score: event.score * (0.65 + timbre * 0.35), evidence } : null;
  }
  function chooseShape(values) {
    const { metrics } = values;
    const tonal = metrics.drumPresence < 0.12 && metrics.onsetDensity < 0.08 && metrics.spectralDiversity < 0.24;
    if (values.active < 0.15 || tonal) return 0;
    // Arrangement density selects a silhouette; the scene interpolates its
    // vertices at section boundaries. No sequence or phase number is involved.
    if (metrics.complexity >= 0.65) return 2;
    if (metrics.complexity >= 0.45) return 1;
    if (metrics.complexity >= 0.28 && metrics.bassPresence > 0.45) return 4;
    return 3;
  }
  // Find a recurring spectral phrase (not a beat). Comparing complete phrases
  // prevents a repeating bass riff from repeatedly entering/exiting sections.
  let phraseSeconds = 0, bestCorrelation = 0;
  const bandMeans = Array.from({ length: 12 }, (_, band) => prefix[frames * columns + band] / frames);
  const correlations = [];
  for (let lag = 3; lag <= 18; lag += 0.125) {
    const offset = Math.round(lag * ANALYSIS_FPS);
    let cross = 0, squareA = 0, squareB = 0;
    for (let frame = offset; frame < frames; frame += 15) for (let band = 0; band < 12; band++) {
      const a = descriptors[frame * 12 + band] - bandMeans[band];
      const b = descriptors[(frame - offset) * 12 + band] - bandMeans[band];
      cross += a * b; squareA += a * a; squareB += b * b;
    }
    correlations.push({ lag, value: cross / Math.max(1e-8, Math.sqrt(squareA * squareB)) });
  }
  for (let i = 1; i < correlations.length - 1; i++) {
    const current = correlations[i];
    if (current.value > 0.58 && current.value > bestCorrelation && current.value >= correlations[i - 1].value && current.value >= correlations[i + 1].value) {
      phraseSeconds = current.lag; bestCorrelation = current.value;
    }
  }
  const contextSeconds = phraseSeconds ? Math.max(6, phraseSeconds * 2) : 9;
  const candidates = [];
  for (let time = 3; time < duration - 2.5; time += 0.125) {
    const left = descriptor(time - 3, time - 0.12), right = descriptor(time + 0.12, time + 3);
    const first = descriptor(time + 0.12, time + 1.5), second = descriptor(time + 1.5, time + 3);
    let change = compare(left, right, first, second);
    const broadLeft = descriptor(time - contextSeconds, time - 0.15), broadRight = descriptor(time + 0.15, time + contextSeconds);
    const broadTimbre = timbreDistance(broadLeft, broadRight);
    const broadBass = broadRight.metrics.bassPresence - broadLeft.metrics.bassPresence;
    const broadDrums = broadRight.metrics.drumPresence - broadLeft.metrics.drumPresence;
    const broadComplexity = broadRight.metrics.complexity - broadLeft.metrics.complexity;
    const broadLayers = layerDistance(broadLeft, broadRight), localLayers = layerDistance(left, right);
    // A second, phrase-length comparison rejects recurring bass-note/melody
    // motifs that fool short windows while preserving a real layer transition.
    if (change) {
      const supported = /Bass/.test(change.reason) ? Math.sign(change.evidence.bassChange) * broadBass > 0.18 && Math.abs(broadRight.bassMean - broadLeft.bassMean) > 0.12
        : /Percussion/.test(change.reason) ? Math.sign(change.evidence.percussionChange) * broadDrums > 0.15
        : /timbre/.test(change.reason) ? broadTimbre > 0.18
        : /busier|sparser/.test(change.reason) ? Math.sign(change.evidence.complexityChange) * broadComplexity > 0.07 : true;
      if (!supported) change = null;
    }
    if (!change && broadTimbre > 0.23 && timbreDistance(left, right) > 0.16 && timbreDistance(left, second) > 0.17) {
      change = { score: broadTimbre / 0.3 * (0.5 + timbreDistance(left, right) * 0.5), reason: broadComplexity > 0.07 ? 'Arrangement becomes busier' : broadComplexity < -0.07 ? 'Arrangement becomes sparser' : 'Sustained timbre change',
        evidence: { bassChange: broadBass, percussionChange: broadDrums, complexityChange: broadComplexity, timbreDistance: broadTimbre } };
    }
    if (!change && broadLayers > 0.045 && localLayers > 0.06
      && layerDistance(left, first) > 0.045 && layerDistance(left, second) > 0.045) {
      change = { score: (broadLayers + localLayers) / 0.105,
        reason: broadComplexity > 0.014 ? 'Spectral layers build' : broadComplexity < -0.014 ? 'Spectral layers thin out' : 'Sustained texture change',
        evidence: { bassChange: broadBass, percussionChange: broadDrums, complexityChange: broadComplexity, layerDistance: broadLayers, timbreDistance: broadTimbre } };
    }
    if (change && phraseSeconds) {
      const repeats = [-phraseSeconds, phraseSeconds, phraseSeconds * 2].some(offset => {
        const other = time + offset;
        if (other < 3 || other > duration - 3) return false;
        const otherLeft = descriptor(other - 3, other - 0.12), otherRight = descriptor(other + 0.12, other + 3);
        return timbreDistance(left, otherLeft) < 0.07 && timbreDistance(right, otherRight) < 0.07
          && layerDistance(left, otherLeft) < 0.035 && layerDistance(right, otherRight) < 0.035
          && Math.abs(left.metrics.onsetDensity - otherLeft.metrics.onsetDensity) < 0.12
          && Math.abs(right.metrics.onsetDensity - otherRight.metrics.onsetDensity) < 0.12;
      });
      if (repeats) change = null;
    }
    if (change) candidates.push({ time, ...change, values: right });
  }
  const peaks = candidates.filter(candidate => candidates.every(other => Math.abs(other.time - candidate.time) > 1.5 || other.score < candidate.score || (other.score === candidate.score && other.time >= candidate.time)));
  const chosen = [];
  for (const candidate of peaks.sort((a, b) => b.score - a.score)) {
    if (chosen.every(other => Math.abs(other.time - candidate.time) >= 4.5)) chosen.push(candidate);
  }
  const firstBoundary = chosen.length ? Math.min(...chosen.map(item => item.time)) : duration;
  const sampledComplexity = [];
  for (let time = 1; time < duration - 1; time += 1) sampledComplexity.push(descriptor(time, time + 4).metrics.complexity);
  const complexityLow = percentile(sampledComplexity, 0.1), complexityHigh = percentile(sampledComplexity, 0.9);
  const complexitySpread = complexityHigh - complexityLow;
  function calibrateMetrics(values) {
    // Rank arrangement density within this track. Preserve absolute density
    // when a stationary track has too little variation to support calibration.
    const calibration = 0.7 * smoothstep(clamp01((complexitySpread - 0.015) / 0.025));
    if (calibration > 0) {
      const relative = smoothstep(clamp01((values.metrics.complexity - complexityLow) / Math.max(0.065, complexitySpread)));
      values.metrics.complexity = clamp01(values.metrics.complexity * (1 - calibration) + relative * calibration);
      values.metrics.size = 0.7 + values.metrics.complexity * 0.6;
    }
    return values;
  }
  const initial = calibrateMetrics(descriptor(0.3, Math.min(duration, firstBoundary, 8)));
  const sections = [{ time: 0, shape: chooseShape(initial), reason: 'Opening arrangement', confidence: 1, novelty: 0, evidence: {}, metrics: initial.metrics }];
  for (const candidate of chosen.sort((a, b) => a.time - b.time)) {
    const values = calibrateMetrics(descriptor(candidate.time + 0.6, Math.min(duration, chosen.find(other => other.time > candidate.time)?.time ?? duration, candidate.time + 8)));
    if (candidate.reason === 'Bass drops out' && values.metrics.bassPresence >= 0.2) candidate.reason = 'Bass recedes';
    if (candidate.reason === 'Bass enters' && values.metrics.bassPresence < 0.5) candidate.reason = 'Bass becomes stronger';
    const previous = sections.at(-1);
    const changeInCharacter = Math.abs(values.metrics.complexity - previous.metrics.complexity) >= 0.12
      || Math.abs(values.metrics.bassPresence - previous.metrics.bassPresence) >= 0.18
      || Math.abs(values.metrics.drumPresence - previous.metrics.drumPresence) >= 0.15;
    // Retain a clearly different timbre even at equal busyness, but ordinary
    // descriptor jitter within the same arrangement should not relabel a phase.
    if (!changeInCharacter && (candidate.evidence.timbreDistance || 0) < 0.23
      && (candidate.evidence.layerDistance || 0) < 0.12 && !/silent|Music enters/.test(candidate.reason)) continue;
    sections.push({ time: candidate.time, shape: chooseShape(values), reason: candidate.reason,
      confidence: clamp01(0.5 + (candidate.score - 1) * 0.22), novelty: candidate.score,
      evidence: candidate.evidence, metrics: values.metrics });
  }
  return sections.map((section, index) => ({ ...section, index, name: SHAPE_NAMES[section.shape], end: sections[index + 1]?.time ?? duration }));
}

/** Scratch output is reused to avoid per-frame spectrum allocation. Copy arrays
 * if retaining a frame. Shape/features depend only on requested track time. */
export function createPhaseFrameReader(channels, timeline) {
  validate(channels, timeline.sampleRate);
  const fft = createFFT(FFT_SIZE);
  const power = new Float64Array(FFT_BINS);
  const spectrum = new Uint8Array(FFT_BINS);
  const waveform = new Float32Array(2048);
  const waveformLeft = new Float32Array(FFT_SIZE);
  const waveformRight = new Float32Array(FFT_SIZE);
  const scopeDelaySamples = Math.max(1, Math.round(timeline.sampleRate * 0.0013));
  const scopeSamples = Math.min(FFT_SIZE - scopeDelaySamples * 2, Math.round(timeline.sampleRate * 0.09));
  const triggerSearch = Math.max(1, Math.round(timeline.sampleRate * 0.02));
  let scopeStart = FFT_SIZE - scopeSamples, scopeChannel = 0;
  let lastFrame = -1;
  return function frameAt(time) {
    if (!Number.isFinite(time)) throw new Error('Analysis time must be finite');
    const boundedTime = Math.max(0, Math.min(timeline.duration, time));
    const frame = Math.max(0, Math.min(timeline.frames - 1, Math.floor(boundedTime * ANALYSIS_FPS + 1e-8)));
    if (frame !== lastFrame) {
      const endSample = Math.round(frame * timeline.sampleRate / ANALYSIS_FPS);
      power.fill(0);
      for (const channel of channels) {
        const magnitudes = fft.magnitudes(channel, endSample);
        for (let bin = 0; bin < FFT_BINS; bin++) power[bin] += magnitudes[bin] ** 2 / channels.length;
      }
      for (let bin = 0; bin < FFT_BINS; bin++) spectrum[bin] = Math.round(clamp01((10 * Math.log10(Math.max(1e-18, power[bin])) + 90) / 90) * 255);
      // Pick the strongest channel in this short window for signed waveform.
      // Never average signed L/R samples: anti-phase audio must not disappear.
      let selected = channels[0], strongest = -1;
      for (const channel of channels) {
        let square = 0;
        for (let i = Math.max(0, endSample - waveform.length); i < Math.min(endSample, channel.length); i++) square += channel[i] ** 2;
        if (square > strongest) { strongest = square; selected = channel; }
      }
      for (let i = 0; i < waveform.length; i++) waveform[i] = selected[endSample - waveform.length + i] || 0;
      // Raw PCM textures enable true stereo Lissajous and delay-coordinate
      // trajectories in the shader; interpolation adds columns, not geometry.
      const begin = Math.max(0, endSample - FFT_SIZE);
      const stop = Math.min(endSample, channels[0].length);
      const offset = Math.max(0, FFT_SIZE - endSample);
      waveformLeft.fill(0); waveformRight.fill(0);
      waveformLeft.set(channels[0].subarray(begin, stop), offset);
      waveformRight.set((channels[1] || channels[0]).subarray(begin, stop), offset);
      let leftPower = 0, rightPower = 0;
      const nominalStart = FFT_SIZE - scopeSamples;
      for (let i = nominalStart; i < FFT_SIZE; i++) {
        leftPower += waveformLeft[i] ** 2; rightPower += waveformRight[i] ** 2;
      }
      scopeChannel = rightPower > leftPower ? 1 : 0;
      const trigger = scopeChannel ? waveformRight : waveformLeft;
      scopeStart = nominalStart;
      for (let i = nominalStart; i >= Math.max(scopeDelaySamples, nominalStart - triggerSearch); i--) {
        if (trigger[i - 1] <= 0 && trigger[i] > 0) { scopeStart = i; break; }
      }
      lastFrame = frame;
    }
    const base = frame * FEATURE_STRIDE;
    const features = { bass: timeline.data[base], mids: timeline.data[base + 1], highs: timeline.data[base + 2], energy: timeline.data[base + 3], kick: timeline.data[base + 4], rms: timeline.data[base + 5] };
    let low = 0, high = timeline.sections.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (timeline.sections[mid].time <= boundedTime) low = mid; else high = mid - 1; }
    const section = timeline.sections[low];
    const shapeFrom = low ? timeline.sections[low - 1].shape : section.shape;
    const morph = low ? smoothstep(clamp01((boundedTime - section.time) / MORPH_SECONDS)) : 1;
    const previousMetrics = timeline.sections[Math.max(0, low - 1)].metrics;
    const phase = { reason: section.reason, confidence: section.confidence };
    for (const key of Object.keys(section.metrics)) phase[key] = previousMetrics[key] + (section.metrics[key] - previousMetrics[key]) * morph;
    return { time: boundedTime, frame, features, phase, spectrum, waveform, waveformLeft, waveformRight,
      scopeStart, scopeSamples, scopeDelaySamples, scopeChannel, scopeGain: timeline.scopeGain || 1,
      shapeFrom, shapeTo: section.shape, morph, phaseName: section.name, section: low };
  };
}

import { createFFT } from '../starfield/starfield-analysis-core.js';

export { FFT_SIZE, FFT_BINS } from '../starfield/starfield-analysis-core.js';
import { FFT_SIZE, FFT_BINS } from '../starfield/starfield-analysis-core.js';
export const ANALYSIS_FPS = 60;
export const FEATURE_STRIDE = 6;
export const SHAPE_NAMES = ['Phase portrait', 'Split field', 'Folded wings', 'Vertical rails', 'Hourglass'];
export const MORPH_SECONDS = 2.4;
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
    timeline.sections = detectSections(timeline, descriptors);
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
      }
    }
    if (cursor >= frames) finish();
    return cursor / frames;
  }
  return { step, timeline, get done() { return finished; } };
}

/** Offline structural novelty is measured across two 1.5-second musical
 * windows. Local maxima, six-second dwell, and a novelty threshold suppress
 * ordinary beats. There is deliberately no periodic shape-change timer. */
function detectSections(timeline, descriptors) {
  const { data, frames, duration } = timeline;
  const columns = DESCRIPTOR_BANDS + 3;
  const prefix = new Float64Array((frames + 1) * columns);
  for (let frame = 0; frame < frames; frame++) {
    const previous = frame * columns, next = previous + columns;
    for (let band = 0; band < DESCRIPTOR_BANDS; band++) prefix[next + band] = prefix[previous + band] + descriptors[frame * DESCRIPTOR_BANDS + band];
    prefix[next + 12] = prefix[previous + 12] + data[frame * FEATURE_STRIDE + 3];
    prefix[next + 13] = prefix[previous + 13] + data[frame * FEATURE_STRIDE + 5];
    prefix[next + 14] = prefix[previous + 14] + data[frame * FEATURE_STRIDE + 4];
  }
  function descriptor(from, to) {
    const start = Math.max(0, Math.min(frames, Math.round(from * ANALYSIS_FPS)));
    const end = Math.max(start + 1, Math.min(frames, Math.round(to * ANALYSIS_FPS)));
    return Array.from({ length: columns }, (_, column) => (prefix[end * columns + column] - prefix[start * columns + column]) / (end - start));
  }
  function chooseShape(values) {
    const strongest = values.slice(0, 12).indexOf(Math.max(...values.slice(0, 12)));
    if (values[12] < 0.16) return 0;
    if (values[14] > 0.13) return 3;
    if (strongest < 4) return 2;
    if (strongest < 8) return 1;
    if (strongest < 10) return 4;
    return 0;
  }
  const initial = { time: 0, shape: chooseShape(descriptor(0, Math.min(4, duration))), novelty: 0 };
  const sections = [initial];
  const candidates = [];
  for (let time = 3; time < duration - 2; time += 0.25) {
    const left = descriptor(time - 1.5, time), right = descriptor(time, time + 1.5);
    const timbre = left.slice(0, 12).reduce((sum, value, band) => sum + Math.abs(value - right[band]), 0) * 0.5;
    const loudness = Math.min(1, Math.abs(Math.log((left[13] + 0.003) / (right[13] + 0.003))) * 0.4);
    const novelty = timbre * 0.8 + loudness * 0.45 + Math.abs(left[12] - right[12]) * 0.25;
    candidates.push({ time, novelty, values: right });
  }
  const peaks = candidates.filter((candidate, index) => candidate.novelty >= 0.19 && candidates.slice(Math.max(0, index - 5), index + 6)
    .every((other, offset) => other.novelty < candidate.novelty || (other.novelty === candidate.novelty && Math.max(0, index - 5) + offset >= index)));
  // Pick strongest nearby boundaries first, then restore chronological order.
  const chosen = [];
  for (const candidate of peaks.sort((a, b) => b.novelty - a.novelty)) {
    if (candidate.time >= 6 && chosen.every(other => Math.abs(other.time - candidate.time) >= 6)) chosen.push(candidate);
  }
  for (const candidate of chosen.sort((a, b) => a.time - b.time)) {
    let shape = chooseShape(candidate.values);
    const previous = sections.at(-1).shape;
    if (shape === previous) shape = (previous + (candidate.novelty > 0.45 ? 2 : 1)) % SHAPE_NAMES.length;
    sections.push({ time: candidate.time, shape, novelty: candidate.novelty });
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
    return { time: boundedTime, frame, features, spectrum, waveform, waveformLeft, waveformRight,
      scopeStart, scopeSamples, scopeDelaySamples, scopeChannel, scopeGain: timeline.scopeGain || 1,
      shapeFrom, shapeTo: section.shape, morph, phaseName: section.name, section: low };
  };
}

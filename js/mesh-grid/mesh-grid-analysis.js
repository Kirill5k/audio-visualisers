/**
 * Deterministic decoded-audio adapter for the vizz.fm Mesh Grid renderer.
 * Spectrum transforms and control modulation are adapted from the public
 * vizz.fm application bundle (i1 / iJ / ix and the control-modulation Proxy),
 * retrieved 2026-09-20. FFT scratch layout follows this repository's
 * starfield-analysis-core.js, with Web Audio's 1/N normalization and Blackman
 * window instead of amplitude/coherent-gain correction.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const numeric = (value, fallback) => Number.isFinite(value) ? value : fallback;
const DEFAULTS = {
  fftSize: 2048, smoothingTimeConstant: .75, minDecibels: -120, maxDecibels: -30,
  volume: 1, gain: 1, globalIntensity: 1, noiseGate: 0, peakDecay: 0,
  bassAttenuation: 0, spectrumCap: 1, spectrumCompress: 0, frequencyScale: 'linear',
};

/** AnalyserNode-compatible magnitude smoothing, dB conversion and byte scale. */
function createPcmAnalyser(channels, size) {
  if (!Number.isInteger(size) || size < 32 || size > 32768 || (size & (size - 1))) {
    throw new RangeError('FFT size must be a power of two between 32 and 32768.');
  }
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  const reversed = new Uint32Array(size), window = new Float64Array(size);
  const cosine = new Float64Array(size / 2), sine = new Float64Array(size / 2);
  const smoothed = new Float64Array(size / 2), bytes = new Uint8Array(size / 2);
  const magnitudes = new Float64Array(size / 2), priorSmoothed = new Float64Array(size / 2);
  let lastEndSample = null;
  for (let i = 0; i < size; i++) {
    const phase = 2 * Math.PI * i / size;
    window[i] = .42 - .5 * Math.cos(phase) + .08 * Math.cos(phase * 2);
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >>> 1;
    for (; j & bit; bit >>>= 1) j ^= bit;
    j ^= bit;
    reversed[i] = j;
  }
  for (let i = 0; i < size / 2; i++) {
    cosine[i] = Math.cos(-2 * Math.PI * i / size);
    sine[i] = Math.sin(-2 * Math.PI * i / size);
  }
  return {
    size,
    reset() { smoothed.fill(0); priorSmoothed.fill(0); bytes.fill(0); lastEndSample = null; },
    spectrum(endSample, volume, smoothing, minDb, maxDb) {
      const sample = Math.floor(endSample);
      if (sample !== lastEndSample) {
        // Re-edits of a paused sample reuse its PCM transform and the smoothing
        // state from before that frame, including when volume or dB bounds change.
        priorSmoothed.set(smoothed);
        lastEndSample = sample;
        const offset = sample - size;
        imaginary.fill(0);
        for (let i = 0; i < size; i++) {
          const index = offset + i;
          let value = 0;
          if (index >= 0) for (const channel of channels) value += channel[index] || 0;
          real[reversed[i]] = value / channels.length * window[i];
        }
        for (let length = 2; length <= size; length <<= 1) {
          const half = length >>> 1, step = size / length;
          for (let start = 0; start < size; start += length) {
            for (let j = 0; j < half; j++) {
              const even = start + j, odd = even + half, table = j * step;
              const tr = real[odd] * cosine[table] - imaginary[odd] * sine[table];
              const ti = real[odd] * sine[table] + imaginary[odd] * cosine[table];
              real[odd] = real[even] - tr;
              imaginary[odd] = imaginary[even] - ti;
              real[even] += tr;
              imaginary[even] += ti;
            }
          }
        }
        for (let i = 0; i < bytes.length; i++) magnitudes[i] = Math.hypot(real[i], imaginary[i]) / size;
      }
      for (let i = 0; i < bytes.length; i++) {
        smoothed[i] = smoothing * priorSmoothed[i] + (1 - smoothing) * magnitudes[i] * volume;
        const db = 20 * Math.log10(smoothed[i]);
        bytes[i] = Math.floor(clamp(255 * (db - minDb) / (maxDb - minDb), 0, 255));
      }
      return bytes;
    },
  };
}

function stretchLinear(input, output, count) {
  const range = Math.max(1, Math.min(count, input.length));
  if (range >= output.length) { output.set(input); return; }
  for (let i = 0; i < output.length; i++) {
    const position = i / output.length * range, first = Math.floor(position), mix = position - first;
    output[i] = Math.round((input[first] || 0) * (1 - mix) + (input[Math.min(first + 1, range - 1)] || 0) * mix);
  }
}

function stretchFrequency(input, output, count, scale, sampleRate) {
  const range = Math.max(2, Math.min(count, input.length));
  const hzPerBin = sampleRate / 2 / input.length;
  const firstBin = Math.max(1, 20 / hzPerBin), lastBin = range - 1;
  if (lastBin <= firstBin) { stretchLinear(input, output, count); return; }
  const mel = hz => 2595 * Math.log10(1 + hz / 700);
  const start = scale === 'log' ? Math.log(firstBin) : mel(firstBin * hzPerBin);
  const end = scale === 'log' ? Math.log(lastBin) : mel(lastBin * hzPerBin);
  const inverse = scale === 'log' ? Math.exp : value => 700 * (10 ** (value / 2595) - 1) / hzPerBin;
  let left = inverse(start);
  for (let i = 0; i < output.length; i++) {
    const right = i + 1 < output.length ? inverse(start + (end - start) * (i + 1) / output.length) : lastBin;
    const low = Math.floor(left), high = Math.floor(right);
    if (high > low) {
      let maximum = 0;
      for (let bin = low; bin <= high && bin <= lastBin; bin++) maximum = Math.max(maximum, input[bin]);
      output[i] = maximum;
    } else {
      const mix = left - low;
      output[i] = Math.round((input[low] || 0) * (1 - mix) + (input[Math.min(low + 1, lastBin)] || 0) * mix);
    }
    left = right;
  }
}

/** Source order: gain, gate, peak decay, bass attenuation, cap/compress, scale. */
export function createMeshGridSpectrumTransform() {
  let working = new Uint8Array(0), output = new Uint8Array(0), peaks = null;
  return {
    reset() { peaks = null; working.fill(0); output.fill(0); },
    process(input, settings = {}, delta = 1 / 60, sampleRate = 48000) {
      if (working.length !== input.length) {
        working = new Uint8Array(input.length); output = new Uint8Array(input.length); peaks = null;
      }
      working.set(input);
      const gain = numeric(settings.gain, 1) * numeric(settings.globalIntensity, 1);
      const gate = clamp(numeric(settings.noiseGate, 0), 0, 1) * 255;
      for (let i = 0; i < working.length; i++) {
        working[i] = Math.min(255, Math.round(working[i] * gain));
        if (working[i] < gate) working[i] = 0;
      }
      const decay = clamp(numeric(settings.peakDecay, 0), 0, 1);
      if (decay > 0) {
        peaks ||= new Float32Array(working.length);
        const falloff = (.5 + .49 * decay) ** (120 * delta);
        for (let i = 0; i < working.length; i++) {
          if (working[i] >= peaks[i]) peaks[i] = working[i];
          else { peaks[i] *= falloff; working[i] = Math.round(Math.max(working[i], peaks[i])); }
        }
      } else peaks = null;
      const attenuation = clamp(numeric(settings.bassAttenuation, 0), 0, 1);
      if (attenuation > 0) for (let i = 0; i < working.length; i++) {
        working[i] = Math.round(working[i] * (1 - attenuation * (1 - i / working.length)));
      }
      const cappedRange = Math.max(1, Math.floor(working.length * clamp(numeric(settings.spectrumCap, 1), .05, 1)));
      const compress = clamp(numeric(settings.spectrumCompress, 0), 0, 1);
      let activeMaxBin = cappedRange;
      if (compress > 0) {
        for (let i = cappedRange - 1; i >= 0; i--) if (working[i] > 5) { activeMaxBin = i + 1; break; }
        activeMaxBin = Math.max(activeMaxBin, Math.floor(.1 * cappedRange));
      }
      const effectiveRange = Math.floor(cappedRange * (1 - compress) + activeMaxBin * compress);
      const scale = settings.frequencyScale || 'linear';
      if (scale === 'log' || scale === 'mel') stretchFrequency(working, output, effectiveRange, scale, sampleRate);
      else stretchLinear(working, output, effectiveRange);
      return { spectrum: output, effectiveRange, cappedRange, activeMaxBin };
    },
  };
}

function bandFeature(data, previous, modulation, rangeRatio = 1) {
  const start = clamp(numeric(modulation.freqStart, 0) * rangeRatio, 0, 1);
  const end = clamp(numeric(modulation.freqEnd, 1) * rangeRatio, start, 1);
  const first = Math.floor(start * data.length), last = Math.max(first + 1, Math.floor(end * data.length));
  const count = last - first;
  let sum = 0, weighted = 0;
  for (let i = first; i < last && i < data.length; i++) {
    const value = data[i];
    if (modulation.source === 'activeBands') sum += value > 8 ? 1 : 0;
    else if (modulation.source === 'centroid') { sum += value; weighted += i * value; }
    else if (modulation.source === 'flux') sum += Math.max(0, value - previous[i]);
    else sum += value;
  }
  if (modulation.source === 'activeBands') return sum / count;
  if (modulation.source === 'centroid') return sum < 8 ? 0 : clamp((weighted / sum - first) / Math.max(1, last - 1 - first), 0, 1);
  if (modulation.source === 'flux') return Math.min(1, sum / count / 255 * (modulation.fluxTiming === 'smoothed' ? 12 : 4));
  return sum / count / 255;
}

function ease(value, mode) {
  if (mode === 'linear') return value;
  if (mode === 'cubic') return value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
  if (mode === 'smootherstep') return 6 * value ** 5 - 15 * value ** 4 + 10 * value ** 3;
  return .5 - .5 * Math.cos(value * Math.PI);
}

/** Advance shared spectra once, before evaluating any number of controls. */
export function createMeshGridAudioModulator() {
  let previousDisplay = new Uint8Array(0), previousOnset = new Uint8Array(0), previousTime = null;
  let framePreviousDisplay = new Uint8Array(0), framePreviousOnset = new Uint8Array(0), framePreviousTime = null;
  let frameEnvelopes = new Map();
  let cachedResult = null, cachedSettings = null;
  const envelopes = new Map(), rampStarts = new Map();
  return {
    reset() {
      previousDisplay = new Uint8Array(0); previousOnset = new Uint8Array(0); previousTime = null;
      framePreviousDisplay = new Uint8Array(0); framePreviousOnset = new Uint8Array(0); framePreviousTime = null;
      frameEnvelopes.clear();
      cachedResult = null; cachedSettings = null; envelopes.clear(); rampStarts.clear();
    },
    process(settings, spectrum, onsetSpectrum, time, effectiveRange = spectrum.length) {
      if (time === previousTime && settings === cachedSettings && cachedResult) return cachedResult;
      if (time !== previousTime) {
        // Keep the pre-frame inputs so edits at this same paused time can
        // recalculate modulation without consuming the frame's onset twice.
        [framePreviousDisplay, previousDisplay] = [previousDisplay, framePreviousDisplay];
        [framePreviousOnset, previousOnset] = [previousOnset, framePreviousOnset];
        framePreviousTime = previousTime;
        frameEnvelopes = new Map(envelopes);
      }
      const gap = framePreviousTime === null ? Infinity : time - framePreviousTime;
      const displayValid = gap >= 0 && gap < .5 && framePreviousDisplay.length === spectrum.length;
      const onsetValid = gap >= 0 && gap < .5 && framePreviousOnset.length === onsetSpectrum.length;
      const result = { ...settings };
      for (const [key, modulation] of Object.entries(settings.controlModulations || {})) {
        const base = settings[key];
        if (!modulation?.enabled || typeof base !== 'number' || ['gridSizeX', 'gridSizeY'].includes(key)) continue;
        const min = numeric(modulation.min, 0), max = numeric(modulation.max, 1);
        if (modulation.mode === 'midi') continue;
        if (modulation.mode === 'oscillate') {
          const phase = time / Math.max(.0001, numeric(modulation.speed, 2)) % 1;
          result[key] = min + (max - min) * ease(phase < .5 ? phase * 2 : 2 - phase * 2, modulation.easing);
          continue;
        }
        if (modulation.mode === 'ramp-up' || modulation.mode === 'ramp-down') {
          if (!rampStarts.has(key)) rampStarts.set(key, time);
          const fraction = ease(clamp((time - rampStarts.get(key)) / Math.max(.0001, numeric(modulation.speed, 2)), 0, 1), modulation.easing);
          result[key] = modulation.mode === 'ramp-up' ? min + (max - min) * fraction : max - (max - min) * fraction;
          continue;
        }
        let feature;
        if (modulation.source === 'flux') {
          const useOnset = (modulation.fluxTiming ?? 'onset') === 'onset' && onsetSpectrum.length > 0;
          const valid = useOnset ? onsetValid : displayValid;
          // A missing onset analyser falls back to the source's display-flux gain.
          const sourceConfig = { ...modulation, fluxTiming: useOnset ? 'onset' : 'smoothed' };
          feature = valid ? bandFeature(useOnset ? onsetSpectrum : spectrum, useOnset ? framePreviousOnset : framePreviousDisplay,
            sourceConfig, useOnset ? Math.min(1, effectiveRange / spectrum.length) : 1) : 0;
        } else feature = bandFeature(spectrum, framePreviousDisplay, modulation);
        const prior = frameEnvelopes.get(key);
        let value = feature;
        if (prior && gap >= 0 && gap <= .5) {
          const milliseconds = feature > prior.value ? numeric(modulation.attackMs, 0) : numeric(modulation.releaseMs, 0);
          const alpha = milliseconds > 0 ? 1 - Math.exp(-gap / (milliseconds / 1000)) : 1;
          value = prior.value + alpha * (feature - prior.value);
        }
        envelopes.set(key, { value });
        value **= numeric(modulation.contrast, 1);
        const movement = value * numeric(modulation.amount, 1) * (max - min);
        const anchor = modulation.anchor ?? (modulation.invert ? 'range' : 'slider');
        result[key] = clamp(modulation.invert
          ? (anchor === 'range' ? max : base) - movement
          : (anchor === 'range' ? min : base) + movement, min, max);
      }
      if (previousDisplay.length !== spectrum.length) previousDisplay = new Uint8Array(spectrum.length);
      if (previousOnset.length !== onsetSpectrum.length) previousOnset = new Uint8Array(onsetSpectrum.length);
      previousDisplay.set(spectrum); previousOnset.set(onsetSpectrum); previousTime = time;
      cachedSettings = settings; cachedResult = result;
      return result;
    },
  };
}

/**
 * Consume successive 60 Hz positions for preview or export. Stateful smoothing,
 * peaks and audio envelopes are deliberately owned by this instance; call reset
 * and replay the same positions for an exact reconstruction after seeking.
 * Spectrum arrays are reused and remain valid until the next frameAt call.
 */
export function createMeshGridAnalysis(audioBuffer, initialSettings = {}, { browserBias = 10 } = {}) {
  if (!audioBuffer || !(audioBuffer.sampleRate > 0) || !(audioBuffer.numberOfChannels > 0)) {
    throw new TypeError('A decoded AudioBuffer is required.');
  }
  const sampleRate = audioBuffer.sampleRate;
  let channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
  let settings = { ...DEFAULTS, ...initialSettings }, disposed = false;
  let analyser = createPcmAnalyser(channels, settings.fftSize);
  let onsetAnalyser = createPcmAnalyser(channels, 2048);
  const transform = createMeshGridSpectrumTransform(), modulator = createMeshGridAudioModulator();
  let cachedTime = null, cachedFrame = null;
  const assertActive = () => { if (disposed) throw new Error('Audio analysis has been disposed.'); };
  const reset = () => {
    analyser.reset(); onsetAnalyser.reset(); transform.reset(); modulator.reset(); cachedTime = null; cachedFrame = null;
  };
  return {
    frameAt(timeSeconds, dt = 1 / 60) {
      assertActive();
      if (!Number.isFinite(timeSeconds) || !Number.isFinite(dt) || dt < 0) throw new RangeError('Frame time and delta must be finite, with a nonnegative delta.');
      const time = clamp(timeSeconds, 0, audioBuffer.duration ?? audioBuffer.length / sampleRate);
      if (time === cachedTime && cachedFrame) return cachedFrame;
      if (cachedTime !== null && time < cachedTime) reset();
      const endSample = Math.round(time * sampleRate);
      const volume = Math.max(0, numeric(settings.volume, 1));
      const maxDb = numeric(settings.maxDecibels, -30) + browserBias;
      const minDb = Math.min(numeric(settings.minDecibels, -120) + browserBias, maxDb - 1);
      const raw = analyser.spectrum(endSample, volume, clamp(numeric(settings.smoothingTimeConstant, .75), 0, 1), minDb, maxDb);
      const onsetSpectrum = onsetAnalyser.spectrum(endSample, volume, 0, -100 + browserBias, -30 + browserBias);
      const transformed = transform.process(raw, settings, time === cachedTime ? 0 : Math.min(dt, .1), sampleRate);
      const modulated = modulator.process(settings, transformed.spectrum, onsetSpectrum, time, transformed.effectiveRange);
      cachedTime = time;
      cachedFrame = { ...transformed, time, settings: modulated, onsetSpectrum };
      return cachedFrame;
    },
    setSettings(nextSettings) {
      assertActive();
      const next = { ...DEFAULTS, ...nextSettings };
      if (next.fftSize !== settings.fftSize) {
        analyser = createPcmAnalyser(channels, next.fftSize);
        onsetAnalyser.reset(); transform.reset(); modulator.reset();
      }
      settings = next; cachedFrame = null;
    },
    reset() { assertActive(); reset(); },
    dispose() {
      if (disposed) return;
      reset(); channels = []; analyser = null; onsetAnalyser = null; disposed = true;
    },
  };
}

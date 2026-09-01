/**
 * Pure audio analysis helpers for monitor-suite visualisers.
 */

export function binOf(frequency, sampleRate, fftSize) {
  const bins = fftSize / 2;
  const nyquist = sampleRate / 2;
  const bin = Math.round((frequency / nyquist) * bins);
  return Math.max(0, Math.min(bins - 1, bin));
}

export function bandEnergy(frequencyData, minHz, maxHz, sampleRate, fftSize, gain = 1) {
  const low = binOf(minHz, sampleRate, fftSize);
  const high = Math.max(low, binOf(maxHz, sampleRate, fftSize));
  let sum = 0;
  for (let bin = low; bin <= high; bin++) sum += frequencyData[bin];
  const level = sum / (high - low + 1) / 255;
  return Math.pow(level, 1.12) * gain;
}

export function computeWaveformPeaks(buffer, sampleCount = 2048) {
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  const peaks = new Float32Array(sampleCount);
  const block = length / sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor(i * block);
    const end = Math.min(length, Math.floor((i + 1) * block));
    let peak = 0;
    for (let s = start; s < end; s++) peak = Math.max(peak, Math.abs(channel[s]));
    peaks[i] = peak;
  }

  let max = 0;
  for (let i = 0; i < sampleCount; i++) max = Math.max(max, peaks[i]);
  if (max > 0) {
    for (let i = 0; i < sampleCount; i++) peaks[i] /= max;
  }
  return peaks;
}

export function detectOnsets(peaks, threshold = 0.42, minGap = 8) {
  const onsets = [];
  let last = -minGap;
  for (let i = 1; i < peaks.length - 1; i++) {
    const rise = peaks[i] - peaks[i - 1];
    if (peaks[i] > threshold && rise > 0.08 && i - last >= minGap) {
      onsets.push(i / peaks.length);
      last = i;
    }
  }
  return onsets;
}

export function stereoLevels(timeDomainData) {
  const len = timeDomainData.length;
  const delay = Math.max(4, Math.floor(len * 0.02));
  let lPeak = 0;
  let rPeak = 0;
  let lSum = 0;
  let rSum = 0;

  for (let i = 0; i < len; i++) {
    const l = (timeDomainData[i] - 128) / 128;
    const r = (timeDomainData[(i + delay) % len] - 128) / 128;
    lPeak = Math.max(lPeak, Math.abs(l));
    rPeak = Math.max(rPeak, Math.abs(r));
    lSum += l * l;
    rSum += r * r;
  }

  return {
    lPeak,
    rPeak,
    lRms: Math.sqrt(lSum / len),
    rRms: Math.sqrt(rSum / len),
  };
}

export function stereoCorrelation(timeDomainData) {
  const len = timeDomainData.length;
  const delay = Math.max(4, Math.floor(len * 0.02));
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;

  for (let i = 0; i < len; i++) {
    const l = (timeDomainData[i] - 128) / 128;
    const r = (timeDomainData[(i + delay) % len] - 128) / 128;
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }

  const denom = Math.sqrt(sumL2 * sumR2);
  if (denom <= 1e-8) return 0;
  return Math.max(-1, Math.min(1, sumLR / denom));
}

export function fillTimeDomainFromBuffer(buffer, positionSeconds, timeDomainData) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const len = timeDomainData.length;
  const start = Math.max(0, Math.floor(positionSeconds * buffer.sampleRate));
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    const l = idx < left.length ? left[idx] : 0;
    const r = idx < right.length ? right[idx] : l;
    const mono = (l + r) * 0.5;
    timeDomainData[i] = Math.max(0, Math.min(255, Math.round(mono * 127 + 128)));
  }
}

export function rmsFromTimeDomain(timeDomainData) {
  let sum = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const sample = (timeDomainData[i] - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / timeDomainData.length);
}

export function estimateOnset(energy, prevEnergy, threshold = 0.18) {
  return energy - prevEnergy > threshold && energy > 0.12;
}

export function logBarIndices(barCount, sampleRate, fftSize) {
  const bins = fftSize / 2;
  const minHz = 30;
  const maxHz = sampleRate / 2;
  const indices = new Uint16Array(barCount);
  const minLog = Math.log10(minHz);
  const maxLog = Math.log10(maxHz);

  for (let bar = 0; bar < barCount; bar++) {
    const t0 = bar / barCount;
    const t1 = (bar + 1) / barCount;
    const hz0 = 10 ** (minLog + (maxLog - minLog) * t0);
    const hz1 = 10 ** (minLog + (maxLog - minLog) * t1);
    const low = binOf(hz0, sampleRate, fftSize);
    const high = Math.max(low, binOf(hz1, sampleRate, fftSize));
    indices[bar] = (low + high) >> 1;
  }
  return indices;
}

export function barValues(frequencyData, barIndices) {
  const values = new Float32Array(barIndices.length);
  for (let i = 0; i < barIndices.length; i++) {
    const bin = barIndices[i];
    const left = Math.max(0, bin - 1);
    const right = Math.min(frequencyData.length - 1, bin + 1);
    let sum = 0;
    for (let b = left; b <= right; b++) sum += frequencyData[b];
    values[i] = (sum / (right - left + 1)) / 255;
  }
  return values;
}

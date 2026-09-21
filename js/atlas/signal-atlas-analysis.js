import { ANALYSIS_FPS, FFT_SIZE, FFT_BINS, RTA_FFT_SIZE, RTA_BINS, MOTION_FFT_SIZE, LEVEL_STRIDE, createSignalFrame, fillSignalFrame, signalFrameIndex } from './signal-atlas-analysis-core.js';

export { createSignalFrame };
const MAX_RANGE_FRAMES = 1450;
const emptyLevels = () => ({ lRms: 0, rRms: 0, lPeak: 0, rPeak: 0, correlation: 0,
  lSamplePeak: 0, rSamplePeak: 0, lDisplayPeak: 0, rDisplayPeak: 0 });
const abortError = () => new DOMException('Audio analysis was replaced or reset', 'AbortError');

/** A single FIFO owns complete frame payloads so history and stereo curves
 * always evict together. Reads do not change retention or request order. */
class SignalFrameCache {
  constructor(capacity) { this.capacity = capacity; this.entries = new Map(); }
  get size() { return this.entries.size; }
  get bytes() {
    let bytes = 0;
    for (const frame of this.entries.values()) {
      bytes += frame.spectrum.byteLength + frame.rtaLeft.byteLength + frame.rtaRight.byteLength;
    }
    return bytes;
  }
  get(frame) { return this.entries.get(frame); }
  set(frame, data) {
    this.entries.set(frame, data);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value);
  }
  clear() { this.entries.clear(); }
}

/** Worker-owned full-resolution FFTs plus a bounded main-thread cache.
 * Histories are requested by absolute 60 Hz frame number, so playback, seeking
 * and offline export receive identical data regardless of request order. */
export function createSignalAnalysis({ cacheFrames = 1500, prefetchFrames = 30, motionAnalysis = true } = {}) {
  const cache = new SignalFrameCache(Math.max(1, Math.min(1500, Math.floor(cacheFrames))));
  let worker = null, generation = 0, epoch = 0, requestId = 0;
  let audioBuffer = null, channels = null, summary = null, loadRequest = null, disposed = false;
  let workerRtaCacheBytes = 0;
  const pendingFrames = new Map();
  const batches = new Map();

  function rejectPending(error) {
    for (const request of pendingFrames.values()) request.reject(error);
    pendingFrames.clear();
    batches.clear();
    if (loadRequest) { loadRequest.reject(error); loadRequest = null; }
  }

  function failWorker(error) {
    rejectPending(error);
    worker?.terminate();
    worker = null;
    summary = null;
    audioBuffer = null;
    channels = null;
    workerRtaCacheBytes = 0;
    cache.clear();
    generation++;
    epoch++;
  }

  function startWorker() {
    worker = new Worker(new URL('./signal-atlas-analysis-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: message }) => {
      if (message.generation !== generation || disposed) return;
      if (Number.isFinite(message.workerRtaCacheBytes)) workerRtaCacheBytes = message.workerRtaCacheBytes;
      if (message.type === 'progress') {
        if (loadRequest?.id === message.id) loadRequest.onProgress?.(message.progress);
      } else if (message.type === 'loaded') {
        if (loadRequest?.id !== message.id) return;
        summary = message.summary;
        const request = loadRequest;
        loadRequest = null;
        request.resolve(getInfo());
      } else if (message.type === 'frames') {
        const batch = batches.get(message.id);
        if (!batch) return;
        for (const item of message.frames) {
          const request = pendingFrames.get(item.frame);
          if (!request || request.id !== message.id) continue;
          pendingFrames.delete(item.frame);
          batch.delete(item.frame);
          const frame = packFrame(item);
          cache.set(item.frame, frame);
          request.resolve(frame);
        }
        if (!batch.size) batches.delete(message.id);
      } else if (message.type === 'error') {
        const error = new Error(message.error);
        if (loadRequest?.id === message.id) { failWorker(error); return; }
        for (const frame of batches.get(message.id) || []) {
          const request = pendingFrames.get(frame);
          request?.reject(error);
          pendingFrames.delete(frame);
        }
        batches.delete(message.id);
      }
    };
    worker.onerror = event => failWorker(new Error(event.message || 'Audio analysis worker failed'));
    worker.onmessageerror = () => failWorker(new Error('Audio analysis worker returned unreadable data'));
  }

  function normalizedFrame(frame) {
    if (!Number.isFinite(frame)) throw new Error('Analysis frame must be finite');
    return Math.floor(frame);
  }

  function packFrame({ frame, spectrum, rtaLeft, rtaRight, motionFlux }) {
    return { frame, time: frame / ANALYSIS_FPS, spectrum, rtaLeft, rtaRight, motionFlux };
  }

  async function load(input, { onProgress } = {}) {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (!input?.numberOfChannels || !(input.sampleRate > 0) || !Number.isInteger(input.length) || input.length < 1) {
      throw new Error('A decoded audio buffer is required');
    }
    generation++;
    epoch++;
    rejectPending(abortError());
    worker?.terminate();
    worker = null;
    summary = null;
    workerRtaCacheBytes = 0;
    cache.clear();
    audioBuffer = input;
    channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
    // Transfer copies, retaining the original AudioBuffer for playback and the
    // raw stereo microscope. No downmix can cancel opposing channel phases.
    const copies = channels.map(channel => channel.slice());
    startWorker();
    const id = ++requestId;
    const promise = new Promise((resolve, reject) => { loadRequest = { id, resolve, reject, onProgress }; });
    onProgress?.(0);
    try {
      worker.postMessage({ type: 'load', id, generation, epoch, channels: copies, sampleRate: input.sampleRate, motionAnalysis }, copies.map(channel => channel.buffer));
    } catch (error) { failWorker(error); }
    return promise;
  }

  function getRange(startFrame, endFrame, { onProgress } = {}) {
    if (!summary || disposed) return Promise.reject(new Error('Load audio before requesting analysis frames'));
    const start = normalizedFrame(startFrame), end = normalizedFrame(endFrame);
    if (end < start) throw new Error('The last analysis frame must follow the first');
    if (end - start + 1 > MAX_RANGE_FRAMES) throw new Error('Request at most 1450 analysis frames at a time');
    const requestEpoch = epoch;
    const id = ++requestId;
    const missing = [];
    const promises = [];
    let completed = 0;
    const count = end - start + 1;
    for (let frame = start; frame <= end; frame++) {
      const cached = cache.get(frame);
      let promise;
      if (cached) promise = Promise.resolve(cached);
      else if (pendingFrames.has(frame)) promise = pendingFrames.get(frame).promise;
      else {
        const request = { id };
        request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
        pendingFrames.set(frame, request);
        missing.push(frame);
        promise = request.promise;
      }
      promises.push(promise.then(result => {
        if (epoch !== requestEpoch || disposed) throw abortError();
        onProgress?.(++completed / count);
        return result;
      }));
    }
    if (missing.length) {
      batches.set(id, new Set(missing));
      try { worker.postMessage({ type: 'frames', id, generation, epoch, frames: missing }); }
      catch (error) { failWorker(error); }
    }
    return Promise.all(promises);
  }

  async function getFrame(frame) { return (await getRange(frame, frame))[0]; }

  function getCachedFrame(frameIndex) {
    if (!summary || disposed) return null;
    const frame = normalizedFrame(frameIndex);
    return cache.get(frame) || null;
  }

  function prefetch(frameIndex) {
    if (!summary || disposed) return Promise.resolve();
    const frame = normalizedFrame(frameIndex);
    const end = Math.min(summary.frames - 1, frame + Math.min(prefetchFrames, cache.capacity - 1));
    if (end <= frame) return Promise.resolve();
    return getRange(frame + 1, end).then(() => {}, () => {});
  }

  function sampleAt(time, frame = createSignalFrame(), options = {}) {
    if (!channels || disposed) {
      frame.left.fill(0);
      frame.right.fill(0);
      frame.startSample = 0;
      Object.assign(frame, emptyLevels());
      return frame;
    }
    return fillSignalFrame(channels, audioBuffer.sampleRate, time, frame, options);
  }

  function getLevels(time) {
    if (!summary || disposed || time < 0) return emptyLevels();
    if (!Number.isFinite(time)) throw new Error('Meter time must be finite');
    const index = Math.min(summary.frames - 1, signalFrameIndex(time, summary.duration));
    const base = index * LEVEL_STRIDE;
    return { lRms: summary.levels[base], rRms: summary.levels[base + 1],
      lPeak: summary.levels[base + 2], rPeak: summary.levels[base + 3], correlation: summary.levels[base + 4],
      lSamplePeak: summary.levels[base + 5], rSamplePeak: summary.levels[base + 6],
      lDisplayPeak: summary.levels[base + 7], rDisplayPeak: summary.levels[base + 8] };
  }

  function reset() {
    epoch++;
    rejectPending(abortError());
    cache.clear();
    if (!summary) {
      worker?.terminate();
      worker = null;
      audioBuffer = null;
      channels = null;
      generation++;
    } else worker.postMessage({ type: 'cancel', generation, epoch });
  }

  function dispose() {
    disposed = true;
    failWorker(abortError());
  }

  function getInfo() {
    return { fftSize: FFT_SIZE, frequencyBinCount: FFT_BINS, rtaFftSize: RTA_FFT_SIZE,
      rtaFrequencyBinCount: RTA_BINS, motionFftSize: motionAnalysis === false ? 0 : MOTION_FFT_SIZE, fps: ANALYSIS_FPS,
      frameCount: summary?.frames || 0, duration: summary?.duration || 0, sampleRate: summary?.sampleRate || 0,
      cachedFrames: cache.size, cacheCapacity: cache.capacity, cacheBytes: cache.bytes,
      workerRtaCacheBytes,
      featureBytes: summary?.levels.byteLength || 0, loaded: !!summary, spectrumBits: 16 };
  }

  return { load, getRange, getFrame, getCachedFrame, prefetch, sampleAt, getLevels, reset, getInfo, dispose,
    get buffer() { return audioBuffer; }, get peaks() { return summary?.peaks || null; },
    get rmsPeaks() { return summary?.rmsPeaks || null; },
    get duration() { return summary?.duration || 0; }, get sampleRate() { return summary?.sampleRate || 0; } };
}

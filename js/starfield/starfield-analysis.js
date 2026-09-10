import { ANALYSIS_FPS, BAND_COUNT, FFT_SIZE, FFT_BINS, FAST_FFT_SIZE, SpectrumCache, readFeatures } from './starfield-analysis-core.js';

/** A compact immutable 60 Hz feature timeline plus bounded full-resolution FFTs.
 * Await load before playback, then use getCachedFrame for the synchronous render
 * loop and getFrame to fill/prefetch the cache. Returned arrays are read-only. */
export function createStarfieldAnalysis({ cacheFrames = 120, prefetchFrames = 18 } = {}) {
  let worker = null;
  let generation = 0;
  let requestId = 0;
  let cacheEpoch = 0;
  let timeline = null;
  let loadRequest = null;
  let disposed = false;
  const cache = new SpectrumCache(cacheFrames);
  const pending = new Map();
  const pendingFrames = new Map();
  const abortError = () => new DOMException('Audio analysis was replaced or reset', 'AbortError');

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    pendingFrames.clear();
    if (loadRequest) { loadRequest.reject(error); loadRequest = null; }
  }

  function ensureWorker() {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (worker) return;
    worker = new Worker(new URL('./starfield-analysis-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: message }) => {
      if (message.generation !== generation) return;
      if (message.type === 'progress') { loadRequest?.onProgress?.(message.progress); return; }
      if (message.type === 'loaded') {
        timeline = message.timeline;
        const request = loadRequest;
        loadRequest = null;
        request?.resolve(getInfo());
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.error);
        if (loadRequest?.id === message.id) { loadRequest.reject(error); loadRequest = null; }
        const request = pending.get(message.id);
        if (request) { pending.delete(message.id); pendingFrames.delete(request.frame); request.reject(error); }
        return;
      }
      if (message.type === 'frame') {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        pendingFrames.delete(request.frame);
        cache.set(message.frame, message.spectrum);
        request.resolve(packFrame(message.frame, message.spectrum));
      }
    };
    function failWorker(error) {
      rejectPending(error);
      worker?.terminate();
      worker = null;
      timeline = null;
      cache.clear();
      generation++;
      cacheEpoch++;
    }
    worker.onerror = event => { failWorker(new Error(event.message || 'Audio analysis worker failed')); };
    worker.onmessageerror = () => { failWorker(new Error('Audio analysis worker returned unreadable data')); };
  }

  function normalizeFrame(frame) {
    if (!Number.isFinite(frame)) throw new Error('Analysis frame must be finite');
    return Math.max(0, Math.min(timeline.frames - 1, Math.floor(frame)));
  }

  function packFrame(frame, spectrum) {
    return { spectrum, features: readFeatures(timeline, frame), frame, time: frame / ANALYSIS_FPS };
  }

  function requestFrame(frame) {
    const spectrum = cache.get(frame);
    if (spectrum) return Promise.resolve(packFrame(frame, spectrum));
    if (pendingFrames.has(frame)) return pendingFrames.get(frame);
    const id = ++requestId;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { frame, resolve, reject });
      worker.postMessage({ type: 'frame', id, generation, frame });
    });
    pendingFrames.set(frame, promise);
    return promise;
  }

  function prefetch(frame) {
    const end = Math.min(timeline.frames - 1, frame + Math.min(prefetchFrames, cache.capacity - 1));
    for (let future = frame + 1; future <= end; future++) requestFrame(future).catch(() => {});
  }

  async function load(audioBuffer, { onProgress } = {}) {
    ensureWorker();
    generation++;
    cacheEpoch++;
    rejectPending(abortError());
    cache.clear();
    timeline = null;
    if (!audioBuffer?.length || !audioBuffer?.numberOfChannels || !audioBuffer?.sampleRate) throw new Error('A decoded audio buffer is required');
    // Copy while mixing: transferring this copy never detaches AudioBuffer data.
    const pcm = new Float32Array(audioBuffer.length);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const samples = audioBuffer.getChannelData(channel);
      const weight = 1 / audioBuffer.numberOfChannels;
      for (let i = 0; i < pcm.length; i++) pcm[i] += samples[i] * weight;
    }
    const id = ++requestId;
    const promise = new Promise((resolve, reject) => { loadRequest = { id, resolve, reject, onProgress }; });
    worker.postMessage({ type: 'load', id, generation, pcm, sampleRate: audioBuffer.sampleRate }, [pcm.buffer]);
    const info = await promise;
    await getFrame(0);
    return info;
  }

  async function getFrame(frameIndex) {
    if (!timeline || disposed) throw new Error('Load audio before requesting analysis frames');
    const frame = normalizeFrame(frameIndex);
    const epoch = cacheEpoch;
    const result = await requestFrame(frame);
    if (epoch !== cacheEpoch || !timeline || disposed) throw abortError();
    prefetch(frame);
    return result;
  }

  function getCachedFrame(frameIndex) {
    if (!timeline || disposed) return null;
    const frame = normalizeFrame(frameIndex);
    const spectrum = cache.get(frame);
    return spectrum ? packFrame(frame, spectrum) : null;
  }

  function getFeatureFrame(frameIndex) {
    if (!timeline || disposed) return null;
    const frame = normalizeFrame(frameIndex);
    return { features: readFeatures(timeline, frame), frame, time: frame / ANALYSIS_FPS };
  }

  function reset() {
    // Keep generation/worker PCM: immutable features need no history reset.
    // Dropping pending IDs prevents late pre-reset replies repopulating cache.
    if (loadRequest) {
      worker?.terminate();
      worker = null;
      generation++;
    }
    cacheEpoch++;
    rejectPending(abortError());
    cache.clear();
  }

  function dispose() {
    disposed = true;
    generation++;
    cacheEpoch++;
    rejectPending(abortError());
    worker?.terminate();
    worker = null;
    timeline = null;
    cache.clear();
  }

  function getInfo() {
    return { fftSize: FFT_SIZE, frequencyBinCount: FFT_BINS, fastFftSize: FAST_FFT_SIZE, fps: ANALYSIS_FPS,
      bands: BAND_COUNT, frameCount: timeline?.frames || 0, duration: timeline?.duration || 0,
      sampleRate: timeline?.sampleRate || 0, cachedFrames: cache.size, cacheCapacity: cache.capacity,
      cacheBytes: cache.bytes, featureBytes: timeline?.data.byteLength || 0, loaded: !!timeline };
  }

  return { load, getFrame, getCachedFrame, getFeatureFrame, reset, dispose, getInfo };
}

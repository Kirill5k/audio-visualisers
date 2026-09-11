import { FFT_SIZE, FFT_BINS, FAST_FFT_SIZE, ANALYSIS_FPS, BAND_COUNT, GRID_ROWS, HISTORY_SECONDS, FEATURE_STRIDE, CHUNK_FRAMES, createLEDFrameReader } from './led-analysis-core.js';
import { createLEDWaveformReader } from './led-waveform.js';
const abortError = () => new DOMException('Audio analysis was replaced or cancelled', 'AbortError');

/** Prepares the first second, then computes only requested one-second chunks.
 * Synchronous frame arrays are reusable scratch storage: copy before retaining. */
export function createLEDAnalysis() {
  let worker = null, generation = 0, nextId = 0, pendingLoad = null, timeline = null, reader = null, waveformReader = null, disposed = false, analyzedFrames = 0;
  const readyChunks = new Set(), eventChunks = new Map(), pendingRanges = new Set();
  function cancelLoad() {
    generation++;
    worker?.terminate(); worker = null;
    pendingLoad?.reject(abortError()); pendingLoad = null;
    for (const request of pendingRanges) request.reject(abortError());
    pendingRanges.clear(); readyChunks.clear(); eventChunks.clear();
    timeline = null; reader = null; waveformReader = null; analyzedFrames = 0;
  }
  function fail(error) {
    worker?.terminate(); worker = null;
    pendingLoad?.reject(error); pendingLoad = null;
    for (const request of pendingRanges) request.reject(error);
    pendingRanges.clear(); readyChunks.clear(); eventChunks.clear();
    timeline = null; reader = null; waveformReader = null; analyzedFrames = 0;
  }
  function chunksForRange(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Analysis range must be finite');
    if (!timeline) throw new Error('Load audio before requesting analysis');
    const first = Math.max(0, Math.min(timeline.frames - 1, Math.floor(Math.max(0, start) * ANALYSIS_FPS + 1e-7)));
    const last = Math.max(first, Math.min(timeline.frames - 1, Math.floor(Math.max(0, end) * ANALYSIS_FPS + 1e-7)));
    const chunks = [];
    for (let index = Math.floor(first / CHUNK_FRAMES); index <= Math.floor(last / CHUNK_FRAMES); index++) chunks.push(index);
    return chunks;
  }
  function requestChunks(chunks, priority) {
    const missing = chunks.filter(index => !readyChunks.has(index));
    if (missing.length) worker?.postMessage({ type: 'request', generation, chunks: missing, priority });
    return missing;
  }
  function ensureRange(start, end) {
    if (disposed) return Promise.reject(new Error('Audio analysis has been disposed'));
    let chunks;
    try { chunks = chunksForRange(start, end); } catch (error) { return Promise.reject(error); }
    if (chunks.every(index => readyChunks.has(index))) return Promise.resolve(getInfo());
    if (!worker) return Promise.reject(new Error('Audio analysis worker is unavailable'));
    return new Promise((resolve, reject) => {
      const request = { chunks, resolve, reject };
      pendingRanges.add(request);
      try { requestChunks(chunks, 1); } catch (error) { pendingRanges.delete(request); reject(error); }
    });
  }
  function isReady(timeSeconds) {
    if (!timeline || disposed || !Number.isFinite(timeSeconds)) return false;
    return chunksForRange(timeSeconds - HISTORY_SECONDS, timeSeconds).every(index => readyChunks.has(index));
  }
  function prefetch(timeSeconds) {
    if (!timeline || !worker || disposed || !Number.isFinite(timeSeconds)) return;
    requestChunks(chunksForRange(timeSeconds - HISTORY_SECONDS, timeSeconds + 2), 0);
  }
  async function load(audioBuffer, { onProgress } = {}) {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (!audioBuffer?.numberOfChannels || !(audioBuffer.sampleRate > 0) || !Number.isInteger(audioBuffer.length) || audioBuffer.length < 1) throw new Error('A decoded audio buffer is required');
    cancelLoad();
    // Keep read-only views of the already decoded PCM for the oscilloscope.
    // The FFT worker receives separate copies; neither path mixes stereo phases.
    waveformReader = createLEDWaveformReader(Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel)), audioBuffer.sampleRate);
    const copies = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel).slice());
    worker = new Worker(new URL('./led-analysis-worker.js', import.meta.url), { type: 'module' });
    const id = ++nextId, requestGeneration = generation;
    const promise = new Promise((resolve, reject) => { pendingLoad = { id, resolve, reject, onProgress }; });
    worker.onmessage = ({ data: message }) => {
      if (message.generation !== generation || message.id !== id || disposed) return;
      if (message.type === 'error') fail(new Error(message.error));
      else if (message.type === 'ready') {
        timeline = { ...message.metadata, bands: new Uint16Array(message.metadata.frames * BAND_COUNT), features: new Float32Array(message.metadata.frames * FEATURE_STRIDE), events: [] };
        reader = createLEDFrameReader(timeline);
        pendingLoad?.onProgress?.(0.35);
        ensureRange(0, (CHUNK_FRAMES - 1) / ANALYSIS_FPS).then(() => {
          if (requestGeneration !== generation || !pendingLoad) return;
          const completed = pendingLoad; pendingLoad = null;
          completed.onProgress?.(1); completed.resolve(getInfo());
        }).catch(error => { if (requestGeneration === generation) fail(error); });
      } else if (message.type === 'chunk' && timeline) {
        const chunk = message.chunk;
        if (readyChunks.has(chunk.index)) return;
        timeline.bands.set(chunk.bands, chunk.first * BAND_COUNT);
        timeline.features.set(chunk.features, chunk.first * FEATURE_STRIDE);
        eventChunks.set(chunk.index, chunk.events);
        timeline.events = [...eventChunks.keys()].sort((a, b) => a - b).flatMap(index => eventChunks.get(index));
        readyChunks.add(chunk.index); analyzedFrames += chunk.count;
        for (const request of pendingRanges) {
          if (request.chunks.every(index => readyChunks.has(index))) { pendingRanges.delete(request); request.resolve(getInfo()); }
        }
      }
    };
    worker.onerror = event => { if (requestGeneration === generation) fail(new Error(event.message || 'Audio analysis worker failed')); };
    worker.onmessageerror = () => { if (requestGeneration === generation) fail(new Error('Audio analysis worker returned unreadable data')); };
    onProgress?.(0);
    try { worker.postMessage({ type: 'load', id, generation, channels: copies, sampleRate: audioBuffer.sampleRate }, copies.map(channel => channel.buffer)); }
    catch (error) { fail(error); }
    return promise;
  }
  function getFrame(timeSeconds) {
    if (!reader || disposed) throw new Error('Load audio before requesting analysis frames');
    if (!isReady(timeSeconds)) throw new Error('Analysis range is not ready; await ensureRange(time - 6, time) first');
    const frame = reader(timeSeconds);
    frame.waveform = waveformReader(frame.time);
    return frame;
  }
  function getInfo() {
    return { fftSize: FFT_SIZE, fftBins: FFT_BINS, frequencyBinCount: FFT_BINS, precision: 16, spectrumBits: 16,
      fastFftSize: FAST_FFT_SIZE, analysisFps: ANALYSIS_FPS, fps: ANALYSIS_FPS, bandCount: BAND_COUNT, columns: BAND_COUNT, rows: GRID_ROWS,
      frames: timeline?.frames || 0, frameCount: timeline?.frames || 0, sampleRate: timeline?.sampleRate || 0, duration: timeline?.duration || 0,
      timelineBytes: (timeline?.bands.byteLength || 0) + (timeline?.features.byteLength || 0), eventCount: timeline?.events.length || 0,
      loaded: !!timeline, progressive: true, analyzedFrames, cachedChunks: readyChunks.size, calibrationFrames: timeline?.calibrationFrames || 0,
      fullyAnalyzed: !!timeline && analyzedFrames === timeline.frames };
  }
  function getReviewPassages() {
    // These timestamps were frozen before the first visual review.
    return [{ name: 'quiet', start: 2, duration: 8 }, { name: 'dense', start: 88, duration: 8 }, { name: 'change', start: 260, duration: 8 }].map(passage => ({ ...passage, start: Math.min(passage.start, Math.max(0, (timeline?.duration || 8) - 8)), duration: Math.min(8, timeline?.duration || 8) }));
  }
  function dispose() { cancelLoad(); disposed = true; }
  return { load, ensureRange, isReady, prefetch, getFrame, getInfo, getReviewPassages, cancelLoad, reset: cancelLoad, dispose };
}

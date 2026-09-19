import { createPhaseTimelineBuilder, createPhaseFrameReader, FFT_SIZE, FFT_BINS, ANALYSIS_FPS } from './phase-analysis-core.js';
export { SHAPE_NAMES } from './phase-analysis-core.js';

/** Reuses the shared deterministic FFT and runs compact whole-track musical
 * analysis in a worker. The render loop and offline exports read synchronously. */
export function createPhaseAnalysis() {
  let worker = null, generation = 0, timeline = null, readFrame = null, pending = null, disposed = false;
  const abortError = () => new DOMException('Audio analysis was replaced or disposed', 'AbortError');
  function clear() {
    generation++;
    worker?.terminate(); worker = null;
    pending?.reject(abortError()); pending = null;
    timeline = null; readFrame = null;
  }
  async function load(audioBuffer, { onProgress } = {}) {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (!audioBuffer?.numberOfChannels || !(audioBuffer.sampleRate > 0) || !(audioBuffer.length > 0)) throw new Error('A decoded audio buffer is required');
    clear();
    const currentGeneration = generation;
    const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) => audioBuffer.getChannelData(channel));
    onProgress?.(0);
    if (typeof Worker === 'undefined') {
      const builder = createPhaseTimelineBuilder(channels, audioBuffer.sampleRate);
      while (!builder.done) {
        onProgress?.(builder.step(120));
        await new Promise(resolve => setTimeout(resolve, 0));
        if (currentGeneration !== generation) throw abortError();
      }
      timeline = builder.timeline;
    } else {
      worker = new Worker(new URL('./phase-analysis-worker.js', import.meta.url), { type: 'module' });
      const loadingWorker = worker;
      const promise = new Promise((resolve, reject) => { pending = { resolve, reject }; });
      loadingWorker.onmessage = ({ data: message }) => {
        if (message.generation !== generation) return;
        if (message.type === 'progress') onProgress?.(message.progress);
        if (message.type === 'loaded') { pending?.resolve(message.timeline); pending = null; }
        if (message.type === 'error') { pending?.reject(new Error(message.error)); pending = null; }
      };
      loadingWorker.onerror = event => { pending?.reject(new Error(event.message || 'Audio analysis worker failed')); pending = null; };
      loadingWorker.onmessageerror = () => { pending?.reject(new Error('Audio analysis worker returned unreadable data')); pending = null; };
      const copies = channels.map(channel => channel.slice());
      try {
        loadingWorker.postMessage({ type: 'load', generation, channels: copies, sampleRate: audioBuffer.sampleRate }, copies.map(channel => channel.buffer));
        const loadedTimeline = await promise;
        if (currentGeneration !== generation) throw abortError();
        timeline = loadedTimeline;
      } catch (error) {
        if (currentGeneration === generation) { pending = null; timeline = null; }
        throw error;
      } finally {
        loadingWorker.terminate();
        if (worker === loadingWorker) worker = null;
      }
      if (currentGeneration !== generation) throw abortError();
    }
    readFrame = createPhaseFrameReader(channels, timeline);
    onProgress?.(1);
    return getInfo();
  }
  function getFrame(time) {
    if (!readFrame) throw new Error('Load audio before requesting analysis frames');
    return readFrame(time);
  }
  function getInfo() {
    return { loaded: !!timeline, fftSize: FFT_SIZE, frequencyBinCount: FFT_BINS, fps: ANALYSIS_FPS,
      frameCount: timeline?.frames || 0, duration: timeline?.duration || 0, sampleRate: timeline?.sampleRate || 0,
      featureBytes: timeline?.data.byteLength || 0, sectionCount: timeline?.sections.length || 0,
      scopeHistorySamples: FFT_SIZE, scopeWindowMs: 90, scopeGain: timeline?.scopeGain || 1 };
  }
  return { load, getFrame, getSpectrum: time => getFrame(time).spectrum, getInfo,
    dispose() { disposed = true; clear(); },
    get duration() { return timeline?.duration || 0; },
    get sampleRate() { return timeline?.sampleRate || 0; },
    get sections() { return timeline?.sections || []; } };
}

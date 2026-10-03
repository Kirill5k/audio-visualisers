import { createSignalFrame, fillSignalFrame } from '../atlas/signal-atlas-analysis-core.js';
import { ANALYSIS_FPS, PHOSPHOR_FFT_SIZE, PHOSPHOR_BANDS, readPhosphorFrame } from './phosphor-analysis-core.js';

export { createSignalFrame };
const abortError = () => new DOMException('Audio analysis was replaced or reset', 'AbortError');

/** Whole-track telemetry is computed once in a worker; preview, seeks and export read the same rows.
 * The decoded buffer stays on the main thread for playback and for the scope's raw PCM. */
export function createPhosphorAnalysis() {
  let worker = null, generation = 0, epoch = 0, requestId = 0;
  let audioBuffer = null, channels = null, summary = null, pendingLoad = null;
  let disposed = false;

  function release(error = abortError()) {
    generation++;
    epoch++;
    worker?.terminate();
    worker = null;
    if (pendingLoad) { pendingLoad.reject(error); pendingLoad = null; }
    summary = null;
    audioBuffer = null;
    channels = null;
  }

  async function load(input, { onProgress } = {}) {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (!input?.numberOfChannels || !Number.isFinite(input.sampleRate) || !(input.sampleRate > 0)
      || !Number.isInteger(input.length) || input.length < 1) throw new Error('A decoded audio buffer is required');
    const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
    if (!sourceChannels.every(channel => channel instanceof Float32Array && channel.length === input.length)) {
      throw new Error('Decoded audio channels must have equal lengths');
    }
    release();
    audioBuffer = input;
    channels = sourceChannels;
    const token = generation;
    const id = ++requestId;
    const promise = new Promise((resolve, reject) => { pendingLoad = { id, resolve, reject, onProgress }; });
    try {
      const copies = sourceChannels.map(channel => channel.slice());
      const currentWorker = new Worker(new URL('./phosphor-analysis-worker.js', import.meta.url), { type: 'module' });
      worker = currentWorker;
      const isCurrent = () => !disposed && generation === token && worker === currentWorker;
      currentWorker.onmessage = ({ data: message }) => {
        if (!isCurrent() || message.generation !== token || message.id !== pendingLoad?.id) return;
        if (message.type === 'progress') pendingLoad.onProgress?.(message.progress);
        else if (message.type === 'loaded') {
          summary = message.summary;
          const request = pendingLoad;
          pendingLoad = null;
          currentWorker.terminate();
          worker = null;
          request.resolve(getInfo());
        } else if (message.type === 'error') release(new Error(message.error));
      };
      currentWorker.onerror = event => {
        if (isCurrent()) release(new Error(event.message || 'Phosphor audio analysis worker failed'));
      };
      currentWorker.onmessageerror = () => {
        if (isCurrent()) release(new Error('Phosphor audio analysis worker returned unreadable data'));
      };
      onProgress?.(0);
      currentWorker.postMessage({ type: 'load', id, generation: token, channels: copies, sampleRate: input.sampleRate },
        copies.map(channel => channel.buffer));
    } catch (error) { release(error); }
    return promise;
  }

  function getRange(startFrame, endFrame, { onProgress } = {}) {
    if (!summary || disposed) return Promise.reject(new Error('Load audio before requesting analysis frames'));
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) throw new Error('Analysis frame must be finite');
    const start = Math.floor(startFrame), end = Math.floor(endFrame);
    if (end < start) throw new Error('The last analysis frame must follow the first');
    const requestEpoch = epoch;
    const rows = [];
    for (let frame = start; frame <= end; frame++) rows.push(readPhosphorFrame(summary, frame));
    return Promise.resolve().then(() => {
      if (epoch !== requestEpoch || disposed) throw abortError();
      onProgress?.(1);
      return rows;
    });
  }

  async function getFrame(frame) { return (await getRange(frame, frame))[0]; }
  function getCachedFrame(frame) { return summary && !disposed ? readPhosphorFrame(summary, frame) : null; }
  function prefetch() { return Promise.resolve(); }
  function getLevels() { return null; }
  function sampleAt(time, frame = createSignalFrame(), options = {}) {
    if (!channels || disposed) {
      frame.left.fill(0);
      frame.right.fill(0);
      Object.assign(frame, { startSample: 0, lRms: 0, rRms: 0, lPeak: 0, rPeak: 0, correlation: 0 });
      return frame;
    }
    return fillSignalFrame(channels, audioBuffer.sampleRate, time, frame, options);
  }
  function reset() {
    if (!summary) release();
    else epoch++;
  }
  function dispose() { disposed = true; release(); }
  function getInfo() {
    return { fftSize: PHOSPHOR_FFT_SIZE, frequencyBinCount: PHOSPHOR_FFT_SIZE / 2, fps: ANALYSIS_FPS,
      frameCount: summary?.frames || 0, duration: summary?.duration || 0, sampleRate: summary?.sampleRate || 0,
      bpm: summary?.bpm ?? NaN, bandReferences: summary ? [...summary.bandReferences] : [NaN, NaN, NaN],
      bands: PHOSPHOR_BANDS.map(band => ({ ...band })),
      featureBytes: summary?.data.byteLength || 0, overviewBytes: (summary?.peaks.byteLength || 0) + (summary?.rmsPeaks.byteLength || 0),
      cachedFrames: summary?.frames || 0, cacheBytes: 0, workerActive: !!worker, loaded: !!summary };
  }

  return { load, getRange, getFrame, getCachedFrame, prefetch, sampleAt, getLevels, reset, getInfo, dispose,
    get buffer() { return audioBuffer; }, get channels() { return channels; },
    get peaks() { return summary?.peaks || null; }, get rmsPeaks() { return summary?.rmsPeaks || null; },
    get duration() { return summary?.duration || 0; }, get sampleRate() { return summary?.sampleRate || 0; },
    get bpm() { return summary?.bpm ?? NaN; } };
}

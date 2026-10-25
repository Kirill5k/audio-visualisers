import { ANALYSIS_FPS, signalFrameIndex } from '../atlas/signal-atlas-analysis-core.js';
import { createPulseOverviewBuilder } from '../pulse/pulse-analysis-core.js';

const abortError = () => new DOMException('Audio analysis was replaced or reset', 'AbortError');
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** The overviews need only whole-track peak/RMS summaries. Keep the player's
 * frame contract without allocating FFTs, a feature timeline, or PCM windows.
 * Bounded sample batches yield so loading a long mix keeps controls responsive. */
export function createSetlistAnalysis() {
  let audioBuffer = null, summary = null;
  let generation = 0, epoch = 0, disposed = false;

  function release() {
    generation++;
    epoch++;
    audioBuffer = null;
    summary = null;
  }

  async function load(input, { onProgress } = {}) {
    if (disposed) throw new Error('Audio analysis has been disposed');
    if (!Number.isInteger(input?.numberOfChannels) || input.numberOfChannels < 1
      || !Number.isFinite(input.sampleRate) || input.sampleRate <= 0
      || !Number.isInteger(input.length) || input.length < 1 || typeof input.getChannelData !== 'function') {
      throw new Error('A decoded audio buffer is required');
    }
    const channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
    if (!channels.every(channel => channel instanceof Float32Array && channel.length === input.length)) {
      throw new Error('Decoded audio channels must have equal lengths');
    }
    // Validate a replacement before invalidating the currently usable summary.
    const builder = createPulseOverviewBuilder(channels, input.sampleRate);
    release();
    audioBuffer = input;
    const token = generation;
    const assertCurrent = () => {
      if (disposed || generation !== token) throw abortError();
    };
    try {
      onProgress?.(0);
      while (!builder.done) {
        await yieldTask();
        assertCurrent();
        const progress = builder.step(262144);
        onProgress?.(progress);
        assertCurrent();
      }
      const duration = input.length / input.sampleRate;
      summary = { ...builder.summary, duration, sampleRate: input.sampleRate,
        frames: signalFrameIndex(duration, duration) + 1 };
      return getInfo();
    } catch (error) {
      if (generation === token) release();
      throw error;
    }
  }

  function readFrame(index) {
    if (!Number.isFinite(index)) throw new Error('Analysis frame must be finite');
    return { frame: Math.floor(index) };
  }

  function getRange(startFrame, endFrame, { onProgress } = {}) {
    if (!summary || disposed) return Promise.reject(new Error('Load audio before requesting analysis frames'));
    const start = readFrame(startFrame).frame, end = readFrame(endFrame).frame;
    if (end < start) throw new Error('The last analysis frame must follow the first');
    const requestEpoch = epoch;
    const rows = [];
    for (let frame = start; frame <= end; frame++) rows.push({ frame });
    return Promise.resolve().then(() => {
      if (epoch !== requestEpoch || disposed) throw abortError();
      onProgress?.(1);
      return rows;
    });
  }

  async function getFrame(frame) { return (await getRange(frame, frame))[0]; }
  function getCachedFrame(frame) { return summary && !disposed ? readFrame(frame) : null; }
  function prefetch() { return Promise.resolve(); }
  function sampleAt(_time, frame) { return frame; }
  function getLevels() { return null; }
  function reset() {
    if (!summary) release();
    else epoch++;
  }
  function dispose() { disposed = true; release(); }
  function getInfo() {
    return { fps: ANALYSIS_FPS, fftSize: 0, frequencyBinCount: 0,
      frameCount: summary?.frames || 0, duration: summary?.duration || 0, sampleRate: summary?.sampleRate || 0,
      featureBytes: 0, overviewBytes: (summary?.peaks.byteLength || 0) + (summary?.rmsPeaks.byteLength || 0),
      cachedFrames: 0, cacheBytes: 0, workerActive: false, loaded: !!summary };
  }

  return { load, getRange, getFrame, getCachedFrame, prefetch, sampleAt, getLevels, reset, dispose, getInfo,
    get buffer() { return audioBuffer; }, get peaks() { return summary?.peaks || null; },
    get rmsPeaks() { return summary?.rmsPeaks || null; },
    get duration() { return summary?.duration || 0; }, get sampleRate() { return summary?.sampleRate || 0; } };
}

import { createSignalSummaryBuilder, createStereoSpectrum, createSmoothedStereoRta } from './signal-atlas-analysis-core.js';

let generation = 0;
let rangeEpoch = 0;
let spectrumAt = null;
let rtaAt = null;
let ready = false;
const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));

self.onmessage = async ({ data: message }) => {
  const { type, id, generation: requestGeneration } = message;
  try {
    if (type === 'load') {
      generation = requestGeneration;
      rangeEpoch = message.epoch;
      ready = false;
      const builder = createSignalSummaryBuilder(message.channels, message.sampleRate);
      while (!builder.done) {
        const progress = builder.step();
        if (generation !== requestGeneration) return;
        self.postMessage({ type: 'progress', id, generation, progress });
        await yieldToMessages();
      }
      if (generation !== requestGeneration) return;
      spectrumAt = createStereoSpectrum(message.channels, message.sampleRate);
      rtaAt = createSmoothedStereoRta(message.channels, message.sampleRate);
      ready = true;
      const summary = builder.summary;
      self.postMessage({ type: 'loaded', id, generation, summary, workerRtaCacheBytes: rtaAt.getCacheBytes() },
        [summary.peaks.buffer, summary.rmsPeaks.buffer, summary.levels.buffer]);
    } else if (type === 'cancel' && generation === requestGeneration) {
      rangeEpoch = message.epoch;
    } else if (type === 'frames') {
      if (!ready || generation !== requestGeneration || message.epoch !== rangeEpoch) return;
      // Small transferable batches keep seeks responsive and avoid retaining a
      // second 24-second history in the worker while the GPU is being updated.
      for (let offset = 0; offset < message.frames.length; offset += 4) {
        if (generation !== requestGeneration || message.epoch !== rangeEpoch) return;
        const frames = message.frames.slice(offset, offset + 4).map(frame => ({ frame, spectrum: spectrumAt(frame), ...rtaAt(frame) }));
        self.postMessage({ type: 'frames', id, generation, frames, workerRtaCacheBytes: rtaAt.getCacheBytes() }, frames.flatMap(item =>
          [item.spectrum.buffer, item.rtaLeft.buffer, item.rtaRight.buffer]));
        await yieldToMessages();
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', id, generation: requestGeneration, error: error?.message || String(error),
      workerRtaCacheBytes: rtaAt?.getCacheBytes() || 0 });
  }
};

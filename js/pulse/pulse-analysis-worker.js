import { createPulseFeatureBuilder, createPulseOverviewBuilder } from './pulse-analysis-core.js';

let generation = 0;
const yieldToMessages = () => new Promise(resolve => setTimeout(resolve, 0));

self.onmessage = async ({ data: message }) => {
  if (message.type !== 'load') return;
  const { id, generation: requestGeneration, channels, sampleRate, options } = message;
  generation = requestGeneration;
  try {
    const overview = createPulseOverviewBuilder(channels, sampleRate);
    while (!overview.done) {
      const progress = overview.step();
      if (generation !== requestGeneration) return;
      self.postMessage({ type: 'progress', id, generation, progress: progress * .1 });
      await yieldToMessages();
    }
    const features = createPulseFeatureBuilder(channels, sampleRate, options);
    while (!features.done) {
      const progress = features.step(120);
      if (generation !== requestGeneration) return;
      self.postMessage({ type: 'progress', id, generation, progress: .1 + progress * .9 });
      await yieldToMessages();
    }
    if (generation !== requestGeneration) return;
    const summary = { ...features.timeline, ...overview.summary };
    self.postMessage({ type: 'loaded', id, generation, summary },
      [summary.data.buffer, summary.peaks.buffer, summary.rmsPeaks.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', id, generation: requestGeneration, error: error?.message || String(error) });
  }
};

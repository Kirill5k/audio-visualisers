import { createPhaseTimelineBuilder } from './phase-analysis-core.js';

self.onmessage = async ({ data: message }) => {
  if (message.type !== 'load') return;
  try {
    const builder = createPhaseTimelineBuilder(message.channels, message.sampleRate);
    while (!builder.done) {
      const progress = builder.step(120);
      self.postMessage({ type: 'progress', generation: message.generation, progress });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    self.postMessage({ type: 'loaded', generation: message.generation, timeline: builder.timeline }, [builder.timeline.data.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', generation: message.generation, error: error?.message || String(error) });
  }
};

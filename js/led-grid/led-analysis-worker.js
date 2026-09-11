import { createLEDChunkAnalyzer, CHUNK_FRAMES } from './led-analysis-core.js';
let generation = 0, loadId = 0, analyzer = null, pumping = false, sequence = 0;
const jobs = new Map(), completed = new Set();
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function pump() {
  if (pumping || !analyzer) return;
  pumping = true;
  const currentGeneration = generation;
  try {
    while (jobs.size && generation === currentGeneration) {
      // Explicit seeks/exports take precedence at the next bounded DSP step.
      let selected = null;
      for (const job of jobs.values()) if (!selected || job.priority > selected.priority || (job.priority === selected.priority && job.sequence < selected.sequence)) selected = job;
      selected.builder ||= analyzer.createChunk(selected.index);
      selected.builder.step(12);
      if (selected.builder.done) {
        const chunk = selected.builder.chunk;
        jobs.delete(selected.index); completed.add(selected.index);
        self.postMessage({ type: 'chunk', id: loadId, generation, chunk }, [chunk.bands.buffer, chunk.features.buffer]);
      }
      await pause();
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: loadId, generation: currentGeneration, error: error?.message || String(error) });
  } finally {
    pumping = false;
    if (generation !== currentGeneration && jobs.size) pump();
  }
}
self.onmessage = ({ data: message }) => {
  if (message.type === 'load') {
    generation = message.generation; loadId = message.id;
    jobs.clear(); completed.clear(); sequence = 0;
    try {
      analyzer = createLEDChunkAnalyzer(message.channels, message.sampleRate);
      self.postMessage({ type: 'ready', id: loadId, generation, metadata: analyzer.metadata });
    } catch (error) {
      self.postMessage({ type: 'error', id: loadId, generation, error: error?.message || String(error) });
    }
  } else if (message.type === 'request' && message.generation === generation && analyzer) {
    const chunkCount = Math.ceil(analyzer.metadata.frames / CHUNK_FRAMES);
    for (const index of message.chunks) {
      if (!Number.isInteger(index) || index < 0 || index >= chunkCount || completed.has(index)) continue;
      const existing = jobs.get(index);
      if (existing) existing.priority = Math.max(existing.priority, message.priority || 0);
      else jobs.set(index, { index, priority: message.priority || 0, sequence: sequence++ });
    }
    pump();
  }
};

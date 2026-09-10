import { createFFT, createFeatureBuilder, FFT_SIZE, ANALYSIS_FPS } from './starfield-analysis-core.js';

let generation = 0;
let pcm = null;
let sampleRate = 48000;
let fft = null;
let ready = false;

self.onmessage = async ({ data: message }) => {
  const { type, id, generation: requestGeneration } = message;
  try {
    if (type === 'load') {
      generation = requestGeneration;
      ready = false;
      pcm = message.pcm;
      sampleRate = message.sampleRate;
      fft ??= createFFT(FFT_SIZE);
      const builder = createFeatureBuilder(pcm, sampleRate);
      while (!builder.done) {
        const progress = builder.step(180);
        if (requestGeneration !== generation) return;
        self.postMessage({ type: 'progress', generation, progress });
        // Allow a replacement track or reset to cancel a long preprocessing job.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (requestGeneration !== generation) return;
      ready = true;
      const timeline = builder.timeline;
      self.postMessage({ type: 'loaded', id, generation, timeline }, [timeline.data.buffer]);
    } else if (type === 'frame') {
      if (!ready || requestGeneration !== generation) return;
      const spectrum = new Uint8Array(FFT_SIZE / 2);
      fft.byteSpectrum(pcm, Math.round(message.frame * sampleRate / ANALYSIS_FPS), spectrum);
      self.postMessage({ type: 'frame', id, generation, frame: message.frame, spectrum }, [spectrum.buffer]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', id, generation: requestGeneration, error: error?.message || String(error) });
  }
};

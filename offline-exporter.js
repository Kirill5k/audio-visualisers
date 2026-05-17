"use strict";

// Minimal radix-2 Cooley-Tukey FFT
function createFFT(size) {
  const n = size;
  const halfN = n >>> 1;
  const bitRev = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >>> 1;
    for (; j & bit; bit >>>= 1) j ^= bit;
    j ^= bit;
    bitRev[i] = j;
  }

  const cosTable = new Float64Array(halfN);
  const sinTable = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) {
    const angle = -2 * Math.PI * i / n;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }

  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  }

  return {
    size: n,
    window: window,

    // Compute magnitude spectrum (0..255 Uint8Array, like AnalyserNode.getByteFrequencyData)
    getByteFrequencyData(input, inputOffset, output, minDecibels, maxDecibels, smoothingConstant, prevSpectrum) {
      const re = new Float64Array(n);
      const im = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        re[bitRev[i]] = input[inputOffset + i] * window[i];
      }

      for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >>> 1;
        const step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let j = 0; j < halfLen; j++) {
            const idx = j * step;
            const tRe = re[i + j + halfLen] * cosTable[idx] - im[i + j + halfLen] * sinTable[idx];
            const tIm = re[i + j + halfLen] * sinTable[idx] + im[i + j + halfLen] * cosTable[idx];
            re[i + j + halfLen] = re[i + j] - tRe;
            im[i + j + halfLen] = im[i + j] - tIm;
            re[i + j] += tRe;
            im[i + j] += tIm;
          }
        }
      }

      const rangeDb = maxDecibels - minDecibels;
      for (let i = 0; i < halfN; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n;
        let db = 20 * Math.log10(Math.max(mag, 1e-20));
        if (prevSpectrum) {
          db = prevSpectrum[i] * smoothingConstant + db * (1 - smoothingConstant);
          prevSpectrum[i] = db;
        }
        const normalized = (db - minDecibels) / rangeDb;
        output[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
      }
    }
  };
}

async function offlineExport(opts) {
  const {
    audioBuffer,        // decoded AudioBuffer
    fps = 60,
    width = 1920,
    height = 1080,
    fftSize = 2048,
    smoothingTimeConstant = 0.85,
    minDecibels = -100,
    maxDecibels = -30,
    renderFrame,        // (frequencyData: Uint8Array, delta: number) => void — must render to canvas
    readCanvas,         // () => HTMLCanvasElement — return the canvas to read pixels from
    gpuFinish,          // () => void — flush GPU pipeline before frame capture
    onProgress,         // (fraction: number) => void
    onDone,             // () => void
    writable,           // FileSystemWritableFileStream from showSaveFilePicker
    isCancelled,        // () => boolean — check if export was cancelled
  } = opts;

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;
  const totalFrames = Math.ceil(duration * fps);
  const samplesPerFrame = sampleRate / fps;
  const fft = createFFT(fftSize);
  const freqBins = fftSize / 2;
  const frequencyData = new Uint8Array(freqBins);
  const prevSpectrum = new Float64Array(freqBins).fill(-100);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(audioBuffer.getChannelData(ch));

  // Sliding window buffer for FFT — avoids allocating a full mono copy
  const fftWindow = new Float32Array(fftSize);
  function fillFftWindow(offset) {
    const safeOffset = Math.max(0, offset);
    const end = Math.min(safeOffset + fftSize, audioBuffer.length);
    const count = end - safeOffset;
    for (let i = 0; i < count; i++) {
      let sample = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sample += channels[ch][safeOffset + i];
      }
      fftWindow[i] = sample / numChannels;
    }
    for (let i = count; i < fftSize; i++) fftWindow[i] = 0;
  }

  // Set up mp4-muxer first so encoders can feed it directly
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.StreamTarget({
      onData: (data, position) => {
        writable.write({ type: 'write', position, data });
      },
    }),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: {
      codec: 'aac',
      sampleRate,
      numberOfChannels: numChannels,
    },
    fastStart: false,
  });

  // Set up VideoEncoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => console.error('VideoEncoder error:', e),
  });

  videoEncoder.configure({
    codec: 'avc1.640033',
    width,
    height,
    bitrate: 40_000_000,
    framerate: fps,
    avc: { format: 'avc' },
  });

  // Set up AudioEncoder
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta);
    },
    error: (e) => console.error('AudioEncoder error:', e),
  });

  audioEncoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: numChannels,
    bitrate: 192_000,
  });

  const delta = 1 / fps;
  const canvas = readCanvas();
  const maxSamplesPerFrame = Math.ceil(samplesPerFrame) + 1;
  const planarData = new Float32Array(maxSamplesPerFrame * numChannels);

  // Pre-compute FFT for first frame
  const firstOffset = Math.min(0, audioBuffer.length - fftSize);
  if (firstOffset >= 0) {
    fillFftWindow(firstOffset);
    fft.getByteFrequencyData(fftWindow, 0, frequencyData, minDecibels, maxDecibels, smoothingTimeConstant, prevSpectrum);
  } else {
    frequencyData.fill(0);
  }

  for (let frame = 0; frame < totalFrames; frame++) {
    if (isCancelled && isCancelled()) {
      videoEncoder.close();
      audioEncoder.close();
      await writable.abort();
      return;
    }

    // Render using pre-computed FFT data (submits GL commands to GPU)
    renderFrame(frequencyData, delta);

    // Pipeline: do CPU work while GPU executes the render
    // 1. Compute FFT for the NEXT frame
    if (frame + 1 < totalFrames) {
      const nextSampleOffset = Math.round((frame + 1) * samplesPerFrame);
      const nextSafeOffset = Math.min(nextSampleOffset, audioBuffer.length - fftSize);
      if (nextSafeOffset >= 0) {
        fillFftWindow(nextSafeOffset);
        fft.getByteFrequencyData(fftWindow, 0, frequencyData, minDecibels, maxDecibels, smoothingTimeConstant, prevSpectrum);
      } else {
        frequencyData.fill(0);
      }
    }

    // 2. Encode audio for the current frame
    const audioStart = Math.round(frame * samplesPerFrame);
    const audioEnd = Math.min(Math.round((frame + 1) * samplesPerFrame), audioBuffer.length);
    const frameSamples = audioEnd - audioStart;
    if (frameSamples > 0) {
      for (let ch = 0; ch < numChannels; ch++) {
        const chOffset = ch * frameSamples;
        for (let i = 0; i < frameSamples; i++) {
          planarData[chOffset + i] = channels[ch][audioStart + i] || 0;
        }
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frameSamples,
        numberOfChannels: numChannels,
        timestamp: audioStart / sampleRate * 1_000_000,
        data: planarData.subarray(0, frameSamples * numChannels),
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }

    // Flush GPU pipeline and capture the rendered frame
    if (gpuFinish) gpuFinish();
    const vf = new VideoFrame(canvas, {
      timestamp: Math.round(frame * 1_000_000 / fps),
      duration: Math.round(1_000_000 / fps),
    });
    const keyFrame = frame % (fps * 2) === 0;
    videoEncoder.encode(vf, { keyFrame });
    vf.close();

    if (onProgress && frame % 60 === 0) onProgress(frame / totalFrames);

    // Backpressure: wait for encoder to catch up if queue grows too large
    if (videoEncoder.encodeQueueSize > 3) {
      await new Promise(r => { videoEncoder.ondequeue = () => { videoEncoder.ondequeue = null; r(); }; });
    }
    // Yield to browser periodically to keep UI responsive
    if (frame % 60 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();

  if (onProgress) onProgress(1);

  muxer.finalize();
  await writable.close();

  if (onDone) onDone();
}

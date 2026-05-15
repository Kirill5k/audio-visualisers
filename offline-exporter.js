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

  // Mix down to mono for FFT
  const monoData = new Float32Array(audioBuffer.length);
  for (let ch = 0; ch < numChannels; ch++) {
    const chData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < audioBuffer.length; i++) {
      monoData[i] += chData[i] / numChannels;
    }
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
    fastStart: 'in-memory',
  });

  // Set up VideoEncoder
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => console.error('VideoEncoder error:', e),
  });

  videoEncoder.configure({
    codec: 'avc1.42003d',
    width,
    height,
    bitrate: 20_000_000,
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

  for (let frame = 0; frame < totalFrames; frame++) {
    if (isCancelled && isCancelled()) {
      videoEncoder.close();
      audioEncoder.close();
      await writable.abort();
      return;
    }

    // Compute FFT for this frame's audio position
    const sampleOffset = Math.round(frame * samplesPerFrame);
    const safeOffset = Math.min(sampleOffset, monoData.length - fftSize);

    if (safeOffset >= 0) {
      fft.getByteFrequencyData(monoData, safeOffset, frequencyData, minDecibels, maxDecibels, smoothingTimeConstant, prevSpectrum);
    } else {
      frequencyData.fill(0);
    }

    // Render the frame
    renderFrame(frequencyData, delta);

    // Encode video frame
    const vf = new VideoFrame(canvas, {
      timestamp: frame * delta * 1_000_000,
      duration: delta * 1_000_000,
    });
    const keyFrame = frame % (fps * 2) === 0;
    videoEncoder.encode(vf, { keyFrame });
    vf.close();

    // Encode audio for this frame
    const audioStart = Math.round(frame * samplesPerFrame);
    const audioEnd = Math.min(Math.round((frame + 1) * samplesPerFrame), audioBuffer.length);
    const frameSamples = audioEnd - audioStart;
    if (frameSamples > 0) {
      const planarData = new Float32Array(frameSamples * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        const chData = audioBuffer.getChannelData(ch);
        const chOffset = ch * frameSamples;
        for (let i = 0; i < frameSamples; i++) {
          planarData[chOffset + i] = chData[audioStart + i] || 0;
        }
      }
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frameSamples,
        numberOfChannels: numChannels,
        timestamp: audioStart / sampleRate * 1_000_000,
        data: planarData,
      });
      audioEncoder.encode(audioData);
      audioData.close();
    }

    if (onProgress) onProgress(frame / totalFrames);

    // Yield to browser every 4 frames to keep UI responsive
    if (frame % 4 === 0) {
      await videoEncoder.flush();
      await audioEncoder.flush();
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

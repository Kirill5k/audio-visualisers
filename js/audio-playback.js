/**
 * Shared Web Audio playback + analyser for the visualisers.
 * Factory returns a stateful object (load / play / pause / frequency data).
 */
export function createAudioPlayback({
  fftSize = 1024,
  smoothing = 0.75,
  minDecibels = -100,
  maxDecibels = -26,
} = {}) {
  let context = null;
  let analyser = null;
  let gainNode = null;
  let mediaStreamDestination = null;
  let buffer = null;
  let source = null;
  let fileName = "";
  let playing = false;
  let paused = false;
  let muted = false;
  let endedHandler = null;

  const frequencyData = new Uint8Array(fftSize / 2);

  function ensureGraph() {
    if (context) return;

    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothing;
    analyser.minDecibels = minDecibels;
    analyser.maxDecibels = maxDecibels;

    gainNode = context.createGain();
    gainNode.gain.value = muted ? 0 : 1;

    mediaStreamDestination = context.createMediaStreamDestination();
    analyser.connect(gainNode);
    gainNode.connect(context.destination);
    analyser.connect(mediaStreamDestination);
  }

  function stopSource() {
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
    source = null;
    playing = false;
  }

  return {
    get context() { return context; },
    get analyser() { return analyser; },
    get frequencyData() { return frequencyData; },
    get binCount() { return frequencyData.length; },
    get buffer() { return buffer; },
    get hasAudio() { return Boolean(buffer); },
    get isPlaying() { return playing; },
    get isPaused() { return paused; },
    get isMuted() { return muted; },
    get fileName() { return fileName; },
    get duration() { return buffer ? buffer.duration : 0; },

    setMuted(value) {
      muted = Boolean(value);
      if (gainNode && context) {
        gainNode.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
      }
      return muted;
    },

    toggleMute() {
      return this.setMuted(!muted);
    },

    async resumeContext() {
      ensureGraph();
      if (context.state !== "running") await context.resume();
    },

    async suspendContext() {
      if (context?.state === "running") await context.suspend();
    },

    async load(file) {
      ensureGraph();
      await context.resume();
      stopSource();
      paused = false;
      buffer = await context.decodeAudioData(await file.arrayBuffer());
      fileName = file.name || "";
      return buffer;
    },

    play({ onEnded } = {}) {
      if (!buffer) return;
      ensureGraph();
      stopSource();

      endedHandler = typeof onEnded === "function" ? onEnded : null;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        playing = false;
        paused = false;
        source = null;
        if (endedHandler) endedHandler();
      };

      source.start();
      playing = true;
      paused = false;
    },

    async pause() {
      if (!playing) return;
      if (context?.state === "running") await context.suspend();
      playing = false;
      paused = true;
    },

    async resume() {
      if (playing) return;
      if (context?.state === "suspended") await context.resume();
      if (source) {
        playing = true;
        paused = false;
      }
    },

    stop() {
      stopSource();
      paused = false;
    },

    unload() {
      stopSource();
      paused = false;
      buffer = null;
      fileName = "";
      frequencyData.fill(0);
      if (context?.state === "suspended") context.resume();
    },

    pullFrequencyData() {
      if (!analyser) return false;
      analyser.getByteFrequencyData(frequencyData);
      return true;
    },

    setSmoothing(value) {
      if (analyser) analyser.smoothingTimeConstant = value;
    },

    getExportAudio() {
      if (!buffer || !analyser) return null;
      return {
        audioBuffer: buffer,
        fftSize: analyser.fftSize,
        smoothingTimeConstant: analyser.smoothingTimeConstant,
        minDecibels: analyser.minDecibels,
        maxDecibels: analyser.maxDecibels,
      };
    },

    getRecordingAudioTrack() {
      ensureGraph();
      const track = mediaStreamDestination.stream.getAudioTracks()[0];
      return track || null;
    },
  };
}

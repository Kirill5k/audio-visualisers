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
  let playbackOffset = 0;
  let startedAtContextTime = 0;
  let offsetAtStart = 0;

  const MAX_FFT_SIZE = 8192;

  let frequencyData = new Uint8Array(MAX_FFT_SIZE / 2);
  let timeDomainData = new Uint8Array(MAX_FFT_SIZE);

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

  function stopSource({ preserveOffset = false } = {}) {
    if (!source) return;
    if (!preserveOffset && playing && context) {
      playbackOffset = Math.min(
        buffer?.duration || 0,
        offsetAtStart + context.currentTime - startedAtContextTime,
      );
    }
    source.onended = null;
    try { source.stop(); } catch (_) {}
    try { source.disconnect(); } catch (_) {}
    source = null;
    playing = false;
  }

  function beginPlayback(atOffset) {
    if (!buffer) return;
    ensureGraph();
    stopSource({ preserveOffset: true });

    offsetAtStart = Math.max(0, Math.min(buffer.duration, atOffset));
    playbackOffset = offsetAtStart;
    startedAtContextTime = context.currentTime;

    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    source.onended = () => {
      playing = false;
      paused = false;
      playbackOffset = 0;
      source = null;
      const handler = endedHandler;
      endedHandler = null;
      if (handler) handler();
    };

    source.start(0, offsetAtStart);
    playing = true;
    paused = false;
  }

  return {
    get context() { return context; },
    get analyser() { return analyser; },
    get frequencyData() { return frequencyData; },
    get timeDomainData() { return timeDomainData; },
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
      playbackOffset = 0;
      buffer = await context.decodeAudioData(await file.arrayBuffer());
      fileName = file.name || "";
      return buffer;
    },

    play({ onEnded, fromStart = true } = {}) {
      if (!buffer) return;
      endedHandler = typeof onEnded === "function" ? onEnded : null;
      if (fromStart) playbackOffset = 0;
      beginPlayback(playbackOffset);
    },

    async pause() {
      if (!playing) return;
      stopSource();
      paused = true;
    },

    async resume() {
      if (playing || !buffer || !paused) return;
      await this.resumeContext();
      beginPlayback(playbackOffset);
    },

    stop() {
      stopSource();
      playbackOffset = 0;
      paused = false;
    },

    seek(seconds) {
      if (!buffer) return;
      playbackOffset = Math.max(0, Math.min(buffer.duration, seconds));
      if (playing) beginPlayback(playbackOffset);
    },

    unload() {
      stopSource();
      paused = false;
      playbackOffset = 0;
      buffer = null;
      fileName = "";
      frequencyData.fill(0);
      timeDomainData.fill(128);
      if (context?.state === "suspended") context.resume();
    },

    getPlaybackPosition() {
      if (!buffer) return 0;
      if (playing && source && context) {
        return Math.min(
          buffer.duration,
          offsetAtStart + context.currentTime - startedAtContextTime,
        );
      }
      return playbackOffset;
    },

    getProgress() {
      if (!buffer || buffer.duration <= 0) return 0;
      return this.getPlaybackPosition() / buffer.duration;
    },

    setProgress(fraction) {
      if (!buffer) return;
      this.seek(buffer.duration * Math.max(0, Math.min(1, fraction)));
    },

    pullFrequencyData() {
      if (!analyser) return false;
      analyser.getByteFrequencyData(frequencyData);
      return true;
    },

    pullTimeDomainData() {
      if (!analyser) return false;
      analyser.getByteTimeDomainData(timeDomainData);
      return true;
    },

    setFftSize(size) {
      if (analyser) analyser.fftSize = size;
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

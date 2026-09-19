import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { createSignalAnalysis, createSignalFrame } from '../atlas/signal-atlas-analysis.js';
import { signalFrameIndex } from '../atlas/signal-atlas-analysis-core.js';
import { formatTrackTime } from '../atlas/signal-atlas-setlist.js';

const $ = id => document.getElementById(id);
const FPS = 60;

/** Shared absolute-time playback, history reconstruction, transport and capture.
 * Scenes own geometry and optional controls; all visualisers use identical audio
 * data for live preview, seeking, recording and deterministic offline export. */
export async function createSpectralPlayer({
  name, slug, settings, createScene, historySeconds = 24, historyPaddingFrames = 0,
  previewAspect = null, previewMinWidth = 0, previewMinHeight = 0, audioSampleRate = 48000,
  controls = [], quality = {}, extend = () => ({}),
}) {
  const HISTORY_FRAMES = Math.round(historySeconds * FPS) + historyPaddingFrames;
  const audio = createAudioPlayback({ fftSize: 32768, maxFftSize: 32768, smoothing: 0, sampleRate: audioSampleRate });
  let analysis = createSignalAnalysis({ cacheFrames: 1500, prefetchFrames: 30 });
  const sampleFrame = createSignalFrame(16384);
  const stage = $('stage');
  // Canvas text is rasterized once per label update. Load the bundled variable
  // font before scene creation so preview and capture never cache fallback text.
  try {
    const fonts = await document.fonts.load('500 16px "Inter"');
    if (!fonts.length || fonts.some(font => font.status !== 'loaded')) {
      throw new Error('The bundled Inter font did not load.');
    }
  } catch (error) {
    $('fatal').style.display = 'flex';
    $('fatal').textContent = `${name} could not load its Inter font. Reload the page to try again.`;
    $('statusText').textContent = 'Font unavailable · ' + error.message;
    throw error;
  }
  let scene;
  try {
    scene = createScene(stage, settings);
  } catch (error) {
    if ($('fatal')) {
      $('fatal').hidden = false;
      $('fatal').style.display = 'flex';
      $('fatal').textContent = `${name} needs WebGL 2 and a GPU with 16,384-pixel textures. ${error.message}`;
    }
    if ($('statusText')) $('statusText').textContent = 'Graphics unavailable · ' + error.message;
    throw error;
  }

  let busy = '';
  let generation = 0;
  let finished = false;
  let disposed = false;
  let displayedTime = 0;
  let uploadedFrame = -1;
  let displayedSpectrum = null;
  let dirty = true;
  let bufferingTask = null;
  let nextPrefetchAt = 0;
  let rafId = 0;
  let fpsFrames = 0;
  let fpsStarted = performance.now();
  let latestFps = 0;
  let seekEditing = false;
  let viewport = { width: 1920, height: 1080, pixelRatio: 1 };
  let lastError = null;
  let recordingStopWaiter = null;
  let recordingStopError = null;
  let extension = {};

  function setStatus(message, live = audio.isPlaying) {
    if ($('statusText')) $('statusText').textContent = message;
    $('statusLight')?.classList.toggle('live', Boolean(live));
    $('statusLight')?.classList.toggle('busy', Boolean(busy));
    stage?.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function reportError(error) {
    if (error?.name === 'AbortError') return;
    console.error(error);
    lastError = error?.message || String(error);
    setStatus(lastError, false);
  }

  function frameAt(time) {
    return signalFrameIndex(time, analysis.duration);
  }

  function updateTimeline() {
    const duration = audio.duration;
    const timeOptions = { forceHours: duration >= 3600 };
    if ($('currentTime')) $('currentTime').textContent = formatTrackTime(displayedTime, timeOptions);
    if ($('durationText')) $('durationText').textContent = formatTrackTime(duration, timeOptions);
    if ($('seek') && document.activeElement !== $('seek')) {
      $('seek').value = duration ? String(displayedTime / duration * 1000) : '0';
    }
    if ($('seekSeconds') && !seekEditing) $('seekSeconds').value = displayedTime.toFixed(2);
    if ($('seekSeconds')) $('seekSeconds').max = String(duration);
  }

  function resize(width, height, pixelRatio = devicePixelRatio || 1) {
    viewport = { width: Math.max(1, width), height: Math.max(1, height), pixelRatio };
    scene.resize(viewport.width, viewport.height, pixelRatio);
    dirty = true;
  }

  function resizePreview() {
    if (capture?.isExporting || recorder?.isRecording) return;
    const rect = stage.getBoundingClientRect();
    let width = rect.width || innerWidth, height = rect.height || innerHeight;
    if (previewAspect) { width = Math.min(width, height * previewAspect); height = width / previewAspect; }
    const pixelRatio = Math.max(devicePixelRatio || 1, previewMinWidth / width, previewMinHeight / height);
    resize(width, height, pixelRatio);
  }

  const capture = createCaptureSession({
    width: 1920,
    height: 1080,
    fps: FPS,
    getCanvas: () => scene.canvas,
    getAudioTrack: () => audio.getRecordingAudioTrack(),
    saveViewport: () => ({ ...viewport, camera: scene.getCameraState?.() }),
    applyViewport: (width, height) => resize(width, height, 2),
    applyRecordingViewport: (width, height) => resize(width, height, 1),
    restoreViewport: saved => {
      if (saved.camera) scene.setCameraState?.(saved.camera);
      resize(saved.width, saved.height, saved.pixelRatio);
    },
    overlay: {
      root: $('exportOverlay'), status: $('exportStatus'),
      progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn'),
    },
  });

  const recorder = globalThis.createRecorder({
    defaultFilename: slug,
    videoBitsPerSecond: 40_000_000,
    onStatus: setStatus,
    onStart() {
      recordingStopError = null;
      $('recordBtn')?.classList.add('recording');
      updateButtons();
      renderPosition(displayedTime);
    },
    onStop(error) {
      recordingStopError = error || null;
      if (error) {
        lastError = error.message || String(error);
        setStatus('Recording failed · ' + lastError, false);
      }
      capture.onRecordingStopped();
      $('recordBtn')?.classList.remove('recording');
      dirty = true;
      const waiter = recordingStopWaiter;
      recordingStopWaiter = null;
      // The recorder's stop event follows its final async write and close. Keep
      // all recording destinations exclusive until that completion callback.
      busy = waiter ? 'restoring' : '';
      updateButtons();
      waiter?.();
    },
  });

  // Scene-specific controls use this narrow facade; the audio/seek/capture clock
  // remains shared by Atlas and Terrain. Analysis is a getter because load failures
  // and unload replace the worker owner.
  const context = {
    settings, scene, audio, bind,
    get analysis() { return analysis; },
    get locked() { return Boolean(busy || recorder.isRecording || capture.isExporting); },
    invalidate() { dirty = true; },
  };
  extension = extend(context) || {};
  scene.setOnChange?.(() => { dirty = true; });

  function updateButtons() {
    if (busy || recorder.isRecording) extension.hideHover?.();
    const ready = audio.hasAudio && !busy;
    const locked = Boolean(busy || recorder.isRecording);
    scene.setInteractionEnabled?.(!locked);
    for (const id of ['playPauseBtn', 'replayBtn', 'unloadBtn', 'seek', 'seekSeconds', 'seekBtn']) {
      if ($(id)) $(id).disabled = !ready || recorder.isRecording;
    }
    if ($('playPauseBtn')) {
      $('playPauseBtn').innerHTML = audio.isPlaying
        ? 'Ⅱ <span class="action-label">Pause</span>'
        : '▶ <span class="action-label">Play</span>';
      $('playPauseBtn').setAttribute('aria-label', audio.isPlaying ? 'Pause' : 'Play');
    }
    for (const id of ['fileInput', 'referenceBtn']) if ($(id)) $(id).disabled = locked;
    if ($('recordBtn')) {
      $('recordBtn').disabled = !ready || !globalThis.MediaRecorder;
      $('recordBtn').setAttribute('aria-label', recorder.isRecording ? 'Stop recording' : 'Record');
      const label = $('recordBtn').querySelector('.action-label');
      if (label) label.textContent = recorder.isRecording ? 'Stop' : 'Record';
    }
    if ($('exportBtn')) {
      const supported = globalThis.VideoEncoder && globalThis.AudioEncoder && globalThis.showSaveFilePicker;
      $('exportBtn').disabled = !ready || recorder.isRecording || !supported;
      $('exportBtn').title = supported
        ? 'Export 1080p at 60 fps, rendered at 4K'
        : 'MP4 export requires Chromium with WebCodecs and the file save picker';
    }
    for (const input of document.querySelectorAll('#panel input, #panel select, #panel textarea, #panel button')) {
      if (!['fileInput', 'referenceBtn', 'seekSeconds', 'seekBtn'].includes(input.id)) input.disabled = locked;
    }
    stage.setAttribute('aria-busy', String(Boolean(busy)));
    $('statusLight')?.classList.toggle('busy', Boolean(busy));
  }

  // Keep the displayed spectrum independently of the bounded history cache. A
  // backward seek can evict its end frame while reconstructing earlier history.
  function setSceneHistoryFrames(rows) {
    scene.setHistoryFrames(rows);
    if (rows.length) displayedSpectrum = rows[rows.length - 1];
  }

  function resetSceneHistory() {
    displayedSpectrum = null;
    scene.resetHistory();
  }

  function renderPosition(time) {
    displayedTime = Math.max(0, Math.min(analysis.duration || 0, time));
    analysis.sampleAt(displayedTime, sampleFrame, { trailing: true });
    scene.render({
      time: displayedTime,
      analysis,
      frame: sampleFrame,
      spectralFrame: analysis.buffer ? displayedSpectrum : null,
      levels: analysis.buffer ? analysis.getLevels(displayedTime) : null,
    });
    dirty = false;
    updateTimeline();
    extension.onRender?.();
  }

  async function rebuildHistory(time, token = generation, onProgress) {
    const end = frameAt(time);
    const start = Math.max(0, end - HISTORY_FRAMES + 1);
    const rows = await analysis.getRange(start, end, { onProgress });
    if (token !== generation || disposed) return false;
    resetSceneHistory();
    setSceneHistoryFrames(rows);
    uploadedFrame = end;
    nextPrefetchAt = end;
    renderPosition(time);
    return true;
  }

  function cachedRowsThrough(end) {
    if (end < uploadedFrame || end - uploadedFrame >= HISTORY_FRAMES) return null;
    const rows = [];
    for (let index = uploadedFrame + 1; index <= end; index++) {
      const row = analysis.getCachedFrame(index);
      if (!row) return null;
      rows.push(row);
    }
    return rows;
  }

  function prefetch(index) {
    if (index < nextPrefetchAt) return;
    nextPrefetchAt = index + 12;
    const token = generation;
    Promise.resolve(analysis.prefetch(index)).catch(error => {
      if (token === generation && error?.name !== 'AbortError') reportError(error);
    });
  }

  async function recoverHistory() {
    if (bufferingTask || busy || !audio.isPlaying) return bufferingTask;
    const token = generation;
    const task = (async () => {
      busy = 'buffering';
      await audio.pause();
      const position = audio.getPlaybackPosition();
      updateButtons();
      setStatus('Preparing detailed audio history…', false);
      const end = frameAt(position);
      if (end < uploadedFrame || end - uploadedFrame >= HISTORY_FRAMES) {
        await rebuildHistory(position, token);
      } else {
        const rows = await analysis.getRange(Math.max(0, uploadedFrame + 1), end);
        if (token !== generation || disposed) return;
        setSceneHistoryFrames(rows);
        uploadedFrame = end;
        renderPosition(position);
      }
      await analysis.prefetch(end);
      if (token !== generation || disposed) return;
      await audio.resume();
      setStatus(audio.fileName, true);
    })().catch(error => {
      if (token === generation) reportError(error);
    }).finally(() => {
      if (token === generation) {
        busy = '';
        updateButtons();
      }
      if (bufferingTask === task) bufferingTask = null;
    });
    bufferingTask = task;
    return task;
  }

  function ended() {
    finished = true;
    displayedTime = audio.duration;
    dirty = true;
    if (recorder.isRecording) {
      busy = 'recording-save';
      recorder.stop();
    }
    setStatus('Track complete · replay to begin again', false);
    updateButtons();
    // Shared playback resets its position at completion; retain the final overview
    // explicitly and reconstruct its final spectral row if the last RAF was skipped.
    rebuildHistory(displayedTime).catch(reportError);
  }

  async function play() {
    if (!audio.hasAudio || busy || recorder.isRecording) return false;
    if (audio.isPlaying) return true;
    if (finished || displayedTime >= audio.duration) {
      await seek(0, { resume: false });
    }
    await audio.resumeContext();
    audio.seek(displayedTime);
    finished = false;
    audio.play({ fromStart: false, onEnded: ended });
    prefetch(frameAt(displayedTime));
    setStatus(audio.fileName, true);
    updateButtons();
    return true;
  }

  async function pause() {
    if (!audio.hasAudio || busy || recorder.isRecording) return false;
    await audio.pause();
    if (!finished) displayedTime = audio.getPlaybackPosition();
    setStatus('Paused · ' + audio.fileName, false);
    updateButtons();
    dirty = true;
    return true;
  }

  async function seek(seconds, { resume = audio.isPlaying } = {}) {
    if (!audio.hasAudio || busy || recorder.isRecording) return false;
    const value = Number(seconds);
    if (!Number.isFinite(value)) throw new RangeError('Track position must be a finite number.');
    const position = Math.max(0, Math.min(audio.duration, value));
    const token = ++generation;
    busy = 'seeking';
    await audio.pause();
    audio.seek(position);
    finished = position >= audio.duration;
    updateButtons();
    setStatus(`Restoring ${historySeconds} seconds of audio detail…`, false);
    try {
      await rebuildHistory(position, token, fraction => {
        if (token === generation) setStatus(`Restoring audio detail · ${Math.round(fraction * 100)}%`, false);
      });
      if (token !== generation) return false;
      if (resume && !finished) {
        await audio.resumeContext();
        audio.play({ fromStart: false, onEnded: ended });
      }
      setStatus(finished ? 'Track complete · replay to begin again' : (resume ? audio.fileName : 'Paused · ' + audio.fileName), resume && !finished);
      return true;
    } finally {
      if (token === generation) {
        busy = '';
        updateButtons();
      }
    }
  }

  async function loadTrack(file, { autoplay = true } = {}) {
    if (busy || recorder.isRecording) return false;
    const replacingTrack = audio.hasAudio;
    const token = ++generation;
    busy = 'loading';
    finished = false;
    lastError = null;
    updateButtons();
    setStatus('Decoding audio…', false);
    try {
      const buffer = await audio.load(file);
      if (token !== generation) return false;
      resetSceneHistory();
      uploadedFrame = -1;
      displayedTime = 0;
      await analysis.load(buffer, { onProgress: fraction => {
        if (token === generation) setStatus(`Analysing stereo detail · ${Math.round(fraction * 100)}%`, false);
      } });
      if (token !== generation) return false;
      // Keep a setlist pasted before the first load, but never carry track starts
      // from a previous mix into its replacement.
      scene.setSampleRate?.(analysis.sampleRate);
      extension.onTrackLoaded?.({ replacingTrack });
      scene.setOverview?.(analysis.peaks, analysis.rmsPeaks);
      const rows = await analysis.getRange(0, Math.min(29, frameAt(audio.duration)));
      if (token !== generation) return false;
      setSceneHistoryFrames(rows.filter(row => row.frame === 0));
      uploadedFrame = 0;
      nextPrefetchAt = 0;
      renderPosition(0);
      setStatus(autoplay ? audio.fileName : 'Ready · ' + audio.fileName, false);
    } catch (error) {
      audio.unload();
      analysis.dispose();
      analysis = createSignalAnalysis({ cacheFrames: 1500, prefetchFrames: 30 });
      resetSceneHistory();
      scene.setOverview?.(new Float32Array(0));
      uploadedFrame = -1;
      displayedTime = 0;
      extension.onReset?.({ clear: replacingTrack });
      dirty = true;
      throw error;
    } finally {
      if (token === generation) {
        busy = '';
        updateButtons();
      }
    }
    if (autoplay) await play();
    return true;
  }

  async function loadReference() {
    if (busy || recorder.isRecording) return false;
    // Resume inside the click gesture before awaiting fetch/decode.
    await audio.resumeContext();
    await audio.pause();
    busy = 'fetching';
    updateButtons();
    setStatus('Loading reference track…', false);
    let file;
    try {
      const response = await fetch('./reference.mp3');
      if (!response.ok) throw new Error(`Could not load reference.mp3 (${response.status}).`);
      file = new File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' });
    } finally {
      busy = '';
      updateButtons();
    }
    return loadTrack(file);
  }

  function unload() {
    if (busy || recorder.isRecording) return;
    generation++;
    audio.unload();
    analysis.dispose();
    analysis = createSignalAnalysis({ cacheFrames: 1500, prefetchFrames: 30 });
    resetSceneHistory();
    scene.setOverview?.(new Float32Array(0));
    uploadedFrame = -1;
    nextPrefetchAt = 0;
    displayedTime = 0;
    finished = false;
    extension.onReset?.({ clear: true });
    dirty = true;
    renderPosition(0);
    setStatus('Choose audio or play the reference track', false);
    updateButtons();
  }

  function sliceAudio(start, duration) {
    const original = audio.buffer;
    const firstSample = Math.min(original.length - 1, Math.round(start * original.sampleRate));
    const lastSample = Math.min(original.length, Math.round((start + duration) * original.sampleRate));
    const length = Math.max(1, lastSample - firstSample);
    const clip = audio.context.createBuffer(original.numberOfChannels, length, original.sampleRate);
    for (let channel = 0; channel < original.numberOfChannels; channel++) {
      clip.copyToChannel(original.getChannelData(channel).subarray(firstSample, firstSample + length), channel);
    }
    return { buffer: clip, start: firstSample / original.sampleRate };
  }

  async function exportVideo({ start = 0, duration = audio.duration, writable = null, clip = false } = {}) {
    if (!audio.hasAudio || busy || recorder.isRecording) return { ok: false, reason: 'busy' };
    if (!globalThis.VideoEncoder || !globalThis.AudioEncoder || typeof globalThis.offlineExport !== 'function') {
      throw new Error('MP4 export requires Chromium with WebCodecs support.');
    }
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
      throw new RangeError('Export start and duration must be finite, with a positive duration.');
    }
    start = Math.max(0, Math.min(audio.duration - 1 / audio.buffer.sampleRate, start));
    duration = Math.min(duration, audio.duration - start);
    const wasPlaying = audio.isPlaying;
    await audio.pause();
    const saved = { time: finished ? audio.duration : audio.getPlaybackPosition(), finished, wasPlaying };
    const token = ++generation;
    busy = 'exporting';
    updateButtons();
    const excerpt = clip ? sliceAudio(start, duration) : { buffer: audio.buffer, start: 0 };
    const exportAudio = {
      hasAudio: true,
      duration: excerpt.buffer.duration,
      suspendContext: () => audio.suspendContext(),
      resumeContext: () => audio.resumeContext(),
      getExportAudio: () => ({ ...audio.getExportAudio(), audioBuffer: excerpt.buffer }),
    };
    try {
      const result = await capture.runOfflineExport({
        audio: exportAudio,
        suggestedName: `${slug}${clip ? '-excerpt' : ''}.mp4`,
        pendingWritable: writable,
        onStatus: setStatus,
        labels: { rendering: `Rendering ${name} at 4K…`, progress: 'Rendering frame {frame} of {total}', saved: 'MP4 saved · 1920 × 1080 · 60 fps' },
        async prepare() {
          await rebuildHistory(excerpt.start, token);
          return saved;
        },
        async analysisProvider(index) {
          const time = Math.min(audio.duration, excerpt.start + index / FPS);
          const end = frameAt(time);
          const data = await analysis.getFrame(end);
          return { ...data, time };
        },
        async renderFrame(_spectrum, _delta, data) {
          const end = frameAt(data.time);
          if (end !== uploadedFrame) {
            const rows = await analysis.getRange(Math.max(0, uploadedFrame + 1), end);
            setSceneHistoryFrames(rows);
            uploadedFrame = end;
          }
          renderPosition(data.time);
        },
        readCanvas: () => scene.canvas,
        gpuFinish: () => scene.canvas.getContext('webgl2')?.finish(),
        async restore() {
          await rebuildHistory(saved.time, token);
          finished = saved.finished;
          audio.seek(saved.time);
        },
      });
      if (result.error) throw result.error;
      return result;
    } finally {
      busy = '';
      // A cancelled picker returns before capture's restore callback is entered.
      displayedTime = saved.time;
      finished = saved.finished;
      audio.seek(saved.time);
      dirty = true;
      if (wasPlaying && !saved.finished) {
        await audio.resumeContext();
        audio.play({ fromStart: false, onEnded: ended });
      }
      updateButtons();
    }
  }

  async function toggleRecording() {
    if (recorder.isRecording) {
      busy = 'recording-save';
      recorder.stop();
      updateButtons();
      return;
    }
    if (!audio.hasAudio || busy) return;
    busy = 'recording-setup';
    updateButtons();
    let prepared;
    try {
      prepared = await recorder.prepareAutoRecord();
      if (!prepared) return;
      if (finished) {
        audio.seek(0);
        finished = false;
        await rebuildHistory(0);
      }
      if (!audio.isPlaying) {
        await audio.resumeContext();
        audio.play({ fromStart: false, onEnded: ended });
      }
      recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
      setStatus('Recording · ' + audio.fileName, true);
    } catch (error) {
      // Stream creation already swapped the viewport before MediaRecorder was
      // constructed. A constructor/start failure must release that stream too.
      const started = recorder.isRecording;
      if (started) recorder.stop();
      capture.onRecordingStopped();
      if (!started) {
        try { await prepared?.writable?.abort?.(); } catch (_) {}
      }
      throw error;
    } finally {
      busy = '';
      updateButtons();
    }
  }

  /** Brief real-time recording for the optional review UI. It uses the production
   * recorder and audio stream, then restores the original track position. */
  async function recordClip({ duration = 1, writable } = {}) {
    if (!audio.hasAudio || busy || recorder.isRecording) return { ok: false, reason: 'busy' };
    if (!globalThis.MediaRecorder) throw new Error('This browser does not support real-time recording.');
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3) {
      throw new RangeError('Review recordings must be longer than zero and at most three seconds.');
    }
    if (typeof writable?.write !== 'function' || typeof writable?.close !== 'function') {
      throw new TypeError('A writable video destination is required.');
    }
    const saved = {
      time: finished ? audio.duration : audio.getPlaybackPosition(),
      finished,
      wasPlaying: audio.isPlaying,
    };
    const start = finished ? 0 : saved.time;
    const recordDuration = Math.min(duration, audio.duration - start);
    let stopTimer;
    let stopped;
    let writeFailure = null;
    let writes = Promise.resolve();
    // MediaRecorder callbacks do not await one another. Serialize writes and
    // retain errors until onStop has completed viewport restoration.
    const destination = {
      write(chunk) {
        writes = writes.then(() => {
          if (!writeFailure) return writable.write(chunk);
        }).catch(error => { writeFailure ||= error; });
        return writes;
      },
      async close() {
        await writes;
        try {
          if (writeFailure) await writable.abort?.();
          else await writable.close();
        } catch (error) { writeFailure ||= error; }
      },
    };
    busy = 'recording-setup';
    updateButtons();
    await audio.pause();
    const token = ++generation;
    try {
      setStatus('Preparing review recording…', false);
      if (finished) await rebuildHistory(0, token);
      await analysis.getRange(frameAt(start), frameAt(start + recordDuration));
      audio.seek(start);
      finished = false;
      renderPosition(start);
      const codec = recorder.getCodec();
      const stream = capture.makeRecordingStream();
      if (!stream) throw new Error('Could not capture the visualiser canvas.');
      stopped = new Promise(resolve => { recordingStopWaiter = resolve; });
      recorder.begin(stream, destination, codec);
      await audio.resumeContext();
      audio.play({ fromStart: false, onEnded: ended });
      busy = '';
      updateButtons();
      setStatus('Recording review excerpt…', true);
      stopTimer = setTimeout(() => {
        if (!recorder.isRecording) return;
        busy = 'recording-save';
        recorder.stop();
        updateButtons();
      }, recordDuration * 1000);
      await stopped;
      if (writeFailure) throw writeFailure;
      if (recordingStopError) throw recordingStopError;
      return { ok: true, mimeType: codec.mime, duration: recordDuration };
    } finally {
      clearTimeout(stopTimer);
      if (recorder.isRecording) {
        recorder.stop();
        await stopped;
      }
      recordingStopWaiter = null;
      capture.onRecordingStopped();
      busy = 'restoring';
      updateButtons();
      await audio.pause();
      try {
        await rebuildHistory(saved.time, ++generation);
      } finally {
        finished = saved.finished;
        displayedTime = saved.time;
        audio.seek(saved.time);
        if (saved.wasPlaying && !saved.finished) {
          await audio.resumeContext();
          audio.play({ fromStart: false, onEnded: ended });
        }
        busy = '';
        dirty = true;
        updateButtons();
      }
    }
  }

  function toggleClean(force) {
    extension.hideHover?.();
    const hidden = force ?? !document.body.classList.contains('clean');
    document.body.classList.toggle('clean', hidden);
    $('cleanBtn')?.setAttribute('aria-pressed', String(hidden));
  }

  function togglePanel(force) {
    const open = force ?? $('panel')?.classList.contains('hidden');
    $('panel')?.classList.toggle('hidden', !open);
    $('panelToggle')?.classList.toggle('closed', !open);
    $('panelToggle')?.setAttribute('aria-expanded', String(Boolean(open)));
    $('panelToggle')?.setAttribute('aria-label', open ? 'Hide settings' : 'Show settings');
  }

  function bind(id, event, handler) {
    $(id)?.addEventListener(event, eventObject => {
      try {
        Promise.resolve(handler(eventObject)).catch(reportError);
      } catch (error) { reportError(error); }
    });
  }

  bind('fileInput', 'change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await loadTrack(file); } finally { event.target.value = ''; }
  });
  bind('referenceBtn', 'click', loadReference);
  bind('playPauseBtn', 'click', () => audio.isPlaying ? pause() : play());
  bind('replayBtn', 'click', () => seek(0, { resume: true }));
  bind('unloadBtn', 'click', unload);
  bind('recordBtn', 'click', toggleRecording);
  bind('exportBtn', 'click', () => exportVideo());
  bind('seek', 'change', event => seek(Number(event.target.value) / 1000 * audio.duration));
  bind('seekSeconds', 'focus', () => { seekEditing = true; });
  bind('seekSeconds', 'blur', () => { seekEditing = false; });
  bind('seekSeconds', 'keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    seekEditing = false;
    return seek(Number(event.target.value));
  });
  bind('seekBtn', 'click', () => {
    seekEditing = false;
    return seek(Number($('seekSeconds').value));
  });
  bind('muteBtn', 'click', () => {
    const muted = audio.toggleMute();
    $('muteBtn').setAttribute('aria-pressed', String(muted));
    $('muteBtn').setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    $('muteBtn').title = muted ? 'Unmute audio · M' : 'Mute audio · M';
    $('muteBtn').innerHTML = muted
      ? '♩ <span class="action-label">Unmute</span>'
      : '♪ <span class="action-label">Mute</span>';
  });
  bind('panelToggle', 'click', () => togglePanel());
  bind('cleanBtn', 'click', () => toggleClean());
  bind('fullscreenBtn', 'click', () => document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen());
  document.querySelector('label[for="fileInput"]')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (!$('fileInput').disabled) $('fileInput').click();
  });

  for (const key of controls) {
    bind(key, 'input', event => {
      if (busy || recorder.isRecording) return;
      settings[key] = event.target.type === 'checkbox' ? event.target.checked
        : event.target.type === 'color' ? event.target.value : Number(event.target.value);
      if ($(key + 'Value')) $(key + 'Value').textContent = settings[key] + (event.target.dataset.suffix || '');
      dirty = true;
    });
  }

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const editing = event.target instanceof HTMLElement
      && (event.target.isContentEditable || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName));
    if (editing && event.code !== 'Escape') return;
    // Preserve native keyboard activation of focused buttons while allowing the
    // global visibility shortcuts after clicking Clean view or the settings icon.
    if (event.code === 'Space' && event.target instanceof HTMLElement && event.target.tagName === 'BUTTON') return;
    let action;
    switch (event.code) {
      case 'Space': action = () => audio.isPlaying ? pause() : play(); break;
      case 'KeyR': action = () => seek(0, { resume: true }); break;
      case 'KeyM': action = () => $('muteBtn')?.click(); break;
      case 'KeyH': action = () => toggleClean(); break;
      case 'Escape': action = () => { toggleClean(false); togglePanel(true); }; break;
      default: return;
    }
    event.preventDefault();
    Promise.resolve(action()).catch(reportError);
  });

  document.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  document.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    if (busy || recorder.isRecording) return;
    loadTrack(event.dataTransfer.files[0]).catch(reportError);
  });

  function animate(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    if (!busy && !capture.isExporting) {
      if (audio.isPlaying) {
        const time = audio.getPlaybackPosition();
        const end = frameAt(time);
        const rows = cachedRowsThrough(end);
        if (!rows) {
          recoverHistory();
        } else if ((rows.length || dirty) && (!recorder.isRecording || !capture.shouldSkipRecordingFrame(now, true))) {
          if (rows.length) setSceneHistoryFrames(rows);
          uploadedFrame = end;
          // The same 60 Hz track clock drives preview and deterministic export.
          renderPosition(Math.min(audio.duration, end / FPS));
          fpsFrames++;
          prefetch(end);
          if (recorder.isRecording) capture.requestRecordingFrame(now);
        }
      } else if (dirty) {
        renderPosition(finished ? audio.duration : displayedTime);
        fpsFrames++;
      }
    }
    if (now - fpsStarted >= 1000) {
      latestFps = Math.round(fpsFrames * 1000 / (now - fpsStarted));
      if ($('fps')) $('fps').textContent = audio.isPlaying ? `${latestFps} fps` : '60 fps export';
      fpsStarted = now;
      fpsFrames = 0;
    }
  }

  const resizeObserver = new ResizeObserver(resizePreview);
  resizeObserver.observe(stage);
  window.addEventListener('resize', resizePreview);
  window.addEventListener('pagehide', () => {
    disposed = true;
    generation++;
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    audio.stop();
    if (recorder.isRecording) recorder.stop();
    analysis.dispose();
    scene.dispose();
    audio.context?.close().catch(() => {});
  });

  // Deterministic inspection and excerpt rendering use the same production paths.
  // This small API also supports the optional local review UI.
  const api = Object.freeze({
    loadReference,
    loadFile: file => loadTrack(file, { autoplay: false }),
    loadFixture: file => loadTrack(file, { autoplay: false }),
    seek: seconds => seek(seconds),
    pause,
    play,
    unload,
    async renderAt(seconds) {
      const result = await seek(seconds, { resume: false });
      return result ? api.getState() : null;
    },
    exportClip: ({ start = displayedTime, duration = 2, writable = null } = {}) => exportVideo({ start, duration, writable, clip: true }),
    recordClip,
    flushAnalysisCache() {
      if (busy || recorder.isRecording) return false;
      analysis.reset();
      nextPrefetchAt = 0;
      return true;
    },
    getState: () => ({
      ready: Boolean(analysis.buffer), busy,
      playing: audio.isPlaying, paused: audio.isPaused, muted: audio.isMuted,
      finished, recording: recorder.isRecording, exporting: capture.isExporting,
      position: displayedTime, duration: audio.duration, uploadedFrame,
      fileName: audio.fileName, fps: latestFps,
      viewport: { ...viewport, canvasWidth: scene.canvas.width, canvasHeight: scene.canvas.height },
      quality: { fftSize: 32768, frequencyBins: 16384, rtaFftSize: 2048, analysisFps: FPS,
        exportWidth: 1920, exportHeight: 1080, exportScale: 2,
        ...(typeof quality === 'function' ? quality(scene) : quality) },
      settings: structuredClone(settings),
      analysis: analysis.getInfo(), scene: scene.getInfo(), error: lastError,
      ...extension.getState?.(),
    }),
    ...extension.api,
  });

  extension.initialize?.();
  togglePanel(false);
  resizePreview();
  updateButtons();
  setStatus('Choose audio or play the reference track', false);
  rafId = requestAnimationFrame(animate);
  return api;
}

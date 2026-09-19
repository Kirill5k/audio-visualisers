import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { formatTrackTime } from '../atlas/signal-atlas-setlist.js';
import { createPhaseAnalysis } from './phase-analysis.js';
import { createPhaseLoomScene } from './phase-loom-scene.js';

const $ = id => document.getElementById(id);
const settings = { gain: 1.2, glow: .2, brightness: 1, persistence: .55, motion: false, palette: 'phosphor', shape: 'auto', density: 16384, zoom: 1 };
const projectionNames = { stereo: 'Stereo X/Y', phase: 'Phase portrait', spatial: 'Spatial oscilloscope' };
const audio = createAudioPlayback({ fftSize: 32768, maxFftSize: 32768, smoothing: 0, sampleRate: 48000 });
let analysis = createPhaseAnalysis();
let scene;
try {
  await document.fonts.load('400 16px "Inter"');
  scene = createPhaseLoomScene($('stage'), settings);
} catch (error) {
  $('fatal').style.display = 'flex';
  $('fatal').textContent = 'Phase Scope could not start. ' + error.message;
  throw error;
}

let busy = '', position = 0, finished = false, dirty = true, disposed = false;
let viewport = { width: 1920, height: 1080, pixelRatio: 1 }, view = 'oblique';
let lastFrame = null, lastFrameIndex = -1, latestFps = 0, fpsStarted = performance.now(), fpsFrames = 0;
let lastError = null, raf = 0, reviewURL = null, recordingStopWaiter = null, recordingStopError = null;
const emptyFrame = { time: 0, spectrum: new Uint8Array(16384), waveform: new Float32Array(2048),
  features: { bass: 0, mids: 0, highs: 0, energy: 0, kick: 0, rms: 0 }, shapeFrom: 0, shapeTo: 0, morph: 0, phaseName: 'Stereo X/Y', section: 0 };

function status(message) { $('statusText').textContent = message; $('statusLight').classList.toggle('live', audio.isPlaying); }
function report(error) { lastError = error?.message || String(error); status(lastError); console.error(error); }
function locked() { return Boolean(busy || recorder.isRecording || capture.isExporting); }
function bind(id, event, handler) {
  $(id)?.addEventListener(event, e => {
    try { Promise.resolve(handler(e)).catch(report); } catch (error) { report(error); }
  });
}
function resize(width, height, pixelRatio = 1) {
  viewport = { width: Math.max(1, width), height: Math.max(1, height), pixelRatio };
  scene.resize(viewport.width, viewport.height, pixelRatio);
  const bounds = $('stage').getBoundingClientRect();
  const displayWidth = Math.min(bounds.width, bounds.height * 16 / 9);
  scene.canvas.style.width = `${displayWidth}px`; scene.canvas.style.height = `${displayWidth * 9 / 16}px`;
  dirty = true;
}
function resizePreview() {
  if (capture.isExporting || recorder.isRecording) return;
  const rect = $('stage').getBoundingClientRect();
  const width = Math.min(rect.width, rect.height * 16 / 9);
  resize(width, width * 9 / 16, Math.max(devicePixelRatio || 1, 2560 / Math.max(1, width)));
}
const capture = createCaptureSession({
  width: 1920, height: 1080, fps: 60,
  getCanvas: () => scene.canvas, getAudioTrack: () => audio.getRecordingAudioTrack(),
  saveViewport: () => ({ ...viewport }),
  applyViewport: (width, height) => resize(width, height, 2),
  applyRecordingViewport: (width, height) => resize(width, height, 1),
  restoreViewport: saved => resize(saved.width, saved.height, saved.pixelRatio),
  overlay: { root: $('exportOverlay'), status: $('exportStatus'), progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn') },
});
const recorder = globalThis.createRecorder({
  defaultFilename: 'phase-scope', videoBitsPerSecond: 40_000_000, onStatus: status,
  onStart() { recordingStopError = null; $('recordBtn').classList.add('recording'); dirty = true; updateButtons(); },
  onError: report,
  onStop(error) {
    capture.onRecordingStopped();
    $('recordBtn').classList.remove('recording');
    recordingStopError = error || null;
    const waiter = recordingStopWaiter; recordingStopWaiter = null;
    busy = waiter ? 'restoring recording' : ''; dirty = true;
    if (error) report(error);
    updateButtons(); waiter?.();
  },
});

function updateButtons() {
  const lock = locked(), ready = audio.hasAudio && !lock;
  for (const id of ['playPauseBtn', 'replayBtn', 'unloadBtn', 'seek', 'seekSeconds', 'seekBtn']) $(id).disabled = !ready;
  for (const id of ['fileInput', 'referenceBtn', 'welcomeFileBtn', 'welcomeReferenceBtn']) $(id).disabled = lock;
  $('recordBtn').disabled = (!audio.hasAudio || Boolean(busy)) && !recorder.isRecording || !globalThis.MediaRecorder;
  $('recordBtn').querySelector('.action-label').textContent = recorder.isRecording ? 'Stop' : 'Record';
  $('recordBtn').setAttribute('aria-label', recorder.isRecording ? 'Stop recording' : 'Record');
  $('playPauseBtn').innerHTML = audio.isPlaying ? 'Ⅱ <span class="action-label">Pause</span>' : '▶ <span class="action-label">Play</span>';
  $('playPauseBtn').setAttribute('aria-label', audio.isPlaying ? 'Pause' : 'Play');
  const canExport = Boolean(globalThis.VideoEncoder && globalThis.AudioEncoder && globalThis.showSaveFilePicker);
  $('exportBtn').disabled = !ready || !canExport;
  $('exportBtn').title = canExport ? 'MP4 · 1080p / 60 fps, rendered at 4K' : 'MP4 export requires Chromium with WebCodecs and the file save picker';
  for (const input of document.querySelectorAll('#panel input, #panel select, #panel button')) {
    if (!['fileInput', 'referenceBtn', 'seekSeconds', 'seekBtn'].includes(input.id)) input.disabled = lock;
  }
  $('welcome').hidden = audio.hasAudio;
  $('stage').setAttribute('aria-busy', String(Boolean(busy)));
  $('statusLight').classList.toggle('live', audio.isPlaying);
}

function renderAtPosition(seconds) {
  position = audio.hasAudio ? Math.max(0, Math.min(audio.duration, seconds)) : 0;
  lastFrame = audio.hasAudio ? analysis.getFrame(position) : emptyFrame;
  scene.render(lastFrame);
  $('phaseLabel').textContent = projectionNames[settings.shape] || (audio.hasAudio ? `Passage ${String((lastFrame.section ?? 0) + 1).padStart(2, '0')} · ${lastFrame.phaseName}` : 'STEREO IN MOTION');
  const timeOptions = { forceHours: audio.duration >= 3600 };
  $('currentTime').textContent = formatTrackTime(position, timeOptions);
  $('durationText').textContent = formatTrackTime(audio.duration, timeOptions);
  if (document.activeElement !== $('seek')) $('seek').value = audio.duration ? String(position / audio.duration * 1000) : '0';
  if (document.activeElement !== $('seekSeconds')) $('seekSeconds').value = position.toFixed(2);
  $('seekSeconds').max = String(audio.duration);
  dirty = false;
}

function ended() {
  finished = true; position = audio.duration; dirty = true;
  if (recorder.isRecording) { busy = 'saving recording'; recorder.stop(); }
  status('Track complete · replay to begin again'); updateButtons();
}
async function play() {
  if (!audio.hasAudio || locked()) return false;
  if (audio.isPlaying) return true;
  if (finished || position >= audio.duration) { position = 0; finished = false; }
  await audio.resumeContext();
  audio.seek(position); audio.play({ fromStart: false, onEnded: ended });
  status(audio.fileName); updateButtons(); return true;
}
async function pause() {
  if (!audio.hasAudio || locked()) return false;
  await audio.pause();
  if (!finished) position = audio.getPlaybackPosition();
  renderAtPosition(position); status('Paused · ' + audio.fileName); updateButtons(); return true;
}
async function seek(seconds, { resume = audio.isPlaying } = {}) {
  if (!audio.hasAudio || locked()) return false;
  const value = Number(seconds);
  if (!Number.isFinite(value)) throw new RangeError('Track position must be a finite number.');
  await audio.pause();
  position = Math.max(0, Math.min(audio.duration, value)); finished = position >= audio.duration;
  audio.seek(position); lastFrameIndex = -1; renderAtPosition(position);
  if (resume && !finished) await play();
  else { status(finished ? 'Track complete · replay to begin again' : 'Paused · ' + audio.fileName); updateButtons(); }
  return true;
}
async function loadTrack(file, { autoplay = true } = {}) {
  if (locked()) return false;
  busy = 'loading'; lastError = null; updateButtons(); status('Decoding audio…');
  try {
    const buffer = await audio.load(file);
    analysis.dispose?.(); analysis = createPhaseAnalysis();
    await analysis.load(buffer, { onProgress: fraction => status(`Listening for musical changes · ${Math.round(fraction * 100)}%`) });
    position = 0; finished = false; lastFrameIndex = -1;
    renderAtPosition(0); status('Ready · ' + audio.fileName);
  } catch (error) {
    audio.unload(); analysis.dispose?.(); analysis = createPhaseAnalysis();
    position = 0; finished = false; renderAtPosition(0); throw error;
  } finally { busy = ''; updateButtons(); }
  if (autoplay) await play();
  return true;
}
async function loadReference() {
  if (locked()) return false;
  await audio.resumeContext();
  await audio.pause();
  if (audio.hasAudio && !finished) position = audio.getPlaybackPosition();
  busy = 'loading reference'; updateButtons(); status('Loading reference track…');
  let file;
  try {
    const response = await fetch('./reference.mp3');
    if (!response.ok) throw new Error(`Could not load reference.mp3 (${response.status}).`);
    file = new File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' });
  } finally { busy = ''; updateButtons(); }
  return loadTrack(file);
}
function unload() {
  if (locked()) return false;
  audio.unload(); analysis.dispose?.(); analysis = createPhaseAnalysis();
  position = 0; finished = false; lastFrameIndex = -1;
  renderAtPosition(0); updateButtons(); status('Choose an audio file or play the reference track'); return true;
}
function setView(value) {
  if (locked() || !['front', 'oblique', 'top'].includes(value)) return false;
  view = value; scene.setView(value); dirty = true;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  renderAtPosition(position); return value;
}

async function toggleRecording() {
  if (recorder.isRecording) { busy = 'saving recording'; recorder.stop(); updateButtons(); return; }
  if (!audio.hasAudio || locked()) return;
  busy = 'preparing recording'; updateButtons();
  let prepared;
  try {
    prepared = await recorder.prepareAutoRecord();
    if (!prepared) return;
    if (finished) { position = 0; finished = false; audio.seek(0); }
    if (!audio.isPlaying) { await audio.resumeContext(); audio.seek(position); audio.play({ fromStart: false, onEnded: ended }); }
    recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
    renderAtPosition(audio.getPlaybackPosition()); status('Recording · ' + audio.fileName);
  } catch (error) {
    if (recorder.isRecording) recorder.stop();
    else { try { await prepared?.writable?.abort?.(); } catch (_) {} }
    capture.onRecordingStopped(); throw error;
  } finally { busy = ''; updateButtons(); }
}

async function recordClip({ duration = 1, writable } = {}) {
  if (!audio.hasAudio || locked()) return { ok: false, reason: 'busy' };
  if (!globalThis.MediaRecorder) throw new Error('This browser does not support recording.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3) throw new RangeError('Review recordings must be between zero and three seconds.');
  if (typeof writable?.write !== 'function' || typeof writable?.close !== 'function') throw new TypeError('A writable destination is required.');
  const saved = { position: finished ? audio.duration : audio.getPlaybackPosition(), finished, playing: audio.isPlaying };
  await audio.pause(); busy = 'preparing recording'; updateButtons();
  let timer, stopped;
  try {
    const start = finished ? 0 : saved.position;
    audio.seek(start); finished = false;
    const stream = capture.makeRecordingStream();
    if (!stream) throw new Error('Could not capture the visualiser.');
    renderAtPosition(start);
    stopped = new Promise(resolve => { recordingStopWaiter = resolve; });
    const codec = recorder.getCodec();
    recorder.begin(stream, writable, codec);
    await audio.resumeContext(); audio.play({ fromStart: false, onEnded: ended });
    busy = ''; updateButtons();
    timer = setTimeout(() => { if (recorder.isRecording) { busy = 'saving recording'; recorder.stop(); updateButtons(); } }, Math.min(duration, audio.duration - start) * 1000);
    await stopped;
    if (recordingStopError) throw recordingStopError;
    return { ok: true, mimeType: codec.mime };
  } finally {
    clearTimeout(timer);
    if (recorder.isRecording) { recorder.stop(); await stopped; }
    recordingStopWaiter = null; capture.onRecordingStopped();
    await audio.pause(); position = saved.position; finished = saved.finished; audio.seek(position);
    busy = ''; lastFrameIndex = -1; renderAtPosition(position); updateButtons();
    if (saved.playing && !finished) await play();
  }
}

function audioExcerpt(start, duration) {
  const original = audio.buffer;
  const first = Math.round(start * original.sampleRate), last = Math.min(original.length, Math.round((start + duration) * original.sampleRate));
  const clip = audio.context.createBuffer(original.numberOfChannels, Math.max(1, last - first), original.sampleRate);
  for (let channel = 0; channel < original.numberOfChannels; channel++) clip.copyToChannel(original.getChannelData(channel).subarray(first, last), channel);
  return { buffer: clip, start: first / original.sampleRate };
}
async function exportVideo({ start = 0, duration = audio.duration, writable = null, clip = false } = {}) {
  if (!audio.hasAudio || locked()) return { ok: false, reason: 'busy' };
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder) throw new Error('MP4 export requires Chromium with WebCodecs.');
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) throw new RangeError('Export duration must be positive.');
  const saved = { position: finished ? audio.duration : audio.getPlaybackPosition(), playing: audio.isPlaying, finished };
  await audio.pause(); busy = 'exporting'; updateButtons();
  start = Math.max(0, Math.min(audio.duration - 1 / audio.buffer.sampleRate, start));
  duration = Math.min(duration, audio.duration - start);
  const excerpt = clip ? audioExcerpt(start, duration) : { buffer: audio.buffer, start: 0 };
  const exportAudio = { hasAudio: true, duration: excerpt.buffer.duration,
    suspendContext: () => audio.suspendContext(), resumeContext: () => audio.resumeContext(),
    getExportAudio: () => ({ ...audio.getExportAudio(), audioBuffer: excerpt.buffer }) };
  try {
    const result = await capture.runOfflineExport({
      audio: exportAudio, suggestedName: `phase-scope${clip ? '-excerpt' : ''}.mp4`, pendingWritable: writable, onStatus: status,
      labels: { rendering: 'Rendering Phase Scope at 4K…', saved: 'MP4 saved · 1920 × 1080 · 60 fps' },
      prepare: () => saved,
      analysisProvider: index => analysis.getFrame(Math.min(audio.duration, excerpt.start + index / 60)),
      renderFrame: (_spectrum, _delta, data) => { scene.render(data); },
      readCanvas: () => scene.canvas, gpuFinish: () => scene.gpuFinish(),
      restore: () => { position = saved.position; finished = saved.finished; audio.seek(position); },
    });
    if (result.error) throw result.error;
    return result;
  } finally {
    position = saved.position; finished = saved.finished; audio.seek(position); busy = ''; lastFrameIndex = -1;
    renderAtPosition(position); updateButtons();
    if (saved.playing && !finished) await play();
  }
}

function togglePanel(force) {
  const open = force ?? $('panel').classList.contains('hidden');
  $('panel').classList.toggle('hidden', !open); $('panelToggle').classList.toggle('closed', !open);
  $('panelToggle').setAttribute('aria-expanded', String(open)); $('panelToggle').setAttribute('aria-label', open ? 'Hide settings' : 'Show settings');
}
function toggleClean(force) {
  const clean = force ?? !document.body.classList.contains('clean');
  document.body.classList.toggle('clean', clean); $('cleanBtn').setAttribute('aria-pressed', String(clean));
}
function toggleMute() {
  const muted = audio.toggleMute(); $('muteBtn').setAttribute('aria-pressed', String(muted));
  $('muteBtn').setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  $('muteBtn').innerHTML = `${muted ? '♩' : '♪'} <span class="action-label">${muted ? 'Unmute' : 'Mute'}</span>`;
}
bind('fileInput', 'change', async event => { const file = event.target.files?.[0]; if (file) { try { await loadTrack(file); } finally { event.target.value = ''; } } });
bind('referenceBtn', 'click', loadReference); bind('welcomeReferenceBtn', 'click', loadReference);
bind('welcomeFileBtn', 'click', () => $('fileInput').click());
bind('playPauseBtn', 'click', () => audio.isPlaying ? pause() : play());
bind('replayBtn', 'click', () => seek(0, { resume: true })); bind('unloadBtn', 'click', unload);
bind('seek', 'change', event => seek(Number(event.target.value) / 1000 * audio.duration));
bind('seekBtn', 'click', () => seek(Number($('seekSeconds').value)));
bind('seekSeconds', 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); return seek(Number(event.target.value)); } });
bind('recordBtn', 'click', toggleRecording); bind('exportBtn', 'click', () => exportVideo());
bind('muteBtn', 'click', toggleMute); bind('panelToggle', 'click', () => togglePanel()); bind('cleanBtn', 'click', () => toggleClean());
bind('fullscreenBtn', 'click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
for (const key of ['gain', 'glow', 'brightness', 'persistence', 'motion', 'palette', 'shape', 'zoom']) {
  bind(key, 'input', event => {
    if (locked()) return;
    const input = event.target;
    settings[key] = input.type === 'checkbox' ? input.checked : key === 'palette' || key === 'shape' ? input.value : Number(input.value);
    if ($(key + 'Value')) $(key + 'Value').textContent = Number(settings[key]).toFixed(2);
    dirty = true; renderAtPosition(position);
  });
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
document.querySelector('label[for="fileInput"]').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!locked()) $('fileInput').click(); }
});
document.addEventListener('keydown', event => {
  const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName));
  if (event.defaultPrevented || editing && event.code !== 'Escape' || event.code === 'Space' && event.target.tagName === 'BUTTON') return;
  const actions = { Space: () => audio.isPlaying ? pause() : play(), KeyR: () => seek(0, { resume: true }), KeyM: toggleMute,
    KeyH: () => toggleClean(), Escape: () => { toggleClean(false); togglePanel(true); } };
  if (actions[event.code]) { event.preventDefault(); Promise.resolve(actions[event.code]()).catch(report); }
});
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (event.dataTransfer?.files.length) { event.preventDefault(); if (!locked()) loadTrack(event.dataTransfer.files[0]).catch(report); } });

function animate(now) {
  if (disposed) return;
  raf = requestAnimationFrame(animate);
  if (!busy && !capture.isExporting) {
    const time = audio.isPlaying ? audio.getPlaybackPosition() : position, frameIndex = Math.floor(time * 60);
    if (dirty || audio.isPlaying && frameIndex !== lastFrameIndex) {
      if (!recorder.isRecording || !capture.shouldSkipRecordingFrame(now, true)) {
        renderAtPosition(audio.isPlaying ? frameIndex / 60 : time); lastFrameIndex = frameIndex; fpsFrames++;
        if (recorder.isRecording) capture.requestRecordingFrame(now);
      }
    }
  }
  if (now - fpsStarted >= 1000) {
    latestFps = Math.round(fpsFrames * 1000 / (now - fpsStarted)); fpsFrames = 0; fpsStarted = now;
    $('fps').textContent = audio.isPlaying ? `${latestFps} fps` : '60 fps export';
  }
}

const api = Object.freeze({
  loadReference, loadFile: file => loadTrack(file, { autoplay: false }), play, pause, seek, unload, setView, toggleClean, recordClip,
  async renderAt(seconds) { return await seek(seconds, { resume: false }) ? api.getState() : null; },
  exportClip: ({ start = position, duration = 2, writable = null } = {}) => exportVideo({ start, duration, writable, clip: true }),
  getState: () => ({ ready: audio.hasAudio, busy, playing: audio.isPlaying, paused: audio.isPaused, muted: audio.isMuted,
    position, duration: audio.duration, finished, recording: recorder.isRecording, exporting: capture.isExporting,
    fileName: audio.fileName, fps: latestFps, settings: { ...settings }, view,
    viewport: { ...viewport, canvasWidth: scene.canvas.width, canvasHeight: scene.canvas.height },
    quality: { fftSize: 32768, frequencyBins: 16384, columns: 16384, exportWidth: 1920, exportHeight: 1080, exportFps: 60, exportScale: 2 },
    features: lastFrame?.features, phase: $('phaseLabel').textContent, shapeFrom: lastFrame?.shapeFrom, shapeTo: lastFrame?.shapeTo, morph: lastFrame?.morph, sections: analysis.sections,
    scene: scene.getInfo(), analysis: analysis.getInfo?.(), error: lastError }),
});
window.phaseLoom = api;
window.phaseScope = api;
if (new URLSearchParams(location.search).has('review')) {
  $('reviewTools').hidden = false;
  let releaseReviewVideo = () => {};
  window.addEventListener('pagehide', () => releaseReviewVideo());
  function showReviewVideo(blob, filename) {
    releaseReviewVideo();
    if (reviewURL) URL.revokeObjectURL(reviewURL);
    reviewURL = URL.createObjectURL(blob);
    const video = document.createElement('video'); video.id = 'reviewVideo'; video.playsInline = true; video.preload = 'auto';
    const videoStatus = document.createElement('pre'); videoStatus.id = 'reviewVideoStatus'; videoStatus.setAttribute('aria-label', 'Preview playback diagnostics');
    const playPreview = document.createElement('button'); playPreview.id = 'reviewVideoPlayBtn'; playPreview.className = 'action glass'; playPreview.textContent = 'Play preview';
    const pausePreview = document.createElement('button'); pausePreview.id = 'reviewVideoPauseBtn'; pausePreview.className = 'action glass'; pausePreview.textContent = 'Pause preview';
    let frameCallbacks = 0, presentedFrames = 0, frameCallbackId = null, playError = null;
    function updateVideoStatus() {
      videoStatus.textContent = JSON.stringify({ width: video.videoWidth, height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : null, currentTime: video.currentTime,
        readyState: video.readyState, networkState: video.networkState, paused: video.paused, ended: video.ended,
        frameCallbacks, presentedFrames, decodedFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
        droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
        error: playError || (video.error ? { code: video.error.code, message: video.error.message } : null) }, null, 2);
      playPreview.disabled = !video.paused && !video.ended; pausePreview.disabled = video.paused;
    }
    function observeFrame(_now, metadata) {
      frameCallbackId = null; frameCallbacks++; presentedFrames = metadata.presentedFrames; updateVideoStatus();
      if (!video.paused && !video.ended) frameCallbackId = video.requestVideoFrameCallback(observeFrame);
    }
    function stopFrameObserver() {
      if (frameCallbackId !== null) video.cancelVideoFrameCallback?.(frameCallbackId);
      frameCallbackId = null;
    }
    playPreview.onclick = async () => {
      playError = null;
      if (video.ended) video.currentTime = 0;
      try { await video.play(); } catch (error) { playError = error.message; }
      updateVideoStatus();
    };
    pausePreview.onclick = () => { video.pause(); updateVideoStatus(); };
    video.addEventListener('playing', () => {
      if (video.requestVideoFrameCallback && frameCallbackId === null) frameCallbackId = video.requestVideoFrameCallback(observeFrame);
      updateVideoStatus();
    });
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'timeupdate', 'error', 'ended', 'pause']) video.addEventListener(event, () => {
      if (video.paused || video.ended) stopFrameObserver();
      updateVideoStatus();
    });
    releaseReviewVideo = () => { stopFrameObserver(); video.pause(); video.removeAttribute('src'); video.load(); };
    const link = document.createElement('a'); link.href = reviewURL; link.download = filename; link.textContent = 'Save review video';
    const close = document.createElement('button'); close.className = 'action glass'; close.textContent = 'Close review'; close.onclick = () => { video.pause(); $('reviewOutput').hidden = true; };
    $('reviewOutput').replaceChildren(close, playPreview, pausePreview, video, link, videoStatus); $('reviewOutput').hidden = false;
    video.src = reviewURL; updateVideoStatus();
  }
  bind('reviewStateBtn', 'click', () => { $('reviewStatus').textContent = JSON.stringify(api.getState(), null, 2); });
  bind('reviewClipBtn', 'click', async () => {
    if (locked() || !audio.hasAudio) return;
    await pause();
    const chunks = []; let length = 0, closed = false;
    const result = await api.exportClip({ duration: 2, writable: {
      async write(value) { const bytes = value.data || value, at = value.position ?? length; chunks.push({ at, bytes: new Uint8Array(bytes).slice() }); length = Math.max(length, at + bytes.byteLength); },
      async close() { closed = true; }, async abort() { chunks.length = 0; },
    } });
    $('reviewStatus').textContent = JSON.stringify({ ...result, bytes: length, closed }, null, 2);
    if (!result.ok) return;
    const bytes = new Uint8Array(length); for (const chunk of chunks) bytes.set(chunk.bytes, chunk.at);
    showReviewVideo(new Blob([bytes], { type: 'video/mp4' }), 'phase-scope-review.mp4');
  });
  bind('reviewRecordBtn', 'click', async () => {
    if (locked() || !audio.hasAudio) return;
    await pause();
    const before = api.getState(), chunks = []; let closed = false;
    const result = await recordClip({ writable: { async write(chunk) { chunks.push(chunk); }, async close() { closed = true; } } });
    const blob = new Blob(chunks, { type: result.mimeType }), after = api.getState();
    const checks = { wroteVideo: blob.size > 1000, closed, stopped: !after.recording, positionRestored: before.position === after.position,
      viewportRestored: before.viewport.canvasWidth === after.viewport.canvasWidth && before.viewport.canvasHeight === after.viewport.canvasHeight, unlocked: !after.busy, remainedPaused: !after.playing };
    $('reviewStatus').textContent = JSON.stringify({ passed: Object.values(checks).every(Boolean), bytes: blob.size, checks }, null, 2);
    showReviewVideo(blob, `phase-scope-recording.${result.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  });
}
const resizeObserver = new ResizeObserver(resizePreview); resizeObserver.observe($('stage'));
window.addEventListener('resize', resizePreview);
window.addEventListener('pagehide', () => {
  disposed = true; cancelAnimationFrame(raf); resizeObserver.disconnect(); audio.stop();
  if (recorder.isRecording) recorder.stop();
  analysis.dispose?.(); scene.dispose(); audio.context?.close().catch(() => {});
  if (reviewURL) URL.revokeObjectURL(reviewURL);
});
resizePreview(); scene.setView(view); renderAtPosition(0); updateButtons(); raf = requestAnimationFrame(animate);

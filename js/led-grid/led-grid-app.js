import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { createLEDAnalysis } from './led-analysis.js';
import { createLEDGridScene } from './led-grid-scene.js';
import { createRecordingDestination } from './led-recording.js';

const $ = id => document.getElementById(id);
const FPS = 60;
const MODES = ['loom', 'calligraphy', 'choreography'];
const settings = { mode: 'loom', gain: 1.3, persistence: 1, glow: .65,
  violet: '#7446FF', blue: '#2F5BFF', amber: '#FFA53D', white: '#FFF1D0', motion: false };
// Device defaults can be 16 kHz (for example a headset communication mode).
// Decode at a full-bandwidth rate supported by the AAC movie encoder.
const audio = createAudioPlayback({ fftSize: 32768, maxFftSize: 32768, smoothing: 0, sampleRate: 48000 });
let analysis = createLEDAnalysis();
let scene;
const errors = [];
function reportError(error) {
  if (error?.name === 'AbortError') return;
  const message = error?.message || String(error);
  errors.push(message);
  console.error(error);
  setStatus(message, false);
}
try { scene = createLEDGridScene($('stage'), settings); }
catch (error) { $('fatal').hidden = false; $('fatal').style.display = 'flex'; $('fatal').textContent = 'LED Grid needs WebGL 2. ' + error.message; throw error; }

let busy = '', generation = 0, position = 0, finished = false, disposed = false;
let viewport = { width: 1920, height: 1080, pixelRatio: 2 };
let fetchController = null, cancelRequested = false, currentData = null, dataFrame = -1;
let raf = 0, latestFps = 0, fpsStart = performance.now(), fpsCount = 0;
let recordingStopWaiter = null;
let bufferSerial = 0;
let resizePending = false, recordingSource = false, recordingDestination = null;
const recordingCanvas = document.createElement('canvas');
recordingCanvas.width = 1920; recordingCanvas.height = 1080;
const recordingContext = recordingCanvas.getContext('2d', { alpha: false });
recordingContext.imageSmoothingQuality = 'high';
const empty = { time: 0, frame: 0, bands: new Float32Array(96), history: new Float32Array(96 * 54),
  features: { bass: 0, mids: 0, highs: 0, energy: 0, rms: 0, balance: 0, width: 0, onsets: new Float32Array(3) }, events: [] };

function setStatus(message, live = audio.isPlaying) {
  $('statusText').textContent = message;
  $('statusLight').classList.toggle('live', Boolean(live));
  $('stage').setAttribute('aria-busy', String(Boolean(busy)));
}
function clock(time) { return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`; }
function timeline() {
  $('currentTime').textContent = clock(position);
  $('durationText').textContent = clock(audio.duration);
  if (document.activeElement !== $('seek')) $('seek').value = audio.duration ? position / audio.duration * 1000 : 0;
  if (document.activeElement !== $('seekSeconds')) $('seekSeconds').value = position.toFixed(3);
  $('seekSeconds').max = audio.duration;
}
function updateButtons() {
  const locked = Boolean(busy || recorder.isRecording), ready = audio.hasAudio && !locked;
  for (const id of ['playPauseBtn', 'replayBtn', 'unloadBtn', 'seek', 'seekSeconds', 'seekBtn']) $(id).disabled = !ready;
  for (const id of ['fileInput', 'referenceBtn', 'welcomeFile', 'welcomeReference']) $(id).disabled = locked;
  for (const input of document.querySelectorAll('#panel input:not(#fileInput):not(#seekSeconds), #resetCameraBtn, #modeSelect, [data-mode], [data-view]')) input.disabled = locked;
  $('playPauseBtn').innerHTML = audio.isPlaying ? 'Ⅱ <span class="action-label">Pause</span>' : '▶ <span class="action-label">Play</span>';
  $('playPauseBtn').setAttribute('aria-label', audio.isPlaying ? 'Pause' : 'Play');
  $('recordBtn').disabled = recorder.isRecording ? busy === 'saving' : Boolean(busy) || !audio.hasAudio || !globalThis.MediaRecorder;
  $('recordBtn').querySelector('.action-label').textContent = recorder.isRecording ? 'Stop' : 'Record';
  $('recordBtn').setAttribute('aria-label', recorder.isRecording ? 'Stop recording' : 'Record');
  const canExport = globalThis.VideoEncoder && globalThis.AudioEncoder && globalThis.showSaveFilePicker;
  $('exportBtn').disabled = !ready || !canExport;
  $('exportBtn').title = canExport ? '1080p · 60 fps · rendered at 4K' : 'MP4 export requires Chromium with WebCodecs and the file save picker';
  $('cancelLoadBtn').hidden = !['loading', 'fetching', 'cancelling'].includes(busy) && !(busy === 'buffering' && !recorder.isRecording);
  $('cancelLoadBtn').textContent = busy === 'buffering' ? 'Pause' : 'Cancel';
  $('cancelLoadBtn').disabled = cancelRequested;
  $('welcome').hidden = audio.hasAudio || Boolean(busy);
}

function resize(width, height, pixelRatio) {
  viewport = { width: Math.max(1, width), height: Math.max(1, height), pixelRatio: Math.max(1, pixelRatio) };
  scene.resize(viewport.width, viewport.height, viewport.pixelRatio);
}
function resizePreview() {
  if (capture.isExporting || recorder.isRecording || busy) { resizePending = true; return; }
  resizePending = false;
  // A fixed 16:9 composition is letterboxed rather than cropped in any window.
  const width = Math.min(innerWidth, innerHeight * 16 / 9), height = width * 9 / 16;
  resize(width, height, Math.max(devicePixelRatio || 1, 3840 / width));
  scene.canvas.style.width = `${width}px`;
  scene.canvas.style.height = `${height}px`;
  renderPosition(position);
}
function renderPosition(time, force = false) {
  position = Math.max(0, Math.min(audio.duration || 0, time));
  const frame = Math.floor(position * FPS + 1e-7);
  if (audio.hasAudio && analysis.isReady(position) && (force || frame !== dataFrame)) {
    currentData = analysis.getFrame(position);
    dataFrame = frame;
  }
  scene.render(currentData || empty);
  if (recordingSource) recordingContext.drawImage(scene.canvas, 0, 0, 1920, 1080);
  timeline();
}
function makeRecordingStream() {
  recordingSource = true;
  return capture.makeRecordingStream();
}
function restoreRecordingViewport() {
  recordingSource = false;
  capture.onRecordingStopped();
  if (resizePending && !busy) resizePreview();
  renderPosition(position, true);
}

const capture = createCaptureSession({
  width: 1920, height: 1080, fps: FPS,
  getCanvas: () => recordingSource ? recordingCanvas : scene.canvas, getAudioTrack: () => audio.getRecordingAudioTrack(),
  saveViewport: () => ({ ...viewport }),
  applyViewport: (width, height) => resize(width, height, 2),
  applyRecordingViewport: (width, height) => resize(width, height, 2),
  restoreViewport: saved => resize(saved.width, saved.height, saved.pixelRatio),
  overlay: { root: $('exportOverlay'), status: $('exportStatus'), progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn') },
});
const recorder = globalThis.createRecorder({
  defaultFilename: 'led-grid', videoBitsPerSecond: 40_000_000, onStatus: setStatus,
  onStart() { $('recordBtn').classList.add('recording'); updateButtons(); renderPosition(position); },
  onStop() {
    bufferSerial++;
    recorder.stop(); // Also clear shared state when the encoder stops itself.
    busy = ''; restoreRecordingViewport(); $('recordBtn').classList.remove('recording');
    if (recordingDestination?.error) reportError(recordingDestination.error);
    recordingDestination = null;
    const resolve = recordingStopWaiter; recordingStopWaiter = null; resolve?.(); updateButtons();
  },
});

function ended() {
  finished = true; position = audio.duration;
  if (recorder.isRecording) { busy = 'saving'; recorder.stop(); }
  renderPosition(position, true); setStatus('Track complete · replay to begin again', false); updateButtons();
}
function resetFrameRate() { fpsStart = performance.now(); fpsCount = 0; }
async function play() {
  if (!audio.hasAudio || busy || recorder.isRecording) return false;
  const serial = ++bufferSerial;
  if (finished) { finished = false; position = 0; }
  await prepareFrame(position);
  if (serial !== bufferSerial) return false;
  analysis.prefetch(position);
  await audio.resumeContext(); audio.seek(position); resetFrameRate(); audio.play({ fromStart: false, onEnded: ended });
  setStatus(audio.fileName, true); updateButtons(); return true;
}
async function pause() {
  if (!audio.hasAudio || busy || recorder.isRecording) return false;
  await audio.pause(); if (!finished) position = audio.getPlaybackPosition();
  renderPosition(position); setStatus('Paused · ' + audio.fileName, false); updateButtons(); return true;
}
async function seek(time, { resume = audio.isPlaying } = {}) {
  if (!audio.hasAudio || busy || recorder.isRecording) return false;
  if (!Number.isFinite(Number(time))) throw new RangeError('Track position must be finite.');
  const serial = ++bufferSerial;
  await audio.pause(); position = Math.max(0, Math.min(audio.duration, Number(time)));
  await prepareFrame(position);
  if (serial !== bufferSerial) return false;
  finished = position >= audio.duration; audio.seek(position); renderPosition(position, true);
  if (resume && !finished) await play(); else { setStatus('Paused · ' + audio.fileName, false); updateButtons(); }
  return true;
}
async function prepareFrame(time) {
  if (analysis.isReady(time)) return;
  const serial = bufferSerial;
  busy = 'buffering'; updateButtons(); setStatus('Preparing this passage…', false);
  try { await analysis.ensureRange(Math.max(0, time - 6), time + .5); }
  finally { if (serial === bufferSerial && busy === 'buffering') busy = ''; if (resizePending && !busy) resizePreview(); updateButtons(); }
}
async function bufferPlayback() {
  const token = generation, serial = ++bufferSerial, wasRecording = recorder.isRecording;
  if (wasRecording) recorder.pause();
  await audio.pause(); position = audio.getPlaybackPosition();
  try { await prepareFrame(position); }
  catch (error) { if (wasRecording) recorder.stop(); throw error; }
  if (serial !== bufferSerial || token !== generation || disposed || !audio.hasAudio || (wasRecording && !recorder.isRecording)) return;
  renderPosition(position, true); analysis.prefetch(position);
  if (wasRecording) recorder.resume();
  audio.seek(position); resetFrameRate(); audio.play({ fromStart: false, onEnded: ended });
  setStatus(audio.fileName, true); updateButtons();
}
async function loadTrack(file, { autoplay = true } = {}) {
  if (busy || recorder.isRecording) return false;
  const token = ++generation; cancelRequested = false; busy = 'loading'; finished = false;
  currentData = null; dataFrame = -1; updateButtons(); setStatus('Decoding audio…', false);
  try {
    const buffer = await audio.load(file);
    if (token !== generation || cancelRequested) throw new DOMException('Loading cancelled', 'AbortError');
    await analysis.load(buffer, { onProgress(progress) {
      if (token === generation && !cancelRequested) setStatus(`Preparing first second · ${Math.round(progress * 100)}%`, false);
    } });
    if (token !== generation || cancelRequested) throw new DOMException('Loading cancelled', 'AbortError');
    position = 0; renderPosition(0, true);
    setStatus('Ready · ' + audio.fileName, false);
  } catch (error) {
    audio.unload(); analysis.dispose(); analysis = createLEDAnalysis(); currentData = null; dataFrame = -1; position = 0;
    renderPosition(0);
    if (error.name === 'AbortError') setStatus('Loading cancelled', false); else reportError(error);
    return false;
  } finally { busy = ''; cancelRequested = false; if (resizePending) resizePreview(); updateButtons(); }
  if (autoplay) await play();
  return true;
}
async function loadReference({ autoplay = false } = {}) {
  if (busy || recorder.isRecording) return false;
  const wasPlaying = audio.isPlaying;
  await audio.resumeContext(); await audio.pause();
  if (!finished) position = audio.getPlaybackPosition();
  busy = 'fetching'; cancelRequested = false; fetchController = new AbortController();
  setStatus('Loading reference track…', false); updateButtons();
  let file;
  try {
    const response = await fetch('./reference.mp3', { signal: fetchController.signal });
    if (!response.ok) throw new Error(`Could not load reference.mp3 (${response.status}).`);
    file = new File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' });
  } catch (error) { if (error.name === 'AbortError') setStatus('Loading cancelled', false); else reportError(error); }
  finally { fetchController = null; busy = ''; cancelRequested = false; updateButtons(); }
  if (file) return loadTrack(file, { autoplay });
  renderPosition(position, true);
  if (wasPlaying) await play();
  if (resizePending) resizePreview();
  return false;
}
function cancelLoad() {
  if (busy === 'buffering') {
    bufferSerial++;
    if (recorder.isRecording) { busy = 'saving'; recorder.stop(); }
    else { busy = ''; setStatus('Paused · ' + audio.fileName, false); }
    updateButtons(); return;
  }
  if (!['loading', 'fetching'].includes(busy)) return;
  cancelRequested = true; generation++; fetchController?.abort();
  if (busy === 'loading') analysis.cancelLoad();
  busy = 'cancelling';
  setStatus('Cancelling analysis…', false); updateButtons();
}
function unload() {
  if (busy || recorder.isRecording) return;
  generation++; audio.unload(); analysis.dispose(); analysis = createLEDAnalysis();
  currentData = null; dataFrame = -1; position = 0; finished = false;
  renderPosition(0); updateButtons(); setStatus('Choose audio or play the reference track', false);
}

function setMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError('Unknown LED mode');
  if (busy || recorder.isRecording) return false;
  settings.mode = mode;
  $('perspectiveControls').hidden = mode !== 'loom';
  $('cameraHint').textContent = mode !== 'loom' ? 'Flat 2D view · scroll to zoom' : 'Drag to orbit · scroll to zoom';
  $('resetCameraBtn').textContent = mode !== 'loom' ? 'Reset zoom' : 'Reset camera';
  $('modeSelect').value = mode;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === scene.getInfo().view)));
  renderPosition(position); return true;
}
function setView(view) {
  if (!['front', 'left', 'right'].includes(view)) throw new RangeError('Unknown camera view');
  if (busy || recorder.isRecording) return false;
  scene.setView(view);
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === scene.getInfo().view)));
  renderPosition(position); return true;
}
function setSettings(values) {
  if (busy || recorder.isRecording) return false;
  for (const [key, value] of Object.entries(values)) {
    if (key === 'mode') { setMode(value); continue; }
    if (key === 'motion') settings.motion = Boolean(value);
    else if (['violet', 'blue', 'amber', 'white'].includes(key)) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new RangeError('A six-digit hex colour is required');
      settings[key] = value;
    } else if (['gain', 'persistence', 'glow'].includes(key)) {
      const input = $(key), number = Number(value);
      if (!Number.isFinite(number)) throw new RangeError('Control value must be finite');
      settings[key] = Math.min(Number(input.max), Math.max(Number(input.min), number));
    }
    if ($(key)) { if (key === 'motion') $(key).checked = settings[key]; else $(key).value = settings[key]; }
    if ($(key + 'Value')) $(key + 'Value').textContent = settings[key].toFixed(2);
  }
  renderPosition(position); return true;
}

function sliceAudio(start, duration) {
  const source = audio.buffer, first = Math.floor(start * source.sampleRate);
  const length = Math.max(1, Math.min(source.length - first, Math.floor(duration * source.sampleRate)));
  const buffer = audio.context.createBuffer(source.numberOfChannels, length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) buffer.copyToChannel(source.getChannelData(c).subarray(first, first + length), c);
  return { buffer, start: first / source.sampleRate };
}
async function exportVideo({ start = 0, duration = audio.duration, writable = null, clip = false } = {}) {
  if (!audio.hasAudio || busy || recorder.isRecording) return { ok: false, reason: 'busy' };
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) throw new RangeError('Invalid export range');
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder) throw new Error('MP4 export needs Chromium with WebCodecs.');
  start = Math.max(0, Math.min(audio.duration - 1 / audio.buffer.sampleRate, start));
  duration = Math.min(duration, audio.duration - start);
  const wasPlaying = audio.isPlaying;
  await audio.pause();
  const saved = { time: finished ? position : audio.getPlaybackPosition(), finished, camera: scene.saveCamera(), settings: { ...settings } };
  busy = 'exporting'; updateButtons();
  const excerpt = clip ? sliceAudio(start, duration) : { buffer: audio.buffer, start: 0 };
  const exportAudio = { hasAudio: true, duration: excerpt.buffer.duration,
    suspendContext: () => audio.suspendContext(), resumeContext: () => audio.resumeContext(),
    getExportAudio: () => ({ ...audio.getExportAudio(), audioBuffer: excerpt.buffer }) };
  try {
    return await capture.runOfflineExport({ audio: exportAudio, suggestedName: `led-grid-${settings.mode}${clip ? '-excerpt' : ''}.mp4`, pendingWritable: writable,
      onStatus: setStatus, labels: { rendering: 'Rendering LED Grid at 4K…', saved: 'MP4 saved · 1920 × 1080 · 60 fps' },
      prepare: () => saved,
      async analysisProvider(index) {
        const time = excerpt.start + index / FPS;
        if (!analysis.isReady(time)) await analysis.ensureRange(Math.max(0, time - 6), time + .5);
        return analysis.getFrame(time);
      },
      renderFrame(_spectrum, _delta, data) { scene.render(data); },
      readCanvas: () => scene.canvas, gpuFinish: () => scene.canvas.getContext('webgl2')?.finish(),
      restore() { Object.assign(settings, saved.settings); scene.restoreCamera(saved.camera); audio.seek(saved.time); position = saved.time; finished = saved.finished; dataFrame = -1; renderPosition(position, true); },
    });
  } finally {
    busy = ''; Object.assign(settings, saved.settings); scene.restoreCamera(saved.camera);
    position = saved.time; finished = saved.finished; audio.seek(position); renderPosition(position, true);
    if (resizePending) resizePreview();
    if (wasPlaying && !finished) await play(); updateButtons();
  }
}
async function toggleRecording() {
  if (recorder.isRecording) { busy = 'saving'; recorder.stop(); updateButtons(); return; }
  if (!audio.hasAudio || busy) return;
  const saved = { time: position, finished, playing: audio.isPlaying };
  await audio.pause();
  saved.time = finished ? position : audio.getPlaybackPosition();
  position = saved.time; busy = 'recording-setup'; updateButtons();
  let started = false;
  try {
    const prepared = await recorder.prepareAutoRecord();
    if (!prepared) return;
    if (prepared.writable) prepared.writable = recordingDestination = createRecordingDestination(prepared.writable);
    if (finished) { position = 0; finished = false; }
    await analysis.ensureRange(Math.max(0, position - 6), position + 2);
    await audio.resumeContext(); audio.seek(position);
    recorder.startAutoRecord(prepared, makeRecordingStream); started = recorder.isRecording;
    if (started) { resetFrameRate(); audio.play({ fromStart: false, onEnded: ended }); }
    setStatus('Recording · ' + audio.fileName, true);
  } finally {
    busy = '';
    if (!started) {
      await recordingDestination?.abort(); recordingDestination = null;
      await audio.pause(); restoreRecordingViewport(); position = saved.time; finished = saved.finished;
      audio.seek(position); renderPosition(position, true); if (saved.playing) await play();
    }
    updateButtons();
  }
}
async function recordClip({ duration = 1, writable } = {}) {
  if (!audio.hasAudio || busy || recorder.isRecording) return { ok: false, reason: 'busy' };
  if (!(duration > 0 && duration <= 8) || !writable?.write) throw new RangeError('A writable destination and 0–8 second duration are required.');
  const saved = { time: position, finished, playing: audio.isPlaying };
  await audio.pause(); busy = 'recording-setup'; updateButtons();
  let timer;
  const stopped = new Promise(resolve => { recordingStopWaiter = resolve; });
  const destination = createRecordingDestination(writable);
  try {
    if (finished) { position = 0; finished = false; }
    await analysis.ensureRange(Math.max(0, position - 6), position + duration + .5);
    audio.seek(position); await audio.resumeContext();
    recorder.begin(makeRecordingStream(), destination, recorder.getCodec());
    resetFrameRate(); audio.play({ fromStart: false, onEnded: ended }); busy = ''; updateButtons();
    timer = setTimeout(() => { busy = 'saving'; recorder.stop(); updateButtons(); }, Math.min(duration, audio.duration - position) * 1000);
    await stopped; if (destination.error) throw destination.error;
    return { ok: true };
  } finally {
    clearTimeout(timer); if (recorder.isRecording) { recorder.stop(); await stopped; }
    await destination.abort(); recordingStopWaiter = null;
    await audio.pause(); busy = ''; restoreRecordingViewport(); position = saved.time; finished = saved.finished;
    audio.seek(position); renderPosition(position, true); if (saved.playing) await play(); updateButtons();
  }
}

function togglePanel() { const hidden = $('panel').classList.toggle('hidden'); $('panel').inert = hidden; $('panelToggle').setAttribute('aria-expanded', String(!hidden)); $('panelToggle').setAttribute('aria-label', hidden ? 'Show settings' : 'Hide settings'); }
function toggleClean() { document.body.classList.toggle('clean'); }
function action(fn) { return event => { Promise.resolve().then(() => fn(event)).catch(reportError); }; }
$('panelToggle').onclick = togglePanel;
$('welcomeFile').onclick = () => $('fileInput').click();
document.querySelector('.file-picker').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('fileInput').click(); } };
$('fileInput').onchange = action(event => { const file = event.target.files[0]; event.target.value = ''; return file && loadTrack(file); });
for (const id of ['referenceBtn', 'welcomeReference']) $(id).onclick = action(() => loadReference({ autoplay: true }));
$('cancelLoadBtn').onclick = cancelLoad;
$('playPauseBtn').onclick = action(() => audio.isPlaying ? pause() : play());
$('replayBtn').onclick = action(() => seek(0, { resume: true }));
$('unloadBtn').onclick = unload;
$('muteBtn').onclick = () => { const muted = audio.toggleMute(); $('muteBtn').setAttribute('aria-pressed', String(muted)); $('muteBtn').querySelector('.action-label').textContent = muted ? 'Unmute' : 'Mute'; };
$('seek').oninput = action(event => seek(Number(event.target.value) / 1000 * audio.duration));
$('seekBtn').onclick = action(() => seek(Number($('seekSeconds').value)));
$('seekSeconds').onkeydown = action(event => event.key === 'Enter' && seek(Number(event.target.value)));
$('recordBtn').onclick = action(toggleRecording);
$('exportBtn').onclick = action(() => exportVideo());
$('cleanBtn').onclick = toggleClean;
$('fullscreenBtn').onclick = action(() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
$('resetCameraBtn').onclick = () => setView('front');
document.querySelectorAll('[data-mode]').forEach(button => { button.onclick = () => setMode(button.dataset.mode); });
$('modeSelect').onchange = event => setMode(event.target.value);
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => setView(button.dataset.view); });
for (const key of ['gain', 'persistence', 'glow', 'violet', 'blue', 'amber', 'white', 'motion']) $(key).oninput = () => setSettings({ [key]: key === 'motion' ? $(key).checked : $(key).value });
document.addEventListener('keydown', action(event => {
  if (event.defaultPrevented || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.code === 'Space') { event.preventDefault(); return audio.isPlaying ? pause() : play(); }
  if (event.key.toLowerCase() === 'h') { event.preventDefault(); toggleClean(); }
  if (event.key.toLowerCase() === 'r') return seek(0, { resume: true });
  if (event.key.toLowerCase() === 'm') $('muteBtn').click();
  if (['1', '2', '3'].includes(event.key)) setMode(MODES[Number(event.key) - 1]);
}));
window.addEventListener('resize', resizePreview);
window.addEventListener('pagehide', () => { disposed = true; cancelAnimationFrame(raf); fetchController?.abort(); analysis.dispose(); audio.stop(); audio.context?.close(); scene.dispose(); });
function animate(now) {
  if (disposed) return;
  raf = requestAnimationFrame(animate);
  if (capture.isExporting || busy || !audio.isPlaying) return;
  const audioTime = audio.getPlaybackPosition();
  analysis.prefetch(audioTime);
  if (!analysis.isReady(audioTime)) { bufferPlayback().catch(reportError); return; }
  if (Math.floor(audioTime * FPS + 1e-7) === dataFrame) return;
  try {
    position = audioTime;
    renderPosition(position);
    if (recorder.isRecording) capture.requestRecordingFrame(now);
    fpsCount++;
    if (now - fpsStart >= 1000) { latestFps = fpsCount * 1000 / (now - fpsStart); $('fps').textContent = `${Math.round(latestFps)} fps`; fpsCount = 0; fpsStart = now; }
  } catch (error) { reportError(error); disposed = true; cancelAnimationFrame(raf); }
}
resizePreview(); updateButtons(); renderPosition(0); raf = requestAnimationFrame(animate);

if (new URLSearchParams(location.search).has('review')) {
  window.ledGrid = {
    loadReference, loadTrack, play, pause, unload, cancelLoad, setMode, setView, setSettings,
    async renderAt(time) { await seek(time, { resume: false }); renderPosition(position, true); return this.getState(); },
    getState() { return { position, playing: audio.isPlaying, busy, finished, recording: recorder.isRecording, exporting: capture.isExporting,
      mode: settings.mode, settings: { ...settings }, analysis: analysis.getInfo(), scene: scene.getInfo(),
      viewport: { ...viewport, canvasWidth: scene.canvas.width, canvasHeight: scene.canvas.height }, fps: latestFps, errors: [...errors] }; },
    getPassages: () => analysis.getReviewPassages(),
    async reviewFrame(time) { await analysis.ensureRange(Math.max(0, time - 6), time + .5); const data = analysis.getFrame(time); scene.render(data); dataFrame = -1;
      return { time: data.time, frame: data.frame, features: { ...data.features, onsets: Array.from(data.features.onsets) }, bands: Array.from(data.bands), events: data.events, scene: scene.getInfo() }; },
    exportClip: options => exportVideo({ ...options, clip: true }), recordClip,
    cancelExport: () => $('exportCancelBtn').click(),
    capturePNG: () => scene.canvas.toDataURL('image/png'),
    setViewport(width, height, pixelRatio = 2) { resize(width, height, Math.max(pixelRatio, 3840 / width, 2160 / height)); renderPosition(position, true); },
    restorePreview() { resizePreview(); renderPosition(position, true); },
  };
  await import('./led-grid-review.js');
}

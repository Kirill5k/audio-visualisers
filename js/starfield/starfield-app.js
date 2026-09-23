import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { createStarfieldAnalysis } from './starfield-analysis.js';
import { createDeepDrift } from './deep-drift-scene.js';
import { createLivingConstellations } from './living-constellations-scene.js';
import { createStarfieldSettings } from './starfield-settings.js';
import { RESPONSE_PRESETS, DEFAULT_RESPONSE_SETTINGS, createDeepDriftResponseTimeline, saveResponseTransition, restoreResponseTransition } from './deep-drift-response.js';
import { createDeepDriftClock } from './deep-drift-clock.js';

const living = document.body.dataset.visualiser === 'living-constellations';
const title = living ? 'Living Constellations' : 'Deep Drift';
const filename = living ? 'living_constellations' : 'deep_drift';
const $ = id => document.getElementById(id);
const settings = createStarfieldSettings();
if (!living) Object.assign(settings, DEFAULT_RESPONSE_SETTINGS);
let responsePreset = 'fluid';
const range = (id, label, min, max, step, value, suffix = '') => `<div class="control"><div class="control-head"><label for="${id}">${label}</label><output class="value" id="${id}Value" for="${id}">${value}${suffix}</output></div><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-suffix="${suffix}"></div>`;
const toggle = (id, label, checked = false) => `<label class="toggle-row"><span>${label}</span><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}></label>`;
document.body.insertAdjacentHTML('beforeend', `
  <button id="panelToggle" class="glass hud" aria-label="Hide settings" title="Hide settings">×</button>
  <aside id="panel" class="glass hud">
    <div class="brand"><div><div class="eyebrow">Audio reactive journey</div><h1>${title}</h1></div></div>
    <p class="tagline">${living ? 'Music draws connections in the dark.' : 'An endless passage through light.'}</p>
    <label class="file-picker" for="fileInput">Choose an audio file</label><input id="fileInput" type="file" accept="audio/*">
    <button id="referenceBtn" class="secondary-button">Play reference track</button>
    <section class="section"><div class="section-title">Journey</div>
      ${range('speed', 'Travel speed', 0, 2.5, .05, 1)}${range('drift', 'Camera drift', 0, 1, .05, .4)}
      <div class="view-grid" aria-label="Camera view"><button data-view="front" aria-pressed="true">Forward</button><button data-view="left" aria-pressed="false">Left</button><button data-view="right" aria-pressed="false">Right</button><button data-view="up" aria-pressed="false">Up</button></div>
      <button id="recenterBtn" class="secondary-button">Recenter camera</button>
    </section>
    <section class="section"><div class="section-title">Audio response</div>
      ${living ? `${range('gain', 'Response gain', .25, 3, .05, 1.25)}${range('pulse', 'Star flares', 0, 3, .05, 1.3)}
      <div class="quality-note">16,384 frequency bins · 32,768 FFT<br>Fast transient analysis · 2,048 FFT</div>` : `
      <div class="response-presets" role="group" aria-label="Response presets">${Object.entries(RESPONSE_PRESETS).map(([id, preset]) => `<button data-response-preset="${id}" aria-pressed="${id === 'fluid'}">${preset.label}</button>`).join('')}</div>
      <div class="response-caption"><span id="responseName">Fluid</span><button id="resetResponse" type="button">Reset response</button></div>
      ${range('gain', 'Sensitivity', .25, 3, .05, settings.gain)}
      ${range('smoothness', 'Smoothness', .25, 2, .05, settings.smoothness)}
      ${range('bassMotion', 'Bass motion', 0, 2, .05, settings.bassMotion)}
      ${range('midFlow', 'Midrange flow', 0, 2, .05, settings.midFlow)}
      ${range('trebleShimmer', 'Treble shimmer', 0, 2, .05, settings.trebleShimmer)}
      ${range('pulse', 'Accent strength', 0, 2, .05, settings.pulse)}
      <p class="quality-note">Bass opens the wisps. Mids shape the flow.<br>Treble catches the light.</p>`}
    </section>
    ${living ? '' : `<section class="section"><div class="section-title">Dust wisps</div>
      ${toggle('dustRivers', 'Enable dust wisps', true)}
      ${range('dustDensity', 'Dust density', .1, 1, .05, settings.dustDensity)}
      ${range('dustBrightness', 'Dust light', .1, 2, .05, settings.dustBrightness)}
      ${range('dustWidth', 'Wisp width', .25, 2, .05, settings.dustWidth)}
      ${range('dustFlow', 'Flow speed', 0, 2, .05, settings.dustFlow)}
      ${range('dustResponse', 'Wisp response', 0, 3, .05, settings.dustResponse)}
    </section>
    <section class="section"><div class="section-title">Nebula wavefronts</div>
      ${toggle('wavefronts', 'Enable wavefronts', true)}
      ${range('waveStrength', 'Wave light', 0, 2.5, .05, settings.waveStrength)}
      ${range('waveSpeed', 'Wave speed', .25, 2, .05, settings.waveSpeed)}
      ${range('waveWidth', 'Wave width', .35, 2, .05, settings.waveWidth)}
    </section>
    <section class="section"><div class="section-title">Nebula breathing</div>
      ${toggle('nebulaBreathing', 'Enable breathing', true)}
      ${range('breathDepth', 'Breathing depth', 0, 2, .05, settings.breathDepth)}
      ${range('breathSpeed', 'Breathing speed', .25, 2, .05, settings.breathSpeed)}
      ${range('breathResponse', 'Breathing response', 0, 3, .05, settings.breathResponse)}
    </section>`}
    <section class="section"><div class="section-title">${living ? 'Stars & connections' : 'Starlight'}</div>
      ${range('density', 'Star density', .15, 1, .05, 1)}${range('brightness', 'Brightness', .3, 2, .05, 1)}${range('starSize', 'Star size', .5, 2, .05, 1)}${range('nebula', 'Nebula light', 0, 2, .05, 1)}
      ${living ? range('linkLife', 'Connection linger', .3, 2, .05, 1.2, 's') + range('linkReach', 'Connection reach', .5, 1.8, .05, 1) + range('connectionStrength', 'Connection light', .2, 2, .05, 1) : ''}
      <label class="color-row"><span>Nebula colour</span><input id="colorLow" type="color" value="#527fa7"></label>
      <label class="color-row"><span>Starlight colour</span><input id="colorHigh" type="color" value="#e5efff"></label>
      ${living ? '<label class="color-row"><span>Connection colour</span><input id="connectionColor" type="color" value="#e8d2a0"></label>' : ''}
      ${toggle('bloom', 'Bloom', true)}
    </section>
    <section class="section"><div class="section-title">Capture</div>
      ${toggle('autoRecord', 'Record on load')}${toggle('autoExport', 'Export on load')}${toggle('lock60', 'Lock recording to 60 fps', true)}
      <div class="quality-note">1920 × 1080 · 60 fps<br>Offline export · 2× supersampling</div>
    </section>
    <section class="section"><label class="color-row"><span>Track position (seconds)</span><input id="seekSeconds" class="frequency-input" type="number" value="0" min="0" step=".1" disabled></label></section>
    <p class="shortcut-note">Drag to look · 1–4 camera views<br>Space play/pause · R replay · H hide all controls</p>
  </aside>
  <nav id="actions" class="hud">
    <button id="playPauseBtn" class="action glass" disabled>▶ <span class="action-label">Play</span></button>
    <button id="replayBtn" class="action glass" aria-label="Replay" disabled>↺ <span class="action-label">Replay</span></button>
    <button id="unloadBtn" class="action glass" aria-label="Unload" disabled>⊘ <span class="action-label">Unload</span></button>
    <button id="muteBtn" class="action glass" aria-label="Mute audio" aria-pressed="false">♫</button>
    <button id="recordBtn" class="action glass" aria-label="Record" disabled><span class="record-dot"></span><span class="action-label">Record</span></button>
    <button id="exportBtn" class="action glass" aria-label="Export" disabled>↓ <span class="action-label">Export</span></button>
    <button id="fullscreenBtn" class="action glass" aria-label="Fullscreen">⛶</button>
    <button id="hideUiBtn" class="action glass" title="Hide controls · H" aria-label="Hide all controls">◉</button>
  </nav>
  <div id="timeline" class="hud"><span class="time" id="elapsed">0:00</span><input id="seek" type="range" min="0" max="1" step=".001" value="0" disabled aria-label="Track position"><span class="time" id="duration">0:00</span></div>
  <div id="musicReadout" class="glass hud"><div id="spectrumMeter" aria-label="Music activity"></div><div id="sceneStats">131,072 stars<br>Native resolution</div></div>
  <div id="readout" class="glass hud"><span id="statusLight"></span><span id="statusText">Choose an audio file to begin</span><span id="fps">— fps</span></div>
  <div id="exportOverlay"><div class="export-card glass"><div id="exportStatus">Rendering the journey…</div><div class="progress"><div id="exportProgressBar"></div></div><div id="exportPercent">0%</div><button id="exportCancelBtn" class="action glass">Cancel export</button></div></div>
`);

const audio = createAudioPlayback({fftSize: 32768, maxFftSize: 32768, smoothing: 0});
const analysis = createStarfieldAnalysis(living ? {} : {prefetchFrames: 0});
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .05, 6500);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
} catch (error) {
  $('fatal').style.display = 'flex';
  throw error;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
$('stage').appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', `${title} interactive scene`);
const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples)});
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .25, .3, 1);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const spectrum = new Uint8Array(16384);
const spectrumTexture = new THREE.DataTexture(spectrum, 256, 64, THREE.RedFormat, THREE.UnsignedByteType);
spectrumTexture.minFilter = spectrumTexture.magFilter = THREE.NearestFilter;
spectrumTexture.generateMipmaps = false;
spectrumTexture.needsUpdate = true;
const world = (living ? createLivingConstellations : createDeepDrift)({scene, camera, spectrumTexture, settings});
const silent = () => ({levels: new Float32Array(32), onsets: new Float32Array(32), bass: 0, mids: 0, highs: 0, energy: 0, rms: 0, kick: 0});
let features = silent();
const scaled = silent();
const quietFeatures = silent();
let frame = -1, distance = 0, idleTime = 0, restTime = 0, busy = false, loading = false, seeking = false, generation = 0;
let seekEditing = false;
let pendingPump = null, pausedSnapshot = null, finished = false;
const presentationClock = createDeepDriftClock();
let responseTimeline = null, responseDirty = false, responseTransition = null;
let presentedTime = 0, presentedDistance = 0, driftLight = 1;
let displayFeatures = silent();
const responseKeys = Object.keys(DEFAULT_RESPONSE_SETTINGS);
function rebuildResponseTimeline(transition = false) {
  if (living || !analysis.getInfo().loaded || !audio.hasAudio) return;
  if (transition) responseTransition = {from: structuredClone(displayFeatures), start: performance.now()};
  responseTimeline = createDeepDriftResponseTimeline({
    frameCount: analysis.getInfo().frameCount,
    getFeatureFrame: index => analysis.getFeatureFrame(index), settings,
  });
  responseDirty = false;
}
function responseAt(time, preview = false) {
  const result = responseTimeline ? responseTimeline.sample(time) : silent();
  if (preview && responseTransition) {
    const mix = Math.min(1, Math.max(0, (performance.now() - responseTransition.start) / 450));
    const amount = mix * mix * (3 - 2 * mix), from = responseTransition.from;
    for (const key of ['bass', 'mids', 'highs', 'energy', 'kick', 'breath', 'accent'])
      result[key] = (from[key] || 0) * (1 - amount) + (result[key] || 0) * amount;
    for (const key of ['levels', 'onsets']) for (let i = 0; i < 32; i++)
      result[key][i] = (from[key]?.[i] || 0) * (1 - amount) + result[key][i] * amount;
    if (mix === 1) responseTransition = null;
  }
  return result;
}
function presentDrift(time, travel, light = driftLight, preview = true) {
  presentedTime = time; presentedDistance = travel;
  displayFeatures = responseAt(time, preview);
  setCamera(time);
  world.present({time, distance: travel, features: displayFeatures, light});
}

let viewYaw = 0, viewPitch = 0, currentView = 'front';
let viewport = {width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio || 1};
const meters = Array.from({length: 32}, () => {const bar = document.createElement('i'); $('spectrumMeter').append(bar); return bar;});
function setStatus(message, live = audio.isPlaying) {$('statusText').textContent = message; $('statusLight').classList.toggle('live', live);}
function clockText(time) {return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;}
function setCamera(time) {
  const drift = settings.drift;
  camera.position.set(Math.sin(time * .028) * 1.2 * drift, Math.sin(time * .021) * .8 * drift, 0);
  camera.rotation.set(viewPitch + Math.sin(time * .045) * .018 * drift, viewYaw + Math.sin(time * .031) * .028 * drift, Math.sin(time * .024) * .008 * drift, 'YXZ');
  camera.updateMatrixWorld();
}
function setView(name) {
  if (busy || recorder?.isRecording) return;
  currentView = name;
  viewYaw = name === 'left' ? THREE.MathUtils.degToRad(25) : name === 'right' ? THREE.MathUtils.degToRad(-25) : 0;
  viewPitch = name === 'up' ? THREE.MathUtils.degToRad(15) : 0;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  setCamera(audio.hasAudio ? Math.max(0, frame) / 60 : idleTime);
}
function resize(width, height, pixelRatio) {
  viewport = {width, height, pixelRatio};
  renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false); composer.setSize(width, height);
  camera.aspect = width / height; camera.updateProjectionMatrix();
  world.resize(width, height, pixelRatio);
}
resize(innerWidth, innerHeight, devicePixelRatio || 1);
function applyFeatures(input) {
  for (let i = 0; i < 32; i++) {scaled.levels[i] = Math.min(1, input.levels[i] * settings.gain); scaled.onsets[i] = Math.min(1, input.onsets[i] * settings.gain);}
  for (const key of ['bass', 'mids', 'highs', 'energy', 'kick']) scaled[key] = Math.min(1, (input[key] || 0) * settings.gain);
  scaled.rms = input.rms || 0;
  return scaled;
}
function step(data, upload = true) {
  frame = data.frame;
  features = data.features;
  if (upload && data.spectrum) {spectrum.set(data.spectrum); spectrumTexture.needsUpdate = true;}
  distance += settings.speed * 26 / 60;
  setCamera(frame / 60);
  world.update({time: frame / 60, delta: 1 / 60, distance, features: living ? applyFeatures(features) : responseAt(frame / 60), frame, playing: true});
}
function resetWorld(startFrame = 0, preserveFlow = false) {
  world.reset({preserveFlow}); presentationClock.reset(); frame = startFrame - 1; restTime = 0; distance = startFrame / 60 * settings.speed * 26;
  features = silent(); spectrum.fill(0); spectrumTexture.needsUpdate = true; pausedSnapshot = null;
  presentedTime = startFrame / 60; presentedDistance = distance; displayFeatures = silent(); driftLight = 1;
}
function saveWorld() {return {world: world.saveState(), frame, distance, features: structuredClone(features), spectrum: spectrum.slice(), viewYaw, viewPitch, currentView, idleTime, restTime, presentedTime, presentedDistance, driftLight, displayFeatures: structuredClone(displayFeatures), responseTransition: saveResponseTransition(responseTransition, performance.now())};}
function restoreWorld(saved, {restoreTransition = false} = {}) {
  if (!saved) return;
  world.restoreState(saved.world); frame = saved.frame; distance = saved.distance; features = saved.features; spectrum.set(saved.spectrum); spectrumTexture.needsUpdate = true;
  viewYaw = saved.viewYaw; viewPitch = saved.viewPitch; currentView = saved.currentView; idleTime = saved.idleTime; restTime = saved.restTime;
  presentedTime = saved.presentedTime ?? Math.max(0, frame) / 60; presentedDistance = saved.presentedDistance ?? distance;
  driftLight = saved.driftLight ?? 1; displayFeatures = saved.displayFeatures || silent();
  if (restoreTransition) responseTransition = restoreResponseTransition(saved.responseTransition, performance.now());
  presentationClock.reset();
  setCamera(living ? (audio.hasAudio ? Math.max(0, frame) / 60 : idleTime) : presentedTime);
}
function restorePausedWorld() {
  if (!pausedSnapshot) return;
  // Looking around while paused should not be undone when the music resumes.
  const light = driftLight;
  restoreWorld({...pausedSnapshot, viewYaw, viewPitch, currentView});
  driftLight = light;
  pausedSnapshot = null;
}
async function rebuild(position) {
  responseTransition = null;
  if (!living && responseDirty) rebuildResponseTimeline();
  const token = ++generation;
  seeking = true;
  const endFrame = Math.max(0, Math.min(analysis.getInfo().frameCount - 1, Math.floor(position * 60)));
  const startFrame = Math.max(0, endFrame - 480);
  resetWorld(startFrame, true);
  try {
    for (let f = startFrame; f < endFrame; f++) {
      if (token !== generation) return;
      const data = analysis.getFeatureFrame ? analysis.getFeatureFrame(f) : await analysis.getFrame(f);
      step(data, false);
    }
    const last = living ? await analysis.getFrame(endFrame) : analysis.getFeatureFrame(endFrame);
    if (token === generation) {step(last); if (!living) presentDrift(endFrame / 60, distance, 1, false);}
  } finally {if (token === generation) seeking = false;}
}
function pump(toFrame) {
  if (pendingPump || seeking || loading || busy) return;
  if (toFrame - frame > 120) {
    rebuild(audio.getPlaybackPosition()).catch(error => setStatus('Could not restore playback · ' + error.message));
    return;
  }
  if (!living) {
    const end = Math.min(toFrame, analysis.getInfo().frameCount - 1);
    for (let next = frame + 1; next <= end; next++) step(analysis.getFeatureFrame(next), false);
    return;
  }
  const token = generation;
  pendingPump = (async () => {
    const end = Math.min(toFrame, analysis.getInfo().frameCount - 1);
    for (let next = frame + 1; next <= end; next++) {
      const data = analysis.getCachedFrame(next) || await analysis.getFrame(next);
      if (next % 6 === 0) analysis.getFrame(next).catch(() => {});
      if (token !== generation || busy || seeking || !audio.isPlaying) return;
      step(data);
    }
  })().catch(error => {if (token !== generation || error.name === 'AbortError') return; setStatus('Analysis error · ' + error.message); audio.pause(); updateButtons();}).finally(() => {pendingPump = null;});
}
const capture = createCaptureSession({
  width: 1920, height: 1080, fps: 60,
  getCanvas: () => renderer.domElement, getAudioTrack: () => audio.getRecordingAudioTrack(),
  saveViewport: () => ({...viewport}),
  applyViewport: (w, h) => resize(w, h, 2),
  applyRecordingViewport: (w, h) => resize(w, h, 1),
  restoreViewport: state => resize(state.width, state.height, state.pixelRatio),
  overlay: {root: $('exportOverlay'), status: $('exportStatus'), progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn')},
});
const recorder = createRecorder({
  defaultFilename: filename, videoBitsPerSecond: 40_000_000, onStatus: setStatus,
  onStart() {$('recordBtn').classList.add('recording'); updateButtons();},
  onStop() {capture.onRecordingStopped(); $('recordBtn').classList.remove('recording'); updateButtons();},
});
function updateButtons() {
  const ready = audio.hasAudio && !loading && !seeking && !busy;
  $('playPauseBtn').disabled = !ready || recorder.isRecording;
  $('playPauseBtn').innerHTML = audio.isPlaying ? 'Ⅱ <span class="action-label">Pause</span>' : '▶ <span class="action-label">Play</span>';
  $('playPauseBtn').setAttribute('aria-label', audio.isPlaying ? 'Pause' : 'Play');
  for (const id of ['replayBtn', 'unloadBtn', 'seek', 'seekSeconds']) $(id).disabled = !ready || recorder.isRecording;
  $('recordBtn').disabled = !ready;
  $('recordBtn').setAttribute('aria-label', recorder.isRecording ? 'Stop recording' : 'Record');
  $('recordBtn').querySelector('.action-label').textContent = recorder.isRecording ? 'Stop' : 'Record';
  $('exportBtn').disabled = !ready || recorder.isRecording || !window.showSaveFilePicker || !window.VideoEncoder || !window.AudioEncoder;
  $('fileInput').disabled = loading || busy || recorder.isRecording;
  $('referenceBtn').disabled = loading || busy || recorder.isRecording;
  if (!window.VideoEncoder || !window.showSaveFilePicker) $('exportBtn').title = 'Offline export requires Chromium with WebCodecs';
  for (const input of document.querySelectorAll('#panel input:not(#fileInput), #panel button:not(#referenceBtn)')) {
    if (!['seekSeconds'].includes(input.id)) input.disabled = busy || recorder.isRecording;
  }
}
function startPlayback(prepared = null, fromStart = true) {
  finished = false; presentationClock.reset();
  audio.play({fromStart, onEnded: () => {finished = true; if (recorder.isRecording) recorder.stop(); setStatus('Track complete · replay to travel again', false); updateButtons();}});
  if (prepared) recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
  setStatus(audio.fileName); updateButtons();
}
async function loadTrack(file, {prepared = null, writable = null} = {}) {
  loading = true; generation++; updateButtons();
  try {
    if (audio.isPlaying) await audio.pause();
    setStatus('Decoding · ' + file.name, false);
    await audio.load(file);
    setStatus('Analysing the music…', false);
    await analysis.load(audio.buffer, {onProgress: value => setStatus('Analysing the music · ' + Math.round(value * 100) + '%', false)});
    if (!living) {responseTransition = null; rebuildResponseTimeline();}
    resetWorld(); if (living) await analysis.getFrame(0);
    $('duration').textContent = clockText(audio.duration); $('seekSeconds').max = audio.duration;
    loading = false;
    if (writable) {await exportVideo(writable); return;}
    startPlayback(prepared);
  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    if (prepared?.writable) await prepared.writable.abort().catch(() => {});
    audio.unload(); responseTimeline = null; responseTransition = null; responseDirty = false;
    resetWorld(); setStatus('Could not load audio · ' + error.message, false);
  } finally {loading = false; updateButtons();}
}
async function capturePreparation() {
  if ($('autoRecord').checked) {const prepared = await recorder.prepareAutoRecord(); return prepared ? {prepared} : null;}
  if ($('autoExport').checked) {const writable = await capture.pickWritable(filename + '.mp4', error => setStatus(error.message)); return writable ? {writable} : null;}
  return {};
}
$('fileInput').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  await audio.resumeContext();
  const preparation = await capturePreparation();
  if (preparation) await loadTrack(file, preparation);
  event.target.value = '';
});
$('referenceBtn').addEventListener('click', async () => {
  let preparation;
  try {
    await audio.resumeContext();
    preparation = await capturePreparation(); if (!preparation) return;
    loading = true; updateButtons(); setStatus('Loading reference track…', false);
    const response = await fetch('./reference.mp3');
    if (!response.ok) throw new Error('reference.mp3 is unavailable');
    const file = new File([await response.blob()], 'reference.mp3', {type: 'audio/mpeg'});
    await loadTrack(file, preparation);
  } catch (error) {
    await preparation?.writable?.abort().catch(() => {});
    await preparation?.prepared?.writable?.abort().catch(() => {});
    loading = false; setStatus(error.message, false); updateButtons();
  }
});
async function togglePlayback() {
  if (!audio.hasAudio || loading || busy || seeking || recorder.isRecording) return;
  generation++;
  if (audio.isPlaying) {
    pausedSnapshot = saveWorld(); await audio.pause(); setStatus('Paused · ' + audio.fileName, false);
  } else if (audio.isPaused) {
    restorePausedWorld();
    await audio.resume(); setStatus(audio.fileName);
  } else {const resumePosition = !finished && frame > 0; if (!resumePosition) resetWorld(); await audio.resumeContext(); startPlayback(null, !resumePosition);}
  updateButtons();
}
async function replay() {
  if (!audio.hasAudio || loading || busy || seeking || recorder.isRecording) return;
  generation++; responseTransition = null; resetWorld(); if (living) await analysis.getFrame(0); await audio.resumeContext(); startPlayback();
}
async function seek(position) {
  if (!audio.hasAudio || loading || busy || seeking || recorder.isRecording) return;
  const playing = audio.isPlaying;
  await audio.pause();
  position = Math.max(0, Math.min(audio.duration - 1 / 60, position));
  audio.seek(position); setStatus('Moving through the track…', false);
  const task = rebuild(position); updateButtons(); await task;
  if (playing) await audio.resume(); else pausedSnapshot = saveWorld();
  finished = false; setStatus(playing ? audio.fileName : 'Paused · ' + audio.fileName, playing); updateButtons();
}
$('playPauseBtn').addEventListener('click', togglePlayback);
$('replayBtn').addEventListener('click', replay);
$('seek').addEventListener('change', event => seek(Number(event.target.value) * audio.duration));
$('seekSeconds').addEventListener('input', () => {seekEditing = true;});
$('seekSeconds').addEventListener('change', event => {seekEditing = false; seek(Number(event.target.value));});
$('seekSeconds').addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault(); seekEditing = false; seek(Number(event.target.value));}});
$('unloadBtn').addEventListener('click', () => {generation++; audio.unload(); analysis.reset(); responseTimeline = null; responseTransition = null; responseDirty = false; resetWorld(); idleTime = 0; finished = false; $('elapsed').textContent = $('duration').textContent = '0:00'; $('seek').value = 0; $('seekSeconds').value = 0; setStatus('Choose an audio file to begin', false); updateButtons();});
$('muteBtn').addEventListener('click', () => {const muted = audio.toggleMute(); $('muteBtn').textContent = muted ? '♪' : '♫'; $('muteBtn').setAttribute('aria-pressed', String(muted)); $('muteBtn').setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');});
$('recordBtn').addEventListener('click', async () => {
  if (busy || loading || !audio.hasAudio) return;
  if (recorder.isRecording) {recorder.stop(); return;}
  const prepared = await recorder.prepareAutoRecord(); if (!prepared) return;
  if (!audio.isPlaying) {
    if (audio.isPaused) {restorePausedWorld(); await audio.resume();}
    else {const resumePosition = !finished && frame > 0; if (!resumePosition) resetWorld(); await audio.resumeContext(); startPlayback(null, !resumePosition);}
  }
  recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
});
async function exportVideo(writable = null) {
  if (!audio.hasAudio || busy || loading || seeking || recorder.isRecording) return;
  if (!living && responseDirty) rebuildResponseTimeline();
  // The preview also freezes while the save picker is open. Preserve the fade
  // here, before that await, including when the picker itself is cancelled.
  const savedTransition = saveResponseTransition(responseTransition, performance.now());
  const suspendForPicker = !living && audio.context?.state === 'running';
  generation++; busy = true; updateButtons();
  if (pendingPump) await pendingPump;
  const savedPause = pausedSnapshot;
  try {
    if (suspendForPicker) await audio.suspendContext();
    await capture.runOfflineExport({
      audio, suggestedName: filename + '.mp4', pendingWritable: writable, onStatus: setStatus,
      labels: {rendering: 'Rendering ' + title + '…', saved: 'Export saved · ' + filename + '.mp4'},
      analysisProvider: index => living ? analysis.getFrame(index) : analysis.getFeatureFrame(index),
      prepare() {const saved = saveWorld(); saved.responseTransition = savedTransition; resetWorld(0, true); return saved;},
      restore(saved) {restoreWorld(saved, {restoreTransition: true}); pausedSnapshot = savedPause;},
      renderFrame(data, delta, frameData) {step(frameData); if (!living) presentDrift(frameData.frame / 60, distance, 1, false); composer.render();},
      readCanvas: () => renderer.domElement,
      gpuFinish: () => renderer.getContext().finish(),
    });
  } finally {
    try {if (suspendForPicker) await audio.resumeContext();}
    finally {
      responseTransition = restoreResponseTransition(savedTransition, performance.now());
      busy = false; updateButtons();
    }
  }
}
$('exportBtn').addEventListener('click', () => exportVideo());
for (const key of Object.keys(settings)) {
  const input = $(key); if (!input) continue;
  input.addEventListener('input', () => {
    settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
    if ($(key + 'Value')) $(key + 'Value').value = Number(input.value).toFixed(2).replace(/\.?0+$/, '') + (input.dataset.suffix || '');
    bloom.enabled = settings.bloom;
    if (!living && responseKeys.includes(key)) {responseDirty = true; updateResponsePreset(true);}
  });
}
function updateResponsePreset(custom = false) {
  if (living) return;
  $('responseName').textContent = custom ? 'Custom' : RESPONSE_PRESETS[responsePreset].label;
  document.querySelectorAll('[data-response-preset]').forEach(button => button.setAttribute('aria-pressed', String(!custom && button.dataset.responsePreset === responsePreset)));
}
function applyResponsePreset(id) {
  responsePreset = id;
  Object.assign(settings, RESPONSE_PRESETS[id].values);
  for (const key of responseKeys) {
    $(key).value = settings[key];
    $(key + 'Value').value = String(settings[key]);
  }
  responseDirty = true; updateResponsePreset();
}
if (!living) {
  document.querySelectorAll('[data-response-preset]').forEach(button => button.addEventListener('click', () => applyResponsePreset(button.dataset.responsePreset)));
  $('resetResponse').addEventListener('click', () => applyResponsePreset(responsePreset));
}
for (const id of ['autoRecord', 'autoExport']) $(id).addEventListener('change', () => {if ($(id).checked) $(id === 'autoRecord' ? 'autoExport' : 'autoRecord').checked = false;});
$('panelToggle').addEventListener('click', () => {
  const hidden = $('panel').classList.toggle('hidden'); $('panelToggle').classList.toggle('closed', hidden); $('panelToggle').textContent = hidden ? '☰' : '×'; $('panelToggle').setAttribute('aria-label', hidden ? 'Show settings' : 'Hide settings');
});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('recenterBtn').addEventListener('click', () => setView('front'));
$('hideUiBtn').addEventListener('click', () => document.body.classList.toggle('immersive'));
$('fullscreenBtn').addEventListener('click', async () => {try {if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen();} catch (error) {setStatus('Fullscreen unavailable · ' + error.message);}});
let dragging = null;
renderer.domElement.addEventListener('pointerdown', event => {if (busy) return; dragging = {x: event.clientX, y: event.clientY, yaw: viewYaw, pitch: viewPitch}; renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointermove', event => {if (!dragging) return; viewYaw = dragging.yaw + (event.clientX - dragging.x) * .003; viewPitch = Math.max(-1.1, Math.min(1.1, dragging.pitch + (event.clientY - dragging.y) * .003));});
renderer.domElement.addEventListener('pointerup', () => {dragging = null;});
renderer.domElement.addEventListener('pointercancel', () => {dragging = null;});
addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.code === 'Space') {event.preventDefault(); togglePlayback();}
  if (event.key.toLowerCase() === 'r') replay();
  if (event.key.toLowerCase() === 'h') document.body.classList.toggle('immersive');
  if (['1', '2', '3', '4'].includes(event.key)) setView(['front', 'left', 'right', 'up'][Number(event.key) - 1]);
});
addEventListener('resize', () => {if (!busy && !recorder.isRecording) resize(innerWidth, innerHeight, devicePixelRatio || 1);});
let previous = performance.now(), fpsFrames = 0, fpsWindowStart = previous;
function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(.05, (now - previous) / 1000); previous = now;
  if (busy || document.hidden) {fpsFrames = 0; fpsWindowStart = now; return;}
  if (!living && responseDirty) rebuildResponseTimeline(true);
  if (audio.isPlaying && !loading && !seeking) {
    restTime = 0;
    const actualTime = audio.getPlaybackPosition();
    const displayTime = living ? actualTime : presentationClock.sample(actualTime, now, audio.duration, {running: audio.context?.state === 'running'});
    // Only actual audio time may create events. Fractional display cannot fire a future onset.
    pump(Math.floor(actualTime * 60));
    if (!living && !seeking) {
      driftLight += (1 - driftLight) * -Math.expm1(-delta / .18);
      presentDrift(displayTime, distance + (displayTime - Math.max(0, frame) / 60) * settings.speed * 26);
    }
  } else if (!seeking) {
    if (audio.hasAudio) restTime += delta;
    if (!audio.hasAudio && !matchMedia('(prefers-reduced-motion: reduce)').matches) {idleTime += delta; distance += delta * 26 * settings.speed;}
    if (living) {
      setCamera(audio.hasAudio ? Math.max(0, frame) / 60 : idleTime);
      world.update({time: audio.hasAudio ? Math.max(0, frame) / 60 + restTime : idleTime, delta, distance, features: quietFeatures, frame: Math.max(0, frame), playing: false});
    } else {
      presentationClock.reset();
      if (audio.hasAudio) {
        driftLight += (.18 - driftLight) * -Math.expm1(-delta / .45);
        presentDrift(presentedTime, presentedDistance);
      } else {
        driftLight = 1;
        presentDrift(idleTime, distance);
      }
    }
  }
  if (living) setCamera(audio.hasAudio ? Math.max(0, frame) / 60 : idleTime);
  if (recorder.isRecording && capture.shouldSkipRecordingFrame(now, $('lock60').checked)) return;
  composer.render();
  if (recorder.isRecording) capture.requestRecordingFrame(now);
  fpsFrames++;
  const fpsTime = (now - fpsWindowStart) / 1000;
  if (fpsTime >= .5) {
    $('fps').textContent = Math.round(fpsFrames / fpsTime) + ' fps'; fpsWindowStart = now; fpsFrames = 0;
    const pos = finished ? audio.duration : audio.getPlaybackPosition();
    $('elapsed').textContent = clockText(pos);
    if (audio.hasAudio) {if (document.activeElement !== $('seek')) $('seek').value = pos / audio.duration; if (!seekEditing && document.activeElement !== $('seekSeconds')) $('seekSeconds').value = pos.toFixed(1);}
    const stats = world.getStats();
    $('sceneStats').textContent = living ? `${stats.visibleLinks ?? stats.activeLinks ?? 0} connections` : `${Math.round(131072 * settings.density).toLocaleString()} stars`;
    $('sceneStats').dataset.stats = JSON.stringify(stats);
    $('sceneStats').dataset.frame = frame;
    $('sceneStats').dataset.energy = audio.isPlaying ? features.energy : 0;
    $('sceneStats').dataset.canvas = `${renderer.domElement.width}×${renderer.domElement.height}`;
  }
  meters.forEach((bar, i) => bar.style.height = (2 + (audio.isPlaying ? (living ? scaled.levels[i] : displayFeatures.levels[i]) : 0) * 25) + 'px');
}
updateButtons();
requestAnimationFrame(animate);
addEventListener('pagehide', event => {if (event.persisted) return; audio.stop(); audio.context?.close(); analysis.dispose(); world.dispose(); composer.dispose(); renderer.dispose(); spectrumTexture.dispose();});

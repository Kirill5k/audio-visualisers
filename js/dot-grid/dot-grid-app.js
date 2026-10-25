/** Dot Grid transport and configuration, adapted from the local Light Fall player. */
import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { createDotGridScene } from './dot-grid-scene.js';
import { createMeshGridAnalysis } from '../mesh-grid/mesh-grid-analysis.js';
import { createLEDAnalysis } from '../led-grid/led-analysis.js';
import { DOT_GRID_CONTROLS, LOOM_CONTROLS, GLOBAL_CONTROLS, createSettings } from './dot-grid-settings.js';
import { PRESETS, DEFAULT_PRESET_ID } from './dot-grid-presets.js';
import { EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_NAMES, EFFECT_ORDER, resolveEffectOrder } from '../particle-dance/particle-dance-effect-settings.js';
import { eligibleModulationTargets, createModulation, setModulationBound, MODULATION_CONTROLS, FREQUENCY_RANGES } from '../particle-dance/particle-dance-modulation.js';

const $ = id => document.getElementById(id);
const DT = 1 / 60;
const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const browserBias = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !mobile ? 10 : 0;
const silentSamples = new Float32Array(1);
// Virtual silence keeps time-based modulation running in the unloaded preview.
const silentBuffer = { sampleRate: 48000, length: 1, duration: Number.MAX_SAFE_INTEGER, numberOfChannels: 1, getChannelData: () => silentSamples };
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const clone = value => structuredClone(value);
const isLoom = settings => Boolean(settings.scrollingSpectrum);
const LOOM_DOT_CONTROLS = new Set(['scrollingSpectrum', 'gridWidth', 'gridHeight', 'dotSize', 'spacing', 'maxScale', 'heightDisplacement', 'sphereIntensity']);
const aborted = () => new DOMException('Audio analysis was replaced or cancelled', 'AbortError');

async function initialise() {
  let presetId = DEFAULT_PRESET_ID;
  let settings = createSettings(presetId);
  let busy = '';
  let finished = false;
  let baseTime = 0;
  let frameIndex = -1;
  let idleOrigin = performance.now();
  let needsRepaint = false;
  let pendingResize = false;
  let exportScene = null;
  let exportAnalysis = null;
  let recordingStopped = null;
  let recordingError = null;
  let recordingSession = false;
  let alive = true;
  let audioGeneration = 0;
  let bufferSerial = 0;
  let loomAnalysis = null;
  let loomBuffer = null;
  let loomLoading = null;
  let referenceController = null;
  let appliedScrollingSpectrum = settings.scrollingSpectrum;
  const expandedSections = new Map();
  let viewport = { width: innerWidth, height: innerHeight, pixelRatio: Math.min(devicePixelRatio, 2) };
  const audio = createAudioPlayback({ fftSize: settings.fftSize, maxFftSize: 32768 });
  const scene = createDotGridScene({ settings, ...viewport, interactive: true });
  $('stage').append(scene.canvas);
  let analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias });
  const canRecord = Boolean(globalThis.MediaRecorder && scene.canvas.captureStream);
  const canEncode = Boolean(globalThis.VideoEncoder && globalThis.AudioEncoder && globalThis.Mp4Muxer);
  const canExport = canEncode && Boolean(globalThis.showSaveFilePicker);
  $('capabilityStatus').textContent = !canRecord
    ? 'This browser does not support canvas recording.'
    : !canExport ? 'Full-track MP4 export needs desktop Chrome or Edge with file saving enabled. Record is available.' : 'MP4 export is available. Files stay on this device.';

  function status(message, live = audio.isPlaying) {
    if (!alive) return;
    $('statusText').textContent = message;
    $('statusLight').classList.toggle('live', live);
  }
  function report(error) { if (error?.name === 'AbortError') return; console.error(error); status(error.message || String(error), false); }
  function bind(id, event, handler) {
    $(id).addEventListener(event, e => { try { Promise.resolve(handler(e)).catch(report); } catch (error) { report(error); } });
  }
  // MediaRecorder marks itself inactive before its final asynchronous file write
  // completes. Keep this session exclusive until its onStop callback finishes.
  const locked = () => Boolean(!alive || busy || recordingSession || recorder.isRecording);
  function syncButtons() {
    if (!alive) return;
    const lock = locked();
    const savingRecording = recordingSession && !recorder.isRecording;
    for (const id of ['playPauseBtn', 'replayBtn', 'unloadBtn', 'seek']) $(id).disabled = !audio.hasAudio || lock;
    $('recordBtn').disabled = !audio.hasAudio || !canRecord || Boolean(busy && !(busy === 'buffering' && recorder.isRecording)) || recordingSession && !recorder.isRecording;
    $('recordBtn').classList.toggle('recording', recorder.isRecording);
    $('recordBtn').querySelector('.action-label').textContent = savingRecording ? 'Saving…' : recorder.isRecording ? 'Stop' : 'Record';
    $('recordBtn').setAttribute('aria-label', savingRecording ? 'Saving recording' : recorder.isRecording ? 'Stop recording' : 'Record');
    $('exportBtn').disabled = !audio.hasAudio || lock || !canExport;
    $('exportBtn').title = canExport ? 'Export the complete track as 1080p / 60 fps MP4' : 'MP4 export requires desktop Chrome or Edge and file saving';
    $('playPauseBtn').querySelector('.action-label').textContent = audio.isPlaying ? 'Pause' : 'Play';
    $('playPauseBtn').firstChild.textContent = audio.isPlaying ? 'Ⅱ ' : '▶ ';
    $('playPauseBtn').title = audio.isPlaying ? 'Pause' : 'Play';
    $('playPauseBtn').setAttribute('aria-label', audio.isPlaying ? 'Pause' : 'Play');
    $('muteBtn').setAttribute('aria-pressed', String(audio.isMuted));
    $('muteBtn').querySelector('.action-label').textContent = audio.isMuted ? 'Unmute' : 'Mute';
    $('muteBtn').setAttribute('aria-label', audio.isMuted ? 'Unmute listening audio' : 'Mute listening audio');
    $('muteBtn').title = audio.isMuted ? 'Unmute listening only' : 'Mute listening only';
    for (const input of $('panel').querySelectorAll('input, select, button')) input.disabled = lock || input.dataset.unavailable === 'true';
    document.querySelector('.file-picker').setAttribute('aria-disabled', String(lock));
    $('stage').setAttribute('aria-busy', String(Boolean(busy)));
    scene.setInteractive?.(!lock);
    if (!lock && pendingResize) {
      pendingResize = false;
      size(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
    }
  }
  function size(width, height, pixelRatio) {
    viewport = { width, height, pixelRatio };
    scene.resize(width, height, pixelRatio);
    scene.render();
  }
  const capture = createCaptureSession({
    width: 1920, height: 1080, fps: 60,
    getCanvas: () => scene.canvas,
    getAudioTrack: () => audio.getRecordingAudioTrack(),
    saveViewport: () => ({ ...viewport }),
    // Export uses a second renderer; leave the preview's render targets untouched.
    applyViewport: () => {},
    applyRecordingViewport: (width, height) => size(width, height, 1 / (settings.renderScale || 1)),
    restoreViewport: saved => {
      if (!alive) return;
      if (saved.width !== viewport.width || saved.height !== viewport.height || saved.pixelRatio !== viewport.pixelRatio) {
        size(saved.width, saved.height, saved.pixelRatio);
      }
    },
    overlay: { root: $('exportOverlay'), status: $('exportStatus'), progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn') },
  });
  const recorder = globalThis.createRecorder({
    defaultFilename: 'dot-grid-recording',
    videoBitsPerSecond: 40_000_000,
    onStatus: message => status(message),
    onStart: () => { recordingSession = true; recordingError = null; busy = ''; syncButtons(); status('Recording · ' + audio.fileName); },
    onError: error => { recordingError = error; busy = 'saving'; syncButtons(); report(error); },
    onStop: error => {
      // A pending buffer request must not restart playback after Stop.
      bufferSerial++;
      recordingError = error || recordingError;
      try { capture.onRecordingStopped(); }
      catch (restoreError) { recordingError ||= restoreError; report(restoreError); }
      finally {
        recordingSession = false; busy = ''; syncButtons();
        recordingStopped?.(recordingError); recordingStopped = null;
      }
    },
  });

  function disposeLoomAnalysis() {
    audioGeneration++; bufferSerial++;
    loomAnalysis?.dispose();
    loomAnalysis = null; loomBuffer = null; loomLoading = null;
  }
  function loomReady(time) {
    return !audio.hasAudio || Boolean(loomAnalysis && loomBuffer === audio.buffer && loomAnalysis.isReady(time));
  }
  async function ensureLoom(time) {
    if (!audio.hasAudio) return null;
    const buffer = audio.buffer, token = audioGeneration;
    if (!loomAnalysis || loomBuffer !== buffer) {
      loomAnalysis?.dispose();
      loomAnalysis = createLEDAnalysis();
      loomBuffer = buffer;
      loomLoading = loomAnalysis.load(buffer);
    }
    const reader = loomAnalysis;
    try {
      await loomLoading;
      if (!alive || token !== audioGeneration || buffer !== audio.buffer || reader !== loomAnalysis) throw aborted();
      await reader.ensureRange(Math.max(0, time - 6), time + .5);
      if (!alive || token !== audioGeneration || buffer !== audio.buffer || reader !== loomAnalysis) throw aborted();
      return reader;
    } catch (error) {
      if (reader === loomAnalysis) { reader.dispose(); loomAnalysis = null; loomBuffer = null; loomLoading = null; }
      throw error;
    }
  }
  // Keep ordinary Dot Grid controls and cached seeks synchronous. Cold Loom
  // passages freeze the audio clock while their real PCM history is prepared.
  function withPreparedLoom(time, commit) {
    if (loomReady(time)) return commit();
    const token = audioGeneration;
    busy = 'preparing'; syncButtons(); status('Preparing scrolling spectrum…', false);
    return (async () => {
      try {
        await audio.suspendContext();
        await ensureLoom(time);
        if (!alive || token !== audioGeneration) throw aborted();
        const result = commit();
        loomAnalysis?.prefetch(audio.getPlaybackPosition());
        status(audio.fileName, audio.isPlaying);
        return result;
      } finally {
        if (alive && token === audioGeneration) {
          try { await audio.resumeContext(); }
          finally { if (alive && token === audioGeneration) { busy = ''; syncButtons(); } }
        }
      }
    })();
  }
  function analysisFrame(time, dt, source = analysis, configuration = settings) {
    const frame = source.frameAt(time, dt);
    if (isLoom(configuration) && audio.hasAudio) frame.loom = loomAnalysis.getFrame(time);
    return frame;
  }
  async function bufferPlayback(requiredTime) {
    const token = audioGeneration, serial = ++bufferSerial, wasRecording = recorder.isRecording;
    busy = 'buffering';
    if (wasRecording) recorder.pause();
    await audio.pause();
    const position = audio.getPlaybackPosition();
    syncButtons(); status('Preparing this passage…', false);
    try {
      await ensureLoom(Math.max(position, requiredTime));
      if (!alive || token !== audioGeneration || serial !== bufferSerial || !audio.hasAudio || (wasRecording && !recorder.isRecording)) return;
      rebuild(position);
      loomAnalysis.prefetch(position);
      if (wasRecording) recorder.resume();
      audio.play({ fromStart: false, onEnded: ended });
      status(wasRecording ? 'Recording · ' + audio.fileName : audio.fileName, true);
    } catch (error) {
      if (alive && token === audioGeneration && serial === bufferSerial && wasRecording && recorder.isRecording) recorder.stop();
      throw error;
    } finally {
      if (alive && token === audioGeneration && serial === bufferSerial) {
        if (busy === 'buffering') busy = '';
        syncButtons();
      }
    }
  }

  function rebuild(position = finished ? audio.duration : audio.getPlaybackPosition(), { camera = true } = {}) {
    const savedCamera = camera ? scene.getCameraState() : null;
    scene.reset();
    if (savedCamera) scene.setCameraState(savedCamera);
    analysis.reset();
    baseTime = position;
    frameIndex = -1;
    idleOrigin = performance.now();
    drawFrame(0);
  }
  function drawFrame(index) {
    const frame = analysisFrame(baseTime + index * DT, DT);
    // Visual clocks restart with the temporal history; PCM sampling retains the seek offset.
    scene.step({ ...frame, time: index * DT }, DT);
    frameIndex = index;
  }
  function ended() {
    finished = true;
    if (recorder.isRecording) { busy = 'saving'; recorder.stop(); }
    status('Finished · ' + audio.fileName, false);
    syncButtons();
  }
  async function playPause() {
    if (!audio.hasAudio || locked()) return;
    if (audio.isPlaying) { await audio.pause(); status('Paused · ' + audio.fileName, false); }
    else {
      if (isLoom(settings)) await withPreparedLoom(finished ? 0 : audio.getPlaybackPosition(), () => true);
      if (!alive) return;
      await audio.resumeContext();
      if (finished) { audio.seek(0); finished = false; rebuild(0, { camera: false }); }
      loomAnalysis?.prefetch(audio.getPlaybackPosition());
      audio.play({ fromStart: false, onEnded: ended });
      status(audio.fileName, true);
    }
    syncButtons();
  }
  async function load(file, { autoplay = true } = {}) {
    if (locked()) return;
    busy = 'loading'; syncButtons(); status('Decoding ' + file.name + '…', false);
    disposeLoomAnalysis();
    const token = audioGeneration;
    try {
      await audio.load(file);
      if (!alive || token !== audioGeneration) throw aborted();
      analysis.dispose();
      analysis = createMeshGridAnalysis(audio.buffer, settings, { browserBias });
      if (isLoom(settings)) { status('Preparing scrolling spectrum…', false); await ensureLoom(0); }
      if (!alive || token !== audioGeneration) throw aborted();
      finished = false;
      rebuild(0, { camera: false });
      $('durationText').textContent = formatTime(audio.duration);
      if (autoplay) audio.play({ fromStart: true, onEnded: ended });
      loomAnalysis?.prefetch(0);
      status(audio.fileName, autoplay);
    } catch (error) {
      if (!alive || token !== audioGeneration) throw error;
      loomAnalysis?.dispose(); loomAnalysis = null; loomBuffer = null; loomLoading = null;
      audio.unload(); analysis.dispose();
      analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias });
      finished = false; rebuild(0); $('durationText').textContent = '0:00';
      throw error;
    } finally { if (alive && token === audioGeneration) { busy = ''; syncButtons(); } }
  }
  function selectPreset(id) {
    if (locked()) return;
    const next = createSettings(id);
    const apply = () => {
      presetId = id;
      settings = next;
      appliedScrollingSpectrum = settings.scrollingSpectrum;
      scene.applyPreset(settings);
      analysis.setSettings(settings);
      audio.setFftSize(settings.fftSize);
      rebuild(finished ? audio.duration : audio.getPlaybackPosition(), { camera: false });
      buildControls(); syncButtons();
    };
    return isLoom(next) ? withPreparedLoom(finished ? audio.duration : audio.getPlaybackPosition(), apply) : apply();
  }
  function settingsChanged(key) {
    const apply = () => applySettingsChange(key);
    if (!isLoom(settings)) return apply();
    const result = withPreparedLoom(finished ? audio.duration : audio.getPlaybackPosition(), apply);
    if (!result?.then) return result;
    return result.catch(error => {
      // Mode changes are committed only after their reader becomes available.
      if (key === 'scrollingSpectrum' && alive) { settings.scrollingSpectrum = appliedScrollingSpectrum; buildControls(); syncButtons(); }
      throw error;
    });
  }
  function applySettingsChange(key) {
    if (key === 'minDecibels' && settings.minDecibels >= settings.maxDecibels) settings.maxDecibels = settings.minDecibels + 1;
    if (key === 'maxDecibels' && settings.maxDecibels <= settings.minDecibels) settings.minDecibels = settings.maxDecibels - 1;
    if (key === 'minDecibels' || key === 'maxDecibels') {
      for (const name of ['minDecibels', 'maxDecibels']) {
        const input = $(`control-${name}`);
        if (input) { input.value = settings[name]; input.parentElement.querySelector('.number-value').value = settings[name]; }
      }
    }
    scene.setSettings(settings);
    analysis.setSettings(settings);
    if (key === 'fftSize') { audio.setFftSize(settings.fftSize); rebuild(); }
    else if (key === 'scrollingSpectrum' || DOT_GRID_CONTROLS[key]?.structural) rebuild();
    else if (!audio.isPlaying) {
      // A paused edit updates geometry without advancing the audio position.
      const frame = analysisFrame(audio.hasAudio ? finished ? audio.duration : audio.getPlaybackPosition() : Math.max(0, frameIndex) * DT, 0);
      scene.step({ ...frame, time: Math.max(0, frameIndex) * DT }, 0);
    }
    if (key === 'scrollingSpectrum') {
      appliedScrollingSpectrum = settings.scrollingSpectrum;
      buildControls(); syncButtons();
    }
    if (key === 'enablePostProcessing' || key.endsWith('_enabled')) {
      pruneModulations(); analysis.setSettings(settings); rebuildModulations();
    }
  }

  function group(title, open = false, parent = $('configControls')) {
    const details = document.createElement('details'); details.className = 'section';
    details.dataset.section = `${parent.dataset.section || ''}/${title}`;
    details.open = expandedSections.get(details.dataset.section) ?? open;
    const summary = document.createElement('summary'); summary.textContent = title;
    details.append(summary); parent.append(details); return details;
  }
  function control(parent, key, spec, owner = settings, change = settingsChanged, prefix = '') {
    const row = document.createElement('div'); row.className = 'config-row'; row.dataset.search = `${parent.dataset.section || ''} ${spec.label} ${key}`.toLowerCase();
    const id = `control-${prefix}${key}`;
    const label = document.createElement('label'); label.htmlFor = id;
    const text = document.createElement('span'); text.textContent = spec.label; label.append(text);
    const input = document.createElement(spec.type === 'select' ? 'select' : 'input'); input.id = id;
    if (spec.type === 'number') {
      row.classList.add('control'); label.className = 'control-head';
      const number = document.createElement('input'); number.type = 'number'; number.className = 'number-value'; number.setAttribute('aria-label', spec.label + ' value');
      for (const el of [input, number]) { el.min = spec.min; el.max = spec.max; el.step = spec.step ?? .01; el.value = owner[key] ?? spec.default; }
      input.type = 'range'; label.append(number); row.append(label, input);
      const update = source => {
        if (locked() || source.disabled || !Number.isFinite(source.valueAsNumber)) return;
        owner[key] = Math.max(spec.min, Math.min(spec.max, source.valueAsNumber));
        try { Promise.resolve(change(key)).catch(report); } catch (error) { report(error); }
        // Validation may clamp related endpoints; display the applied value.
        input.value = number.value = owner[key];
      };
      input.addEventListener('input', () => update(input)); number.addEventListener('change', () => update(number));
    } else {
      label.className = spec.type === 'boolean' ? 'toggle-row' : 'color-row';
      if (spec.type === 'boolean') { input.type = 'checkbox'; input.checked = Boolean(owner[key]); }
      else if (spec.type === 'color') { input.type = 'color'; input.value = owner[key] ?? spec.default; }
      else if (spec.type === 'select') {
        const options = Array.isArray(spec.options) ? spec.options.map(v => [String(v), v]) : Object.entries(spec.options || {});
        for (const [label, value] of options) { const option = new Option(label, String(value)); input.add(option); }
        input.value = String(owner[key] ?? spec.default);
      } else { input.type = 'text'; input.value = owner[key] ?? spec.default ?? ''; }
      label.append(input); row.append(label);
      input.addEventListener('input', () => {
        if (locked()) return;
        owner[key] = spec.type === 'boolean' ? input.checked : typeof spec.default === 'number' ? Number(input.value) : input.value;
        try { Promise.resolve(change(key)).catch(report); } catch (error) { report(error); }
      });
    }
    parent.append(row);
    return row;
  }
  function modulationTargets() {
    const controls = isLoom(settings) ? { ...Object.fromEntries(Object.entries(DOT_GRID_CONTROLS).filter(([key]) => LOOM_DOT_CONTROLS.has(key))), ...LOOM_CONTROLS } : DOT_GRID_CONTROLS;
    return eligibleModulationTargets(controls, EFFECT_CONTROLS, settings, EFFECT_NAMES);
  }
  function pruneModulations() {
    // A checkbox switch keeps the other mode's saved modulation choices.
    const available = eligibleModulationTargets({ ...DOT_GRID_CONTROLS, ...LOOM_CONTROLS }, EFFECT_CONTROLS, settings, EFFECT_NAMES);
    for (const key of Object.keys(settings.controlModulations || {})) {
      if (!available[key]) { delete settings.controlModulations[key]; analysis.resetModulation(key); }
    }
  }
  function rebuildModulations() {
    $('modulationControls')?.remove();
    buildModulations(); filterControls(); syncButtons();
  }
  function buildModulations() {
    const parent = group('Slider modulation'); parent.id = 'modulationControls';
    const available = modulationTargets();
    settings.controlModulations ||= {};
    const addRow = document.createElement('div'); addRow.className = 'modulation-add config-row';
    addRow.dataset.search = 'slider modulation add target';
    const select = document.createElement('select'); select.id = 'modulationTarget'; select.setAttribute('aria-label', 'Slider to modulate');
    for (const [key, spec] of Object.entries(available)) {
      if (!settings.controlModulations[key]) select.add(new Option(spec.label, key));
    }
    const add = document.createElement('button'); add.id = 'addModulationBtn'; add.className = 'text-button'; add.textContent = 'Add';
    add.dataset.unavailable = String(!select.options.length); add.disabled = !select.options.length;
    add.addEventListener('click', () => {
      if (locked() || !available[select.value]) return;
      const key = select.value;
      settings.controlModulations[key] = createModulation(available[key]);
      analysis.resetModulation(key); settingsChanged('controlModulations');
      rebuildModulations(); $('modulationControls').open = true;
    });
    addRow.append(select, add); parent.append(addRow);
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Animate a Dot Grid slider or an enabled effect. Audio follows the music; the other modes follow playback time.'; parent.append(hint);
    for (const [key, m] of Object.entries(settings.controlModulations)) {
      const spec = available[key]; if (!spec) continue;
      const item = group(spec.label, true, parent); item.className = 'modulation-card'; item.dataset.target = key;
      const target = { value: key };
      control(item, 'value', { type: 'select', label: 'Target', default: key, options: Object.fromEntries(Object.entries(available).filter(([name]) => name === key || !settings.controlModulations[name]).map(([name, definition]) => [definition.label, name])) }, target, () => {
        const nextKey = target.value;
        delete settings.controlModulations[key];
        settings.controlModulations[nextKey] = { ...m, min: available[nextKey].min ?? 0, max: available[nextKey].max ?? 1 };
        analysis.resetModulation(key); analysis.resetModulation(nextKey);
        settingsChanged('controlModulations'); rebuildModulations(); $('modulationControls').open = true;
      }, `mod-${key}-target-`);
      const visibility = [];
      const updateVisibility = () => {
        for (const [row, mode] of visibility) row.dataset.modeHidden = String(mode === 'audio' ? m.mode !== 'audio' : mode === 'flux' ? m.mode !== 'audio' || m.source !== 'flux' : mode === 'temporal' ? m.mode === 'audio' : false);
      };
      for (const [name, definition] of Object.entries(MODULATION_CONTROLS)) {
        if (m[name] === undefined) m[name] = definition.default;
        const row = control(item, name, definition, m, () => {
          if (name === 'mode' || name === 'enabled' || ['ramp-up', 'ramp-down'].includes(m.mode) && ['speed', 'easing'].includes(name)) analysis.resetModulation(key);
          settingsChanged('controlModulations'); updateVisibility();
        }, `mod-${key}-`);
        visibility.push([row, definition.mode]);
      }
      for (const [name, label] of [['min', 'Minimum'], ['max', 'Maximum']]) {
        control(item, name, { type: 'number', label, min: spec.min ?? 0, max: spec.max ?? 1, step: spec.step ?? .01, default: name === 'min' ? spec.min ?? 0 : spec.max ?? 1 }, m, () => {
          setModulationBound(m, name, m[name], spec);
          if (['ramp-up', 'ramp-down'].includes(m.mode)) analysis.resetModulation(key);
          settingsChanged('controlModulations');
        }, `mod-${key}-`);
      }
      const frequency = { range: Object.keys(FREQUENCY_RANGES).find(id => FREQUENCY_RANGES[id].start === m.freqStart && FREQUENCY_RANGES[id].end === m.freqEnd) || 'full' };
      const frequencyRow = control(item, 'range', { type: 'select', label: 'Frequency range', default: 'full', options: Object.fromEntries(Object.entries(FREQUENCY_RANGES).map(([id, range]) => [range.label, id])) }, frequency, () => {
        m.freqStart = FREQUENCY_RANGES[frequency.range].start; m.freqEnd = FREQUENCY_RANGES[frequency.range].end;
        settingsChanged('controlModulations');
      }, `mod-${key}-`);
      visibility.push([frequencyRow, 'audio']);
      const remove = document.createElement('button'); remove.className = 'text-button remove-modulation'; remove.textContent = 'Remove modulation';
      remove.addEventListener('click', () => {
        if (locked()) return;
        delete settings.controlModulations[key]; analysis.resetModulation(key);
        settingsChanged('controlModulations'); rebuildModulations(); $('modulationControls').open = true;
      });
      item.append(remove); updateVisibility();
    }
  }
  function buildControls() {
    $('variants').replaceChildren();
    for (const [index, preset] of PRESETS.entries()) {
      const button = document.createElement('button'); button.textContent = index + 1; button.title = `Dot Grid variant ${index + 1}`;
      button.setAttribute('aria-label', `Variant ${index + 1}`); button.setAttribute('aria-pressed', String(preset.id === presetId));
      button.addEventListener('click', () => { try { Promise.resolve(selectPreset(preset.id)).catch(report); } catch (error) { report(error); } }); $('variants').append(button);
    }
    $('presetName').textContent = `Variant ${PRESETS.findIndex(p => p.id === presetId) + 1}`;
    for (const section of $('configControls').querySelectorAll('details')) expandedSections.set(section.dataset.section, section.open);
    $('configControls').replaceChildren();
    const grid = group('Dots & colour', true);
    for (const [key, spec] of Object.entries(DOT_GRID_CONTROLS)) if (!isLoom(settings) || LOOM_DOT_CONTROLS.has(key)) control(grid, key, spec);
    if (isLoom(settings)) {
      const loom = group('Scrolling spectrum', true);
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Frequency runs across one grid axis while six seconds of analysed audio scroll along the other. Horizontal swaps the axes.'; loom.append(hint);
      for (const [key, spec] of Object.entries(LOOM_CONTROLS)) control(loom, key, spec);
    }
    for (const title of ['Audio', 'Camera', 'Background', 'Rendering']) {
      const parent = group(title);
      if (title === 'Audio' && isLoom(settings)) {
        const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'These audio controls drive effect modulation. The scrolling spectrum uses Spectral Loom’s calibrated analysis and the Spectrum gain control.'; parent.append(hint);
      }
      for (const [key, spec] of Object.entries(GLOBAL_CONTROLS)) if (spec.group === title) control(parent, key, spec);
    }
    const effects = group('Post-processing');
    control(effects, 'enablePostProcessing', { type: 'boolean', label: 'Enable post-processing', default: false });
    const effectHint = document.createElement('p'); effectHint.className = 'hint';
    effectHint.textContent = 'Effects run only when post-processing is enabled. Each effect keeps its own settings and position in the order below.';
    effects.append(effectHint);
    const effectActions = document.createElement('div'); effectActions.className = 'effect-actions config-row'; effectActions.dataset.search = 'effects disable reset';
    for (const [label, reset] of [['Disable all effects', false], ['Reset all effects', true]]) {
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = label; button.id = reset ? 'resetEffectsBtn' : 'disableEffectsBtn';
      button.addEventListener('click', () => {
        if (locked()) return;
        if (reset) { Object.assign(settings, clone(EFFECT_DEFAULTS)); settings.effectOrder = [...EFFECT_ORDER]; }
        else for (const id of EFFECT_ORDER) settings[`${id}_enabled`] = false;
        pruneModulations(); settingsChanged('effects'); buildControls(); syncButtons();
      });
      effectActions.append(button);
    }
    effects.append(effectActions);
    const order = [...new Set([...(settings.effectOrder || []), ...EFFECT_ORDER])].filter(id => EFFECT_CONTROLS[id]);
    for (const id of order) {
      if (!EFFECT_CONTROLS[id]) continue;
      const label = EFFECT_NAMES[id] || id.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase());
      const parent = group(label, false, effects); parent.dataset.effect = id;
      for (const [key, spec] of Object.entries(EFFECT_CONTROLS[id])) control(parent, `${id}_${key}`, spec);
      const move = document.createElement('div'); move.className = 'preset-caption';
      for (const [text, offset] of [['↑ Earlier', -1], ['↓ Later', 1]]) {
        const button = document.createElement('button'); button.className = 'text-button'; button.textContent = text; button.setAttribute('aria-label', `${text} ${label}`);
        button.dataset.unavailable = String(offset < 0 ? order.indexOf(id) === 0 : order.indexOf(id) === order.length - 1);
        button.disabled = button.dataset.unavailable === 'true';
        button.addEventListener('click', () => { if (locked()) return; const index = order.indexOf(id); if (index + offset < 0 || index + offset >= order.length) return; [order[index], order[index + offset]] = [order[index + offset], order[index]]; settings.effectOrder = [...order]; settingsChanged('effectOrder'); buildControls(); syncButtons(); });
        move.append(button);
      }
      parent.append(move);
    }
    buildModulations();
    filterControls();
  }
  function filterControls() {
    const query = $('controlSearch').value.trim().toLowerCase();
    // Keep a containing control visible when one of its nested options matches.
    for (const row of [...$('configControls').querySelectorAll('.config-row')].reverse()) {
      row.hidden = Boolean(query && !row.dataset.search.includes(query) && ![...row.querySelectorAll('.config-row')].some(child => !child.hidden));
    }
    for (const details of [...$('configControls').querySelectorAll('details')].reverse()) {
      details.hidden = Boolean(query && ![...details.querySelectorAll('.config-row')].some(row => !row.hidden));
      if (query && !details.hidden) details.open = true;
    }
  }

  async function toggleRecord({ writable } = {}) {
    if (recorder.isRecording) { bufferSerial++; busy = 'saving'; recorder.stop(); syncButtons(); return; }
    if (locked() || !audio.hasAudio || !canRecord) return;
    busy = 'recording-setup'; syncButtons();
    let prepared;
    try {
      const choosing = writable ? Promise.resolve({ writable, codec: recorder.getCodec() }) : recorder.prepareAutoRecord();
      await audio.suspendContext();
      prepared = await choosing;
      if (!prepared) return;
      if (isLoom(settings)) await ensureLoom(finished ? 0 : audio.getPlaybackPosition());
      if (!alive) throw aborted();
      if (finished) { audio.seek(0); finished = false; rebuild(0, { camera: false }); }
      loomAnalysis?.prefetch(audio.getPlaybackPosition());
      // Start capture before playback so the opening audio transient is included.
      recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
      await audio.resumeContext();
      if (!audio.isPlaying) audio.play({ fromStart: false, onEnded: ended });
    } catch (error) {
      if (recorder.isRecording) recorder.stop();
      else await prepared?.writable?.abort?.();
      capture.onRecordingStopped(); throw error;
    } finally {
      if (alive) {
        try { await audio.resumeContext(); }
        finally { if (alive) { busy = recordingSession && !recorder.isRecording ? 'saving' : ''; syncButtons(); } }
      }
    }
  }
  async function exportVideo({ writable } = {}) {
    if (locked() || !audio.hasAudio || !canEncode || (!writable && !canExport)) return { ok: false, reason: 'unavailable' };
    busy = 'exporting'; syncButtons();
    try {
      const choosing = writable ? Promise.resolve(writable) : capture.pickWritable('dot-grid.mp4', report);
      await audio.suspendContext();
      const destination = await choosing;
      if (!destination) return { ok: false, reason: 'cancelled' };
      const snapshot = clone(settings);
      snapshot.cameraState = scene.getCameraState();
      // The encoder receives 1080p regardless of the interactive preview scale.
      snapshot.renderScale = 1;
      return await capture.runOfflineExport({
        audio, suggestedName: 'dot-grid.mp4', pendingWritable: destination,
        onStatus: message => status(message), labels: { rendering: 'Rendering Dot Grid…' },
        async prepare() {
          if (isLoom(snapshot)) await ensureLoom(0);
          if (!alive) throw aborted();
          exportAnalysis = createMeshGridAnalysis(audio.buffer, snapshot, { browserBias });
          exportScene = createDotGridScene({ settings: snapshot, width: 1920, height: 1080, pixelRatio: 1, interactive: false });
          $('exportCancelBtn').focus();
        },
        restore() {
          try { exportScene?.dispose(); }
          finally { exportScene = null; exportAnalysis?.dispose(); exportAnalysis = null; }
        },
        async analysisProvider(index, dt) {
          const time = index * dt;
          // Preview stays suspended during export, so the same reader's scratch
          // arrays are safe to consume synchronously in the export renderer.
          if (isLoom(snapshot) && !loomReady(time)) await ensureLoom(time);
          return analysisFrame(time, dt, exportAnalysis, snapshot);
        },
        renderFrame: (spectrum, dt, frame) => exportScene.step(frame, dt),
        readCanvas: () => exportScene.canvas,
        gpuFinish: () => exportScene.renderer.getContext().finish(),
      });
    } finally {
      if (alive) {
        try { await audio.resumeContext(); }
        finally { if (alive) { busy = ''; syncButtons(); $('exportBtn').focus(); } }
      }
    }
  }

  bind('fileInput', 'change', async e => { const file = e.target.files[0]; try { if (file) await load(file); } finally { e.target.value = ''; } });
  document.querySelector('.file-picker').addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key) && !locked()) { e.preventDefault(); $('fileInput').click(); } });
  async function loadReference() {
    if (locked()) return;
    busy = 'fetching'; syncButtons(); status('Loading reference track…', false);
    const token = audioGeneration, controller = referenceController = new AbortController();
    let file;
    try {
      await audio.resumeContext();
      const response = await fetch('reference.mp3', { signal: controller.signal });
      if (!response.ok) throw new Error('Reference track unavailable. Choose an audio file instead.');
      file = new File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' });
      if (!alive || token !== audioGeneration) throw aborted();
    } finally {
      if (referenceController === controller) referenceController = null;
      if (alive && token === audioGeneration) { busy = ''; syncButtons(); }
    }
    await load(file);
  }
  bind('referenceBtn', 'click', loadReference);
  bind('playPauseBtn', 'click', playPause);
  bind('replayBtn', 'click', async () => {
    if (locked() || !audio.hasAudio) return;
    if (isLoom(settings)) await withPreparedLoom(0, () => true);
    if (!alive) return;
    await audio.resumeContext(); audio.seek(0); finished = false; rebuild(0, { camera: false });
    loomAnalysis?.prefetch(0); audio.play({ fromStart: true, onEnded: ended }); syncButtons(); status(audio.fileName, true);
  });
  bind('unloadBtn', 'click', () => { if (locked()) return; disposeLoomAnalysis(); audio.unload(); analysis.dispose(); analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias }); finished = false; rebuild(0); $('fileInput').value = ''; $('durationText').textContent = '0:00'; syncButtons(); status('Choose an audio file or load the reference track', false); });
  function seek(seconds) {
    if (locked() || !audio.hasAudio || !Number.isFinite(seconds)) return false;
    const time = Math.max(0, Math.min(audio.duration, seconds));
    const apply = () => { audio.seek(time); finished = time >= audio.duration; rebuild(time); status(audio.fileName); syncButtons(); loomAnalysis?.prefetch(time); return true; };
    return isLoom(settings) ? withPreparedLoom(time, apply) : apply();
  }
  bind('seek', 'input', e => seek(Number(e.target.value) / 1000 * audio.duration));
  bind('muteBtn', 'click', () => { audio.toggleMute(); syncButtons(); });
  bind('recordBtn', 'click', () => toggleRecord());
  bind('exportBtn', 'click', () => exportVideo());
  bind('resetBtn', 'click', () => selectPreset(presetId));
  bind('controlSearch', 'input', filterControls);
  function togglePanel(force) {
    const hidden = force === undefined ? !$('panel').classList.contains('hidden') : !force;
    $('panel').classList.toggle('hidden', hidden); $('panel').inert = hidden;
    $('panelToggle').classList.toggle('closed', hidden); $('panelToggle').setAttribute('aria-expanded', String(!hidden)); $('panelToggle').setAttribute('aria-label', hidden ? 'Show settings' : 'Hide settings');
    $('panelToggle').title = hidden ? 'Show settings' : 'Hide settings';
  }
  function clean(force) { const value = force ?? !document.body.classList.contains('clean'); document.body.classList.toggle('clean', value); $('cleanBtn').setAttribute('aria-pressed', String(value)); }
  async function fullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  bind('panelToggle', 'click', () => togglePanel()); bind('cleanBtn', 'click', () => clean()); bind('fullscreenBtn', 'click', fullscreen);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { clean(false); togglePanel(true); return; }
    if (e.target.closest('input, select, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && e.target.closest('button')) return;
    const button = { ' ': 'playPauseBtn', r: 'replayBtn', m: 'muteBtn', h: 'cleanBtn', f: 'fullscreenBtn' }[e.key.toLowerCase()];
    if (button) { e.preventDefault(); $(button).click(); }
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); if (!locked() && [...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const file = e.dataTransfer.files[0]; if (file && !locked()) load(file).catch(report); });
  window.addEventListener('resize', () => {
    // Capture keeps a fixed canvas size; apply any window change after its
    // viewport is restored so the preview cannot remain stretched afterward.
    if (locked()) pendingResize = true;
    else size(innerWidth, innerHeight, Math.min(devicePixelRatio, 2));
  });
  scene.controls?.addEventListener('end', () => { if (!locked()) settings.cameraState = scene.getCameraState(); });
  // OrbitControls can dispatch change while rendering camera motion; repaint on
  // the next animation tick instead of recursively entering the renderer.
  scene.controls?.addEventListener('change', () => { if (!audio.isPlaying && !locked()) needsRepaint = true; });

  buildControls(); syncButtons(); drawFrame(0);
  let lastReport = performance.now(), rendered = 0;
  function animate(now) {
    if (!alive) return;
    requestAnimationFrame(animate);
    if (busy === 'exporting' || busy === 'loading' || busy === 'recording-setup' || busy === 'preparing' || busy === 'buffering') return;
    const position = finished ? audio.duration : audio.getPlaybackPosition();
    const target = audio.hasAudio ? Math.floor((position - baseTime) * 60 + 1e-6) : Math.floor((now - idleOrigin) / 1000 * 60);
    if (audio.isPlaying && isLoom(settings)) {
      loomAnalysis?.prefetch(position);
      if (!loomReady(position)) { bufferPlayback(position).catch(report); return; }
    }
    if ((audio.isPlaying || !audio.hasAudio) && target > frameIndex) {
      // A backgrounded tab can jump minutes ahead; reset rather than block the UI rebuilding stale frames.
      if (target - frameIndex > 120) rebuild(audio.hasAudio ? position : 0);
      else for (let index = frameIndex + 1; index <= target; index++) {
        const time = baseTime + index * DT;
        if (audio.hasAudio && isLoom(settings) && !loomReady(time)) { bufferPlayback(Math.max(position, time)).catch(report); break; }
        drawFrame(index); rendered++;
      }
    }
    if (needsRepaint && audio.hasAudio && !audio.isPlaying) { needsRepaint = false; scene.render(); }
    $('currentTime').textContent = formatTime(position);
    if (document.activeElement !== $('seek')) $('seek').value = audio.getProgress() * 1000;
    if (finished) $('seek').value = 1000;
    if (now - lastReport > 1000) { $('fps').textContent = `${Math.round(rendered * 1000 / (now - lastReport))} fps`; lastReport = now; rendered = 0; }
  }
  requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => { alive = false; referenceController?.abort(); disposeLoomAnalysis(); if (recorder.isRecording) recorder.stop(); audio.stop(); analysis.dispose(); exportScene?.dispose(); scene.dispose(); audio.context?.close(); }, { once: true });
  // Inspection and browser fixtures share the production transport and capture paths.
  const api = {
    audio, scene, capture, recorder, load, loadReference, selectPreset, exportVideo, toggleRecord, seek,
    setSetting(key, value) {
      if (locked()) return false;
      settings[key] = value;
      const result = settingsChanged(key);
      const complete = () => { buildControls(); syncButtons(); return true; };
      return result?.then ? result.then(complete) : complete();
    },
    get settings() { return settings; }, get locked() { return locked(); },
    get activeEffects() { return resolveEffectOrder(settings); },
    getState: () => ({ ready: true, locked: locked(), busy, presetId, settings: clone(settings), position: finished ? audio.duration : audio.getPlaybackPosition(), playing: audio.isPlaying, recording: recorder.isRecording, exporting: capture.isExporting, loom: loomAnalysis?.getInfo() || null, viewport: { ...viewport, canvasWidth: scene.canvas.width, canvasHeight: scene.canvas.height } }),
    waitForRecordingStop: () => new Promise(resolve => { recordingStopped = resolve; }),
  };
  window.dotGrid = api;
  if (new URLSearchParams(location.search).get('test') === '1') window.__dotGridTest = api;
  document.body.dataset.ready = 'true';
}

initialise().catch(error => { console.error(error); $('fatal').textContent = 'Dot Grid could not start: ' + error.message; $('fatal').style.display = 'flex'; });

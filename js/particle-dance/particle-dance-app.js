import { createAudioPlayback } from '../audio-playback.js';
import { createCaptureSession } from '../capture-export.js';
import { createParticleDanceScene } from './particle-dance-scene.js';
import { createMeshGridAnalysis } from '../mesh-grid/mesh-grid-analysis.js';
import { PARTICLE_CONTROLS, GLOBAL_CONTROLS, createSettings } from './particle-dance-settings.js';
import { PRESETS, DEFAULT_PRESET_ID } from './particle-dance-presets.js';
import { EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_NAMES, EFFECT_ORDER, resolveEffectOrder } from './particle-dance-effect-settings.js';
import { eligibleModulationTargets, createModulation, setModulationBound, MODULATION_CONTROLS, FREQUENCY_RANGES } from './particle-dance-modulation.js';

const $ = id => document.getElementById(id);
const DT = 1 / 60;
const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const browserBias = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !mobile ? 10 : 0;
const silentSamples = new Float32Array(1);
// Virtual silence keeps time-based modulation running in the unloaded preview.
const silentBuffer = { sampleRate: 48000, length: 1, duration: Number.MAX_SAFE_INTEGER, numberOfChannels: 1, getChannelData: () => silentSamples };
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const clone = value => structuredClone(value);

async function initialise() {
  let presetId = DEFAULT_PRESET_ID;
  let settings = createSettings(presetId);
  let busy = '';
  let finished = false;
  let baseTime = 0;
  let frameIndex = -1;
  let idleOrigin = performance.now();
  let needsRepaint = false;
  let exportScene = null;
  let exportAnalysis = null;
  let recordingStopped = null;
  let recordingError = null;
  let recordingSession = false;
  const expandedSections = new Map();
  let viewport = { width: innerWidth, height: innerHeight, pixelRatio: Math.min(devicePixelRatio, 2) };
  const audio = createAudioPlayback({ fftSize: settings.fftSize, maxFftSize: 32768 });
  const scene = createParticleDanceScene({ settings, ...viewport, interactive: true });
  $('stage').append(scene.canvas);
  let analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias });
  const canRecord = Boolean(globalThis.MediaRecorder && scene.canvas.captureStream);
  const canEncode = Boolean(globalThis.VideoEncoder && globalThis.AudioEncoder && globalThis.Mp4Muxer);
  const canExport = canEncode && Boolean(globalThis.showSaveFilePicker);
  $('capabilityStatus').textContent = !canRecord
    ? 'This browser does not support canvas recording.'
    : !canExport ? 'Full-track MP4 export needs desktop Chrome or Edge with file saving enabled. Record is available.' : 'MP4 export is available. Files stay on this device.';

  function status(message, live = audio.isPlaying) {
    $('statusText').textContent = message;
    $('statusLight').classList.toggle('live', live);
  }
  function report(error) { if (error?.name === 'AbortError') return; console.error(error); status(error.message || String(error), false); }
  function bind(id, event, handler) {
    $(id).addEventListener(event, e => { try { Promise.resolve(handler(e)).catch(report); } catch (error) { report(error); } });
  }
  // MediaRecorder marks itself inactive before its final asynchronous file write
  // completes. Keep this session exclusive until its onStop callback finishes.
  const locked = () => Boolean(busy || recordingSession || recorder.isRecording);
  function syncButtons() {
    const lock = locked();
    const savingRecording = recordingSession && !recorder.isRecording;
    for (const id of ['playPauseBtn', 'replayBtn', 'unloadBtn', 'seek']) $(id).disabled = !audio.hasAudio || lock;
    $('recordBtn').disabled = !audio.hasAudio || !canRecord || Boolean(busy) || recordingSession && !recorder.isRecording;
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
  }
  function size(width, height, pixelRatio) {
    viewport = { width, height, pixelRatio };
    scene.resize(width, height, pixelRatio);
    scene.render();
  }
  const capture = createCaptureSession({
    getCanvas: () => scene.canvas,
    getAudioTrack: () => audio.getRecordingAudioTrack(),
    saveViewport: () => ({ ...viewport }),
    // Export uses a second renderer; leave the preview's render targets untouched.
    applyViewport: () => {},
    applyRecordingViewport: (width, height) => size(width, height, 1 / (settings.renderScale || 1)),
    restoreViewport: saved => {
      if (saved.width !== viewport.width || saved.height !== viewport.height || saved.pixelRatio !== viewport.pixelRatio) {
        size(saved.width, saved.height, saved.pixelRatio);
      }
    },
    overlay: { root: $('exportOverlay'), status: $('exportStatus'), progress: $('exportProgressBar'), percent: $('exportPercent'), cancelBtn: $('exportCancelBtn') },
  });
  const recorder = globalThis.createRecorder({
    defaultFilename: 'particle-dance-recording',
    onStatus: message => status(message),
    onStart: () => { recordingSession = true; recordingError = null; busy = ''; syncButtons(); status('Recording · ' + audio.fileName); },
    onError: error => { recordingError = error; busy = 'saving'; syncButtons(); report(error); },
    onStop: error => {
      recordingError = error || recordingError;
      try { capture.onRecordingStopped(); }
      catch (restoreError) { recordingError ||= restoreError; report(restoreError); }
      finally {
        recordingSession = false; busy = ''; syncButtons();
        recordingStopped?.(recordingError); recordingStopped = null;
      }
    },
  });

  function rebuild(position = audio.getPlaybackPosition(), { camera = true } = {}) {
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
    const frame = analysis.frameAt(baseTime + index * DT, DT);
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
      await audio.resumeContext();
      if (finished) { audio.seek(0); finished = false; rebuild(0, { camera: false }); }
      audio.play({ fromStart: false, onEnded: ended });
      status(audio.fileName, true);
    }
    syncButtons();
  }
  async function load(file, { autoplay = true } = {}) {
    if (locked()) return;
    busy = 'loading'; syncButtons(); status('Decoding ' + file.name + '…', false);
    try {
      await audio.load(file);
      analysis.dispose();
      analysis = createMeshGridAnalysis(audio.buffer, settings, { browserBias });
      finished = false;
      rebuild(0, { camera: false });
      $('durationText').textContent = formatTime(audio.duration);
      if (autoplay) audio.play({ fromStart: true, onEnded: ended });
      status(audio.fileName, autoplay);
    } catch (error) {
      audio.unload(); analysis.dispose();
      analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias });
      finished = false; rebuild(0); $('durationText').textContent = '0:00';
      throw error;
    } finally { busy = ''; syncButtons(); }
  }
  function selectPreset(id) {
    if (locked()) return;
    presetId = id;
    settings = createSettings(id);
    scene.applyPreset(settings);
    analysis.setSettings(settings);
    audio.setFftSize(settings.fftSize);
    rebuild(audio.getPlaybackPosition(), { camera: false });
    buildControls();
    syncButtons();
  }
  function settingsChanged(key) {
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
    else if (PARTICLE_CONTROLS[key]?.structural) rebuild();
    else if (!audio.isPlaying) {
      // A paused edit updates geometry without advancing the audio position.
      const frame = analysis.frameAt(audio.hasAudio ? audio.getPlaybackPosition() : Math.max(0, frameIndex) * DT, 0);
      scene.step({ ...frame, time: Math.max(0, frameIndex) * DT }, 0);
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
        if (locked() || !Number.isFinite(source.valueAsNumber)) return;
        owner[key] = Math.max(spec.min, Math.min(spec.max, source.valueAsNumber));
        change(key);
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
        change(key);
      });
    }
    parent.append(row);
    return row;
  }
  function modulationTargets() {
    return eligibleModulationTargets(PARTICLE_CONTROLS, EFFECT_CONTROLS, settings, EFFECT_NAMES);
  }
  function pruneModulations() {
    const available = modulationTargets();
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
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Animate a particle slider or an enabled effect. Audio follows the music; the other modes follow playback time.'; parent.append(hint);
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
      const button = document.createElement('button'); button.textContent = index + 1; button.title = `Particle Dance variant ${index + 1}`;
      button.setAttribute('aria-label', `Variant ${index + 1}`); button.setAttribute('aria-pressed', String(preset.id === presetId));
      button.addEventListener('click', () => selectPreset(preset.id)); $('variants').append(button);
    }
    $('presetName').textContent = `Variant ${PRESETS.findIndex(p => p.id === presetId) + 1}`;
    for (const section of $('configControls').querySelectorAll('details')) expandedSections.set(section.dataset.section, section.open);
    $('configControls').replaceChildren();
    const particles = group('Particles & colour', true);
    for (const [key, spec] of Object.entries(PARTICLE_CONTROLS)) control(particles, key, spec);
    for (const title of ['Audio', 'Camera', 'Background', 'Rendering']) {
      const parent = group(title);
      for (const [key, spec] of Object.entries(GLOBAL_CONTROLS)) if (spec.group === title) control(parent, key, spec);
    }
    const effects = group('Post-processing');
    control(effects, 'enablePostProcessing', { type: 'boolean', label: 'Enable post-processing', default: false });
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
    for (const row of $('configControls').querySelectorAll('.config-row')) row.hidden = Boolean(query && !row.dataset.search.includes(query));
    for (const details of [...$('configControls').querySelectorAll('details')].reverse()) {
      details.hidden = Boolean(query && ![...details.querySelectorAll('.config-row')].some(row => !row.hidden));
      if (query && !details.hidden) details.open = true;
    }
  }

  async function toggleRecord({ writable } = {}) {
    if (recorder.isRecording) { busy = 'saving'; recorder.stop(); syncButtons(); return; }
    if (locked() || !audio.hasAudio || !canRecord) return;
    busy = 'recording-setup'; syncButtons();
    let prepared;
    try {
      const choosing = writable ? Promise.resolve({ writable, codec: recorder.getCodec() }) : recorder.prepareAutoRecord();
      await audio.suspendContext();
      prepared = await choosing;
      if (!prepared) return;
      if (finished) { audio.seek(0); finished = false; rebuild(0, { camera: false }); }
      // Start capture before playback so the opening audio transient is included.
      recorder.startAutoRecord(prepared, () => capture.makeRecordingStream());
      await audio.resumeContext();
      if (!audio.isPlaying) audio.play({ fromStart: false, onEnded: ended });
    } catch (error) {
      if (recorder.isRecording) recorder.stop();
      else await prepared?.writable?.abort?.();
      capture.onRecordingStopped(); throw error;
    } finally {
      try { await audio.resumeContext(); }
      finally { busy = recordingSession && !recorder.isRecording ? 'saving' : ''; syncButtons(); }
    }
  }
  async function exportVideo({ writable } = {}) {
    if (locked() || !audio.hasAudio || !canEncode || (!writable && !canExport)) return { ok: false, reason: 'unavailable' };
    busy = 'exporting'; syncButtons();
    try {
      const choosing = writable ? Promise.resolve(writable) : capture.pickWritable('particle-dance.mp4', report);
      await audio.suspendContext();
      const destination = await choosing;
      if (!destination) return { ok: false, reason: 'cancelled' };
      const snapshot = clone(settings);
      snapshot.cameraState = scene.getCameraState();
      // The encoder receives 1080p regardless of the interactive preview scale.
      snapshot.renderScale = 1;
      return await capture.runOfflineExport({
        audio, suggestedName: 'particle-dance.mp4', pendingWritable: destination,
        onStatus: message => status(message), labels: { rendering: 'Rendering Particle Dance…' },
        prepare() {
          exportAnalysis = createMeshGridAnalysis(audio.buffer, snapshot, { browserBias });
          exportScene = createParticleDanceScene({ settings: snapshot, width: 1920, height: 1080, pixelRatio: 1, interactive: false });
          $('exportCancelBtn').focus();
        },
        restore() {
          try { exportScene?.dispose(); }
          finally { exportScene = null; exportAnalysis?.dispose(); exportAnalysis = null; }
        },
        analysisProvider: (index, dt) => exportAnalysis.frameAt(index * dt, dt),
        renderFrame: (spectrum, dt, frame) => exportScene.step(frame, dt),
        readCanvas: () => exportScene.canvas,
        gpuFinish: () => exportScene.renderer.getContext().finish(),
      });
    } finally {
      try { await audio.resumeContext(); }
      finally { busy = ''; syncButtons(); $('exportBtn').focus(); }
    }
  }

  bind('fileInput', 'change', async e => { const file = e.target.files[0]; try { if (file) await load(file); } finally { e.target.value = ''; } });
  document.querySelector('.file-picker').addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key) && !locked()) { e.preventDefault(); $('fileInput').click(); } });
  async function loadReference() {
    if (locked()) return;
    busy = 'fetching'; syncButtons(); status('Loading reference track…', false);
    let file;
    try { await audio.resumeContext(); const response = await fetch('reference.mp3'); if (!response.ok) throw new Error('Reference track unavailable. Choose an audio file instead.'); file = new File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' }); }
    finally { busy = ''; syncButtons(); }
    await load(file);
  }
  bind('referenceBtn', 'click', loadReference);
  bind('playPauseBtn', 'click', playPause);
  bind('replayBtn', 'click', async () => { if (locked() || !audio.hasAudio) return; await audio.resumeContext(); audio.seek(0); finished = false; rebuild(0, { camera: false }); audio.play({ fromStart: true, onEnded: ended }); syncButtons(); status(audio.fileName, true); });
  bind('unloadBtn', 'click', () => { if (locked()) return; audio.unload(); analysis.dispose(); analysis = createMeshGridAnalysis(silentBuffer, settings, { browserBias }); finished = false; rebuild(0); $('fileInput').value = ''; $('durationText').textContent = '0:00'; syncButtons(); status('Choose an audio file or load the reference track', false); });
  function seek(seconds) {
    if (locked() || !audio.hasAudio || !Number.isFinite(seconds)) return false;
    const time = Math.max(0, Math.min(audio.duration, seconds));
    audio.seek(time); finished = time >= audio.duration; rebuild(time); status(audio.fileName); syncButtons(); return true;
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
  window.addEventListener('resize', () => { if (!locked()) size(innerWidth, innerHeight, Math.min(devicePixelRatio, 2)); });
  scene.controls?.addEventListener('end', () => { if (!locked()) settings.cameraState = scene.getCameraState(); });
  // OrbitControls can dispatch change while rendering camera motion; repaint on
  // the next animation tick instead of recursively entering the renderer.
  scene.controls?.addEventListener('change', () => { if (!audio.isPlaying && !locked()) needsRepaint = true; });

  buildControls(); syncButtons(); drawFrame(0);
  let lastReport = performance.now(), rendered = 0, alive = true;
  function animate(now) {
    if (!alive) return;
    requestAnimationFrame(animate);
    if (busy === 'exporting' || busy === 'loading' || busy === 'recording-setup') return;
    const position = finished ? audio.duration : audio.getPlaybackPosition();
    const target = audio.hasAudio ? Math.floor((position - baseTime) * 60 + 1e-6) : Math.floor((now - idleOrigin) / 1000 * 60);
    if ((audio.isPlaying || !audio.hasAudio) && target > frameIndex) {
      // A backgrounded tab can jump minutes ahead; reset rather than block the UI rebuilding stale frames.
      if (target - frameIndex > 120) rebuild(audio.hasAudio ? position : 0);
      else for (let index = frameIndex + 1; index <= target; index++) { drawFrame(index); rendered++; }
    }
    if (needsRepaint && audio.hasAudio && !audio.isPlaying) { needsRepaint = false; scene.render(); }
    $('currentTime').textContent = formatTime(position);
    if (document.activeElement !== $('seek')) $('seek').value = audio.getProgress() * 1000;
    if (finished) $('seek').value = 1000;
    if (now - lastReport > 1000) { $('fps').textContent = `${Math.round(rendered * 1000 / (now - lastReport))} fps`; lastReport = now; rendered = 0; }
  }
  requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => { alive = false; if (recorder.isRecording) recorder.stop(); audio.stop(); analysis.dispose(); exportScene?.dispose(); scene.dispose(); audio.context?.close(); }, { once: true });
  // Public review surface; normal user actions and browser fixtures share production paths.
  window.particleDance = {
    audio, scene, capture, recorder, load, loadReference, selectPreset, exportVideo, toggleRecord, seek,
    setSetting(key, value) { if (locked()) return false; settings[key] = value; settingsChanged(key); buildControls(); syncButtons(); return true; },
    get settings() { return settings; }, get locked() { return locked(); },
    get activeEffects() { return resolveEffectOrder(settings); },
    getState: () => ({ ready: true, locked: locked(), busy, presetId, settings: clone(settings), position: finished ? audio.duration : audio.getPlaybackPosition(), playing: audio.isPlaying, recording: recorder.isRecording, exporting: capture.isExporting, viewport: { ...viewport, canvasWidth: scene.canvas.width, canvasHeight: scene.canvas.height } }),
    waitForRecordingStop: () => new Promise(resolve => { recordingStopped = resolve; }),
  };
  document.body.dataset.ready = 'true';
}

initialise().catch(error => { console.error(error); $('fatal').textContent = 'Particle Dance could not start: ' + error.message; $('fatal').style.display = 'flex'; });

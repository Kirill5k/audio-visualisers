"use strict";

// =====================================================
// Shared visualizer shell
// -----------------------------------------------------
// Owns everything that is identical across visualizers:
//   - the control-panel DOM + styling
//   - audio context / analyser / file loading / replay
//   - the 1080p MediaRecorder capture (recorder.js)
//   - the deterministic offline MP4 export (offline-exporter.js)
//   - FPS counter, fullscreen, panel toggle
//   - the requestAnimationFrame loop
//
// A visualizer provides a scene via createVizShell({...}).start(viz):
//   viz.renderer        THREE.WebGLRenderer (its canvas is captured)
//   viz.camera          camera (aspect is managed for record/export)
//   viz.render(delta)   update + renderer.render(...) for one frame
//   viz.onResize(w,h)   optional: update aspect / resolution uniforms
//   viz.onAudioStart()  optional: called when a track starts playing
//   viz.onExportReset() optional: reset state for a clean export start
//
// The shell exposes the shared audio signals on `.audio`
// (see audio-reactivity.js); the visualizer reads them inside
// its render() each frame.
// =====================================================

function createVizShell(config) {
  config = config || {};
  const title = config.title || 'Audio Visualizer';
  const defaultFilename = config.defaultFilename || 'visualizer';
  const exportFilename = config.exportFilename || (defaultFilename + '_export.mp4');

  injectStyles();
  if (config.title) document.title = title;

  const dom = buildDOM(config);

  // ---------------- Audio ----------------
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = config.fftSize || 2048;
  analyser.smoothingTimeConstant = config.smoothing != null ? config.smoothing : 0.85;
  const frequencyData = new Uint8Array(analyser.frequencyBinCount);

  const audio = createAudioReactivity({
    sampleRate: audioContext.sampleRate,
    fftSize: analyser.fftSize,
    bins: analyser.frequencyBinCount,
  });

  let audioBuffer = null;
  let audioSource = null;
  let audioStarted = false;
  let audioDestNode = null;

  // ---------------- Render hookup ----------------
  let viz = null;
  let glCtx = null;
  let offlineExporting = false;

  // ---------------- Recording ----------------
  let videoTrack = null;
  let lastCaptureMs = 0;
  let preRecordWidth = 0;
  let preRecordHeight = 0;
  let preRecordPixelRatio = 1;
  let lockRecordingFps = false;

  const recorder = createRecorder({
    defaultFilename: defaultFilename + '_1080p',
    onStart: () => {
      const btn = dom.recordBtn;
      btn.textContent = '\u23F9 Stop';
      btn.classList.add('recording');
    },
    onStop: () => {
      const btn = dom.recordBtn;
      btn.textContent = '\u23FA Record';
      btn.classList.remove('recording');
      try { analyser.disconnect(audioDestNode); } catch (e) {}
      audioDestNode = null;
      videoTrack = null;
      viz.renderer.setPixelRatio(preRecordPixelRatio);
      viz.renderer.setSize(preRecordWidth, preRecordHeight);
      if (viz.onResize) viz.onResize(preRecordWidth, preRecordHeight);
    },
  });

  function makeRecordingStream() {
    preRecordWidth = window.innerWidth;
    preRecordHeight = window.innerHeight;
    preRecordPixelRatio = viz.renderer.getPixelRatio();

    viz.renderer.setPixelRatio(1);
    viz.renderer.setSize(1920, 1080);
    if (viz.onResize) viz.onResize(1920, 1080);

    const canvas = viz.renderer.domElement;
    const videoStream = canvas.captureStream(0);
    videoTrack = videoStream.getVideoTracks()[0];
    lastCaptureMs = 0;

    const audioStreamDest = audioContext.createMediaStreamDestination();
    audioDestNode = audioStreamDest;
    analyser.connect(audioStreamDest);

    const audioTrack = audioStreamDest.stream.getAudioTracks()[0];
    if (audioTrack) videoStream.addTrack(audioTrack);

    return videoStream;
  }

  // ---------------- Frame tick ----------------
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let lastTickTime = performance.now();
  const clock = { last: performance.now(), getDelta() {
    const now = performance.now();
    const d = (now - this.last) / 1000;
    this.last = now;
    return d;
  }};

  function tickFrame(delta) {
    if (!offlineExporting) analyser.getByteFrequencyData(frequencyData);
    audio.update(frequencyData, delta);
    viz.render(delta);
    if (recorder.isRecording) glCtx.finish();

    const now = performance.now();
    fpsElapsed += now - lastTickTime;
    lastTickTime = now;
    fpsFrames++;
    if (fpsElapsed >= 500) {
      dom.fpsCounter.textContent = Math.round(fpsFrames / (fpsElapsed / 1000)) + ' fps';
      fpsFrames = 0;
      fpsElapsed = 0;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    if (offlineExporting) { clock.getDelta(); return; }
    const now = performance.now();
    if (recorder.isRecording && lockRecordingFps && now - lastCaptureMs < 16.5) return;
    const delta = recorder.isRecording ? (1 / 60) : clock.getDelta();
    tickFrame(delta);
    if (recorder.isRecording && videoTrack) {
      videoTrack.requestFrame();
      lastCaptureMs = now;
    }
  }

  // ---------------- Audio playback ----------------
  function startPlayback() {
    if (audioSource) {
      try { audioSource.stop(); } catch (e) {}
      try { audioSource.disconnect(); } catch (e) {}
    }
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);
    audioSource.start();
    audioStarted = true;
    if (viz && viz.onAudioStart) viz.onAudioStart();
  }

  dom.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const autoExport = dom.autoExportToggle.checked;
    const autoRecord = dom.autoRecordToggle.checked;

    let writable;
    if (autoExport) {
      if (offlineExporting) return;
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: exportFilename,
          types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
        });
        writable = await handle.createWritable();
      } catch (err) { return; }
    }

    let prepared;
    if (autoRecord && !autoExport) {
      prepared = await recorder.prepareAutoRecord();
      if (!prepared) return;
    }

    await audioContext.resume();
    audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());

    if (autoExport) {
      dom.exportBtn.writable = writable;
      dom.exportBtn.click();
      return;
    }

    startPlayback();

    if (prepared && !recorder.isRecording) {
      recorder.startAutoRecord(prepared, makeRecordingStream);
    }
  });

  dom.replayBtn.addEventListener('click', () => {
    if (!audioBuffer) { alert('Load an audio file first.'); return; }
    if (offlineExporting || recorder.isRecording) return;
    startPlayback();
  });

  dom.unloadBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    if (offlineExporting || recorder.isRecording) return;
    if (audioSource) {
      try { audioSource.stop(); } catch (e) {}
      try { audioSource.disconnect(); } catch (e) {}
      audioSource = null;
    }
    audioBuffer = null;
    audioStarted = false;
    dom.fileInput.value = '';
  });

  dom.recordBtn.addEventListener('click', () => {
    recorder.toggle(makeRecordingStream);
  });

  dom.fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  });

  dom.lock60fpsToggle.addEventListener('change', (e) => {
    lockRecordingFps = e.target.checked;
  });

  dom.togglePanel.addEventListener('click', (e) => {
    const ui = dom.ui;
    const btn = e.target;
    if (ui.classList.contains('hidden')) {
      ui.classList.remove('hidden');
      btn.classList.add('shifted');
      btn.textContent = '\u2630 Hide Panel';
    } else {
      ui.classList.add('hidden');
      btn.classList.remove('shifted');
      btn.textContent = '\u2630 Show Panel';
    }
  });

  window.addEventListener('resize', () => {
    if (recorder.isRecording || offlineExporting) return;
    viz.renderer.setSize(window.innerWidth, window.innerHeight);
    if (viz.onResize) viz.onResize(window.innerWidth, window.innerHeight);
  });

  // ---------------- Offline export ----------------
  let exportCancelled = false;
  dom.exportCancelBtn.addEventListener('click', () => {
    exportCancelled = true;
    dom.exportStatus.textContent = 'Cancelling...';
  });

  dom.exportBtn.addEventListener('click', async () => {
    if (!audioBuffer) { alert('Load an audio file first.'); return; }
    if (offlineExporting) return;

    const btn = dom.exportBtn;
    const writable = btn.writable || await (async () => {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: exportFilename,
          types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
        });
        return await handle.createWritable();
      } catch (e) { return null; }
    })();
    btn.writable = null;
    if (!writable) return;

    dom.exportOverlay.style.display = 'flex';
    exportCancelled = false;

    const savedWidth = viz.renderer.domElement.width;
    const savedHeight = viz.renderer.domElement.height;
    viz.renderer.setSize(1920, 1080);
    if (viz.onResize) viz.onResize(1920, 1080);

    audio.reset();
    if (viz.onExportReset) viz.onExportReset();

    offlineExporting = true;
    await audioContext.suspend();

    try {
      await offlineExport({
        audioBuffer,
        fps: 60,
        width: 1920,
        height: 1080,
        fftSize: analyser.fftSize,
        smoothingTimeConstant: analyser.smoothingTimeConstant,
        minDecibels: analyser.minDecibels,
        maxDecibels: analyser.maxDecibels,
        writable,
        isCancelled: () => exportCancelled,
        renderFrame: (fftData, delta) => {
          frequencyData.set(fftData);
          tickFrame(delta);
        },
        readCanvas: () => viz.renderer.domElement,
        gpuFinish: () => glCtx.finish(),
        onProgress: (frac) => {
          const pct = Math.round(frac * 100);
          dom.exportProgressBar.style.width = pct + '%';
          dom.exportPercent.textContent = pct + '%';
          const totalFrames = Math.ceil(audioBuffer.duration * 60);
          dom.exportStatus.textContent = 'Exporting... frame ' +
            Math.round(frac * totalFrames) + '/' + totalFrames;
        },
        onDone: () => {
          dom.exportStatus.textContent = 'Export complete!';
          setTimeout(() => { dom.exportOverlay.style.display = 'none'; }, 1500);
        },
      });
    } catch (err) {
      console.error('Export error:', err);
      dom.exportStatus.textContent = 'Export failed: ' + err.message;
      setTimeout(() => { dom.exportOverlay.style.display = 'none'; }, 3000);
    }

    offlineExporting = false;
    await audioContext.resume();

    if (viz.onExportReset) viz.onExportReset();
    viz.renderer.setSize(savedWidth, savedHeight);
    if (viz.onResize) viz.onResize(savedWidth, savedHeight);
  });

  // ---------------- Public API ----------------
  return {
    audio,
    analyser,
    frequencyData,
    audioContext,
    get audioStarted() { return audioStarted; },
    get isRecording() { return recorder.isRecording; },
    get isExporting() { return offlineExporting; },
    start(v) {
      viz = v;
      glCtx = viz.renderer.getContext();
      animate();
    },
  };

  // ===================================================
  // DOM building
  // ===================================================
  function buildDOM(cfg) {
    const togglePanel = el('button', { id: 'togglePanel', class: 'shifted' }, '\u2630 Hide Panel');
    document.body.appendChild(togglePanel);

    const fpsCounter = el('div', { id: 'fpsCounter' }, '-- fps');
    const replayBtn = el('button', { class: 'top-btn' }, '\u23EE Replay');
    const unloadBtn = el('button', { class: 'top-btn' }, '\u23CF Unload');
    const recordBtn = el('button', { class: 'top-btn' }, '\u23FA Record');
    const exportBtn = el('button', { class: 'top-btn' }, '\u2B07 Export');
    const fullscreenBtn = el('button', { class: 'top-btn' }, '\u26F6 Fullscreen');
    const topRight = el('div', { class: 'top-right-buttons' },
      [fpsCounter, replayBtn, unloadBtn, recordBtn, exportBtn, fullscreenBtn]);
    document.body.appendChild(topRight);

    // Export overlay
    const exportStatus = el('div', { style: 'font-size:18px; margin-bottom:16px;' }, 'Exporting...');
    const exportProgressBar = el('div', { id: 'exportProgressBar', style: 'width:0%; height:100%; background:#4af; transition:width 0.1s;' });
    const progressOuter = el('div', { style: 'width:400px; height:8px; background:#333; border-radius:4px; overflow:hidden;' }, [exportProgressBar]);
    const exportPercent = el('div', { style: 'font-size:14px; margin-top:8px; color:#aaa;' }, '0%');
    const exportCancelBtn = el('button', { style: 'margin-top:20px; padding:8px 20px; cursor:pointer; background:#c33; border:none; color:#fff; border-radius:4px; font-size:14px;' }, 'Cancel');
    const exportOverlay = el('div', { id: 'exportOverlay', style: 'display:none; position:fixed; inset:0; z-index:9999; background:rgba(0,0,0,0.85); align-items:center; justify-content:center; flex-direction:column; color:#fff; font-family:Arial,sans-serif;' },
      [exportStatus, progressOuter, exportPercent, exportCancelBtn]);
    document.body.appendChild(exportOverlay);

    // Control panel
    const ui = el('div', { id: 'ui' });
    const fileInput = el('input', { type: 'file', accept: 'audio/*' });
    fileInput.id = 'fileInput';
    ui.appendChild(fileInput);

    const controlRefs = {};
    (cfg.controls || []).forEach((c) => renderControl(ui, c, controlRefs));

    // Built-in Recording section (parity with 3dspectrogram)
    ui.appendChild(sectionLabel('Recording'));
    const autoRecordToggle = checkboxRow(ui, 'Record on Play');
    const autoExportToggle = checkboxRow(ui, 'Export on Play');
    const lock60fpsToggle = checkboxRow(ui, 'Lock 60fps');

    document.body.appendChild(ui);

    return {
      togglePanel, fpsCounter, replayBtn, unloadBtn, recordBtn, exportBtn, fullscreenBtn,
      exportOverlay, exportStatus, exportProgressBar, exportPercent, exportCancelBtn,
      ui, fileInput, autoRecordToggle, autoExportToggle, lock60fpsToggle, controls: controlRefs,
    };
  }

  function renderControl(parent, c, refs) {
    if (c.type === 'section') {
      parent.appendChild(sectionLabel(c.label));
    } else if (c.type === 'info') {
      parent.appendChild(el('div', { style: 'font-size:12px; color:#888; margin-top:4px;' }, c.text));
    } else if (c.type === 'slider') {
      const valSpan = el('span', {}, fmt(c, c.value));
      const label = el('label', {}, [document.createTextNode(c.label + ': '), valSpan]);
      const input = el('input', {
        type: 'range', min: String(c.min), max: String(c.max),
        step: String(c.step != null ? c.step : 1), value: String(c.value),
      });
      input.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        valSpan.textContent = fmt(c, v);
        if (c.onChange) c.onChange(v);
      });
      parent.appendChild(label);
      parent.appendChild(input);
      if (c.id) refs[c.id] = input;
    } else if (c.type === 'checkbox') {
      const input = checkboxRow(parent, c.label, c.value);
      if (c.onChange) input.addEventListener('change', (e) => c.onChange(e.target.checked));
      if (c.id) refs[c.id] = input;
    } else if (c.type === 'color') {
      const input = el('input', { type: 'color', value: c.value });
      const row = el('div', { class: 'color-row' }, [input, el('span', {}, c.label)]);
      if (c.onChange) input.addEventListener('input', (e) => c.onChange(e.target.value));
      parent.appendChild(row);
      if (c.id) refs[c.id] = input;
    }
  }

  function fmt(c, v) {
    if (c.format) return c.format(v);
    return (c.step != null && c.step < 1) ? v.toFixed(2) : String(Math.round(v));
  }

  function sectionLabel(text) {
    return el('div', { class: 'section-label' }, text);
  }

  function checkboxRow(parent, labelText, checked) {
    const input = el('input', { type: 'checkbox' });
    if (checked) input.checked = true;
    const row = el('div', { class: 'checkbox-row' }, [input, el('span', {}, labelText)]);
    parent.appendChild(row);
    return input;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) children.forEach((ch) => node.appendChild(ch));
      else node.appendChild(children);
    }
    return node;
  }
}

function injectStyles() {
  if (document.getElementById('viz-shell-styles')) return;
  const style = document.createElement('style');
  style.id = 'viz-shell-styles';
  style.textContent = `
    body { margin: 0; overflow: hidden; background: #020305; font-family: Arial, sans-serif; }
    #ui {
      position: absolute; top: 20px; left: 20px; z-index: 100;
      background: rgba(0,0,0,0.7); color: white; padding: 14px;
      border-radius: 12px; width: 260px; backdrop-filter: blur(10px);
      max-height: calc(100vh - 40px); overflow-y: auto;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    #ui.hidden { transform: translateX(-280px); opacity: 0; pointer-events: none; }
    #togglePanel {
      position: absolute; top: 20px; left: 20px; z-index: 200;
      background: rgba(0,0,0,0.7); color: white; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer;
      backdrop-filter: blur(10px); transition: left 0.3s ease;
    }
    #togglePanel.shifted { left: 290px; }
    .top-right-buttons { position: absolute; top: 20px; right: 20px; z-index: 200; display: flex; gap: 8px; }
    .top-btn {
      background: rgba(0,0,0,0.7); color: white; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; backdrop-filter: blur(10px);
    }
    .top-btn:hover { background: rgba(255,255,255,0.1); }
    #fpsCounter {
      background: rgba(0,0,0,0.7); color: #aaa; border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px; padding: 8px 12px; font-size: 13px; backdrop-filter: blur(10px);
      min-width: 60px; text-align: center; pointer-events: none;
    }
    .top-btn.recording { background: rgba(200,0,0,0.7); border-color: rgba(255,100,100,0.5); }
    input[type="range"] { width: 100%; }
    label { display: block; margin-top: 12px; margin-bottom: 6px; font-size: 14px; }
    .checkbox-row { display: flex; align-items: center; margin-top: 10px; font-size: 14px; gap: 8px; }
    .checkbox-row input[type="checkbox"] { width: 16px; height: 16px; }
    .color-row { display: flex; align-items: center; margin-top: 8px; gap: 10px; font-size: 13px; }
    .color-row input[type="color"] { width: 36px; height: 28px; border: none; border-radius: 4px; cursor: pointer; background: none; padding: 0; }
    .section-label {
      margin-top: 16px; margin-bottom: 4px; font-size: 12px; text-transform: uppercase;
      letter-spacing: 0.5px; color: #888; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;
    }
    canvas { display: block; }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') window.createVizShell = createVizShell;

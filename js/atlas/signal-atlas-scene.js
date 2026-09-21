import * as THREE from 'three';
import { createWaveformMinimap, rectToWorld } from '../monitor-charts.js';
import { createSpectralHistory, createSpectralSampling } from '../terrain/spectral-history.js';
import { formatTrackTime } from './signal-atlas-setlist.js';
import { createSpectrogramPalette } from './signal-atlas-color.js';
import { createAtlasInstruments, INSTRUMENT_RECTS, INSTRUMENT_VISIBLE_EDGES, INSTRUMENT_LABEL_RECTS } from './signal-atlas-instruments.js';
import { ATLAS_COLORS as C, paletteRgba } from './signal-atlas-palette.js';

const BINS = 16384;
const FPS = 60;
const BLACK = new THREE.Color(C.black);
const RECTS = {
  // Split the .1176 height released by the first row equally between these rows.
  curtain: { x: .06, y: .4014, w: .88, h: .1518 },
  overview: { x: .06, y: .5922, w: .88, h: .1188 },
};

const spectralSampling = createSpectralSampling();

export function createSignalAtlasScene(stage, settings) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setClearColor(BLACK, 1);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  if (renderer.capabilities.maxTextureSize < BINS) {
    renderer.dispose();
    throw new Error('Signal Atlas requires a GPU supporting 16,384-pixel textures at master quality.');
  }
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Phase scope, stereo spectrum analyzer, peak dBFS meter, spectrogram and track progress');

  let width = 1920, height = 1080, ratio = 1, aspect = 16 / 9;
  let disposed = false;
  let lastLabels = '';
  let labelState = null;
  const history = createSpectralHistory(renderer);

  const common = {
    uHistory: { value: history.texture },
    uPeakTree: { value: history.peakTreeTexture },
    uFrame: { value: 0 },
    uSampleRate: { value: 48000 },
    uGain: { value: settings.gain },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 50 / aspect, -50 / aspect, -10, 10);
  camera.position.z = 5;
  const palette = new THREE.DataTexture(createSpectrogramPalette(), 1024, 1, THREE.RGBAFormat);
  palette.minFilter = THREE.NearestFilter;
  palette.magFilter = THREE.NearestFilter;
  palette.generateMipmaps = false;
  palette.needsUpdate = true;
  // Values are already display RGB, as are the original history shader colors.
  const curtainMaterial = new THREE.ShaderMaterial({
    uniforms: { ...common, uDisplayHeight: { value: 200 }, uPalette: { value: palette } },
    depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `${spectralSampling}
      uniform float uDisplayHeight;
      uniform sampler2D uPalette;
      varying vec2 vUv;
      void main() {
        float time = uFrame - (1.0 - vUv.x) * 1440.0;
        float band = vUv.y;
        float value = spectrum(band, .5 / uDisplayHeight, time);
        float signal=max(0.0,value-.15)*uGain*1.55;
        float light=1.0-exp(-signal*signal);
        vec3 color=texture2D(uPalette,vec2((floor(clamp(light,0.0,1.0)*1023.0)+.5)/1024.0,.5)).rgb;
        color*=smoothstep(.005,.07,light);
        color*=mix(.58,1.0,pow(vUv.x,.65));
        gl_FragColor=vec4(color,1.0);
      }
    `,
  });
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), curtainMaterial);
  scene.add(curtain);

  const minimap = createWaveformMinimap(scene, RECTS.overview, { color: C.ivory,
    playedColor: C.copper, playheadColor: C.ivory,
    barWidth: 2.3, barGap: .32 });
  const instruments = createAtlasInstruments(scene, settings);

  const labelsCanvas = document.createElement('canvas');
  // Keep text rasterization in a CPU backing store before uploading the
  // changing labels to the shared WebGL output.
  const labelsCtx = labelsCanvas.getContext('2d', { willReadFrequently: true });
  let labelsTexture = new THREE.CanvasTexture(labelsCanvas);
  labelsTexture.colorSpace = THREE.SRGBColorSpace;
  labelsTexture.minFilter = THREE.LinearFilter;
  labelsTexture.generateMipmaps = false;
  const labelsMaterial = new THREE.MeshBasicMaterial({ map: labelsTexture, transparent: true, depthTest: false, depthWrite: false });
  const labelsMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100 / aspect), labelsMaterial);
  labelsMesh.renderOrder = 100;
  scene.add(labelsMesh);

  const instrumentRect = INSTRUMENT_LABEL_RECTS.static;
  const instrumentLayers = Object.entries(INSTRUMENT_LABEL_RECTS).map(([name, rect]) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = name === 'static' ? 101 : 102;
    scene.add(mesh);
    return { name, rect, canvas, ctx, material, mesh, texture: null, key: '', uploads: 0, pixels: null };
  });

  function resizeInstrumentLabels() {
    // Crops use the same integer pixel grid as the original full instrument
    // canvas, preserving glyph rasterization at every preview/export size.
    const baseWidth = Math.max(1, Math.round(width * ratio * instrumentRect.w));
    const baseHeight = Math.max(1, Math.round(height * ratio * instrumentRect.h));
    for (const layer of instrumentLayers) {
      const { rect, canvas, material, mesh } = layer;
      const x = Math.max(0, Math.floor((rect.x - instrumentRect.x) / instrumentRect.w * baseWidth));
      const y = Math.max(0, Math.floor((rect.y - instrumentRect.y) / instrumentRect.h * baseHeight));
      const right = Math.min(baseWidth, Math.ceil((rect.x + rect.w - instrumentRect.x) / instrumentRect.w * baseWidth));
      const bottom = Math.min(baseHeight, Math.ceil((rect.y + rect.h - instrumentRect.y) / instrumentRect.h * baseHeight));
      const w = Math.max(1, right - x), h = Math.max(1, bottom - y);
      if (!layer.texture || canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        layer.texture?.dispose();
        layer.texture = new THREE.CanvasTexture(canvas);
        layer.texture.colorSpace = THREE.SRGBColorSpace;
        layer.texture.minFilter = THREE.LinearFilter;
        layer.texture.generateMipmaps = false;
        material.map = layer.texture;
        material.needsUpdate = true;
      }
      layer.pixels = { x, y, baseWidth, baseHeight };
      const box = rectToWorld({
        x: instrumentRect.x + x / baseWidth * instrumentRect.w,
        y: instrumentRect.y + y / baseHeight * instrumentRect.h,
        w: w / baseWidth * instrumentRect.w,
        h: h / baseHeight * instrumentRect.h,
      }, aspect, 0);
      mesh.scale.set(box.width, box.height, 1);
      mesh.position.set(box.cx, box.cy, 0);
      layer.key = '';
    }
  }

  function drawInstrumentLabels() {
    const keys = instruments.getLabelKeys();
    for (const layer of instrumentLayers) {
      const key = keys[layer.name];
      if (key === layer.key) continue;
      layer.key = key;
      const { ctx, canvas, pixels } = layer;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(-pixels.x, -pixels.y);
      ctx.scale(pixels.baseWidth / (1920 * instrumentRect.w), pixels.baseHeight / (1080 * instrumentRect.h));
      ctx.translate(-instrumentRect.x * 1920, -instrumentRect.y * 1080);
      instruments.drawLabels(ctx, layer.name);
      ctx.restore();
      layer.texture.needsUpdate = true;
      layer.uploads++;
    }
  }

  let markerEntries = null;
  let markerVersion = 0;
  function drawLabels(time, analysis) {
    const hasAudio = Boolean(analysis?.buffer);
    if (markerEntries !== settings.setlist) { markerEntries = settings.setlist; markerVersion++; }
    const key = [Math.floor(time), Math.floor((analysis?.duration || 0) - time), analysis?.duration || 0,
      settings.labels, settings.gridOpacity, width, height, ratio, markerVersion].join('|');
    if (key === lastLabels) return;
    lastLabels = key;
    const duration = hasAudio ? analysis.duration : 0;
    const timeOptions = { forceHours: duration >= 3600 };
    const elapsedText = formatTrackTime(hasAudio ? time : 0, timeOptions);
    const remainingText = `−${formatTrackTime(hasAudio ? duration - time : 0, timeOptions)}`;
    labelState = { time, hasAudio, duration: analysis?.duration, elapsedText, remainingText, markerCount: hasAudio ? markerEntries?.length || 0 : 0, key };
    const ctx = labelsCtx;
    const w = labelsCanvas.width, h = labelsCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(w / 1920, h / 1080);
    const rule = (x1, y1, x2, y2, alpha = settings.gridOpacity) => {
      ctx.strokeStyle = paletteRgba(C.silver, alpha); ctx.lineWidth = .75;
      ctx.beginPath(); ctx.moveTo(x1 * 1920, y1 * 1080); ctx.lineTo(x2 * 1920, y2 * 1080); ctx.stroke();
    };
    rule(.06,.073,.94,.073);
    const scopeDividerX = (INSTRUMENT_VISIBLE_EDGES.scopeRight + INSTRUMENT_RECTS.analyzer.x) / 2;
    rule(scopeDividerX,.097,scopeDividerX,.3592,settings.gridOpacity*.7);

    rule(.06,.3704,.94,.3704);
    rule(.06,.5662,.94,.5662);
    if (settings.labels) {
      const label = (text, x, y, color = C.pearl, size = 13, align = 'left') => {
        ctx.fillStyle = color;
        ctx.font = `500 ${size}px "Inter", sans-serif`;
        ctx.textAlign = align;
        ctx.fillText(text, x * 1920, y * 1080);
      };
      label('S I G N A L   A T L A S', .06, .052, C.pearl, 18);
      label(hasAudio ? `STEREO STUDY  /  ${(analysis.sampleRate / 1000).toFixed(1)} kHz` : 'AN AUDIOVISUAL INSTRUMENT', .94, .051, C.silver, 10, 'right');
      label('01   PHASE SCOPE', .06, .096);
      label('02   SPECTRUM ANALYZER', INSTRUMENT_RECTS.analyzer.x, .096);
      label('03   PEAK dBFS', INSTRUMENT_RECTS.meters.x, .096);
      label('04   SPECTROGRAM', .06, .3924);
      label('05   TRACK OVERVIEW', .06, .5862);
      label(hasAudio ? `${(time / analysis.duration * 100).toFixed(1)}%` : '—', .94, .5862, C.pearl, 13, 'right');
      label(elapsedText, .06, .737, C.pearl, 18);
      label(remainingText, .94, .737, C.pearl, 18, 'right');
      if (!hasAudio) label('LOAD A TRACK TO REVEAL ITS STRUCTURE', INSTRUMENT_RECTS.analyzer.x + INSTRUMENT_RECTS.analyzer.w / 2, .2248, C.silver, 11, 'center');
    }
    // Track-start carets belong to the overview even when text labels are off.
    // Their tips sit 5px above the waveform's lower edge.
    if (hasAudio && markerEntries?.length) {
      const tipY = (RECTS.overview.y + RECTS.overview.h) * 1080 - 5;
      let active = -1;
      for (let i = 0; i < markerEntries.length; i++) if (markerEntries[i].time <= time) active = i;
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < markerEntries.length; i++) {
        const marker = markerEntries[i];
        if (marker.time < 0 || marker.time >= duration) continue;
        const x = (RECTS.overview.x + marker.time / duration * RECTS.overview.w) * 1920;
        ctx.strokeStyle = i === active ? C.ivory : paletteRgba(C.copper, marker.time < time ? .45 : .8);
        ctx.beginPath();
        ctx.moveTo(x - 3, tipY + 5);
        ctx.lineTo(x, tipY);
        ctx.lineTo(x + 3, tipY + 5);
        ctx.stroke();
      }
    }
    ctx.restore();
    labelsTexture.needsUpdate = true;
    renderer.initTexture(labelsTexture);
    renderer.resetState();
  }

  const setHistoryFrames = frames => history.setFrames(frames);

  function resize(w, h, pixelRatio = Math.max(1, window.devicePixelRatio || 1)) {
    width = Math.max(2, Math.round(w)); height = Math.max(2, Math.round(h)); ratio = pixelRatio;
    aspect = width / height;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.top = 50 / aspect; camera.bottom = -50 / aspect; camera.updateProjectionMatrix();
    instruments.resize(width, height, ratio);
    resizeInstrumentLabels();
    for (const chart of [minimap]) {
      chart.layout(aspect);
      chart.setResolution?.(width, height, ratio);
    }
    const box = rectToWorld(RECTS.curtain, aspect, 0);
    curtain.scale.set(box.width, box.height, 1); curtain.position.set(box.cx, box.cy, 0);
    const labelWidth = Math.round(width * ratio), labelHeight = Math.round(height * ratio);
    if (labelsCanvas.width !== labelWidth || labelsCanvas.height !== labelHeight) {
      labelsCanvas.width = labelWidth;
      labelsCanvas.height = labelHeight;
      // WebGL texture storage is immutable: a resized canvas requires a new
      // texture allocation, particularly for the 4K capture viewport swap.
      labelsTexture.dispose();
      labelsTexture = new THREE.CanvasTexture(labelsCanvas);
      labelsTexture.colorSpace = THREE.SRGBColorSpace;
      labelsTexture.minFilter = THREE.LinearFilter;
      labelsTexture.generateMipmaps = false;
      labelsMaterial.map = labelsTexture;
      labelsMaterial.needsUpdate = true;
    }
    labelsMesh.geometry.dispose();
    labelsMesh.geometry = new THREE.PlaneGeometry(100, 100 / aspect);
    curtainMaterial.uniforms.uDisplayHeight.value = height * ratio * RECTS.curtain.h;
    lastLabels = '';
  }

  function render({ time = 0, analysis = null, frame = null, spectralFrame = null, levels = null } = {}) {
    if (disposed) return;
    common.uFrame.value = Math.min(time * FPS, Math.max(0, history.latestFrame));
    common.uSampleRate.value = analysis?.sampleRate || 48000;
    common.uGain.value = settings.gain;
    instruments.update({ frame, spectralFrame, levels, sampleRate: analysis?.sampleRate || 48000, hasAudio: Boolean(analysis?.buffer) });
    drawInstrumentLabels();
    minimap.update({ progress: analysis?.duration ? Math.min(1, time / analysis.duration) : 0 });
    drawLabels(time, analysis);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(BLACK, 1);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    // This final scissor is a hard export-safe boundary for every overlay.
    renderer.setScissor(0, height * .25, width, height * .75);
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
  }

  function resetHistory() {
    history.reset();
    for (const layer of instrumentLayers) layer.key = '';
  }
  function dispose() {
    disposed = true;
    minimap.dispose?.();
    instruments.dispose();
    for (const layer of instrumentLayers) {
      layer.mesh.geometry.dispose(); layer.material.dispose(); layer.texture?.dispose();
    }
    palette.dispose();
    curtain.geometry.dispose(); curtainMaterial.dispose();
    labelsMesh.geometry.dispose(); labelsMaterial.dispose(); labelsTexture.dispose(); history.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  minimap.setPeaks(new Float32Array(16384));
  return {
    canvas: renderer.domElement, resize, render, setHistoryFrames, resetHistory,
    hitTest: (x, y) => instruments.hitTest(x, y),
    setOverview(peaks, rmsPeaks) { minimap.setPeaks(peaks, rmsPeaks); lastLabels = ''; },
    dispose,
    getInfo: () => ({ fftSize: 32768, fftBins: BINS, ...history.getInfo(), canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio, drawCalls: renderer.info.render.calls, labelFont: 'Inter', fontLoaded: document.fonts.check('500 11px "Inter"'), instruments: instruments.getInfo(), labelState,
      instrumentLabelLayers: instrumentLayers.map(layer => ({ name: layer.name, width: layer.canvas.width, height: layer.canvas.height, uploads: layer.uploads })) }),
  };
}

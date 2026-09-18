import * as THREE from 'three';
import { createWaveformMinimap, rectToWorld } from '../monitor-charts.js';
import { buildPeakTree } from './signal-atlas-peak-tree.js';
import { formatTrackTime } from './signal-atlas-setlist.js';
import { createSpectrogramPalette } from './signal-atlas-color.js';
import { createAtlasInstruments, INSTRUMENT_RECTS, INSTRUMENT_VISIBLE_EDGES } from './signal-atlas-instruments.js';

const BINS = 16384;
const ROWS = 1442;
const FPS = 60;
const BLACK = new THREE.Color(0x000000);
const RECTS = {
  // Split the .1176 height released by the first row equally between these rows.
  curtain: { x: .06, y: .4014, w: .88, h: .1518 },
  overview: { x: .06, y: .5922, w: .88, h: .1188 },
};

const spectralSampling = `
  uniform sampler2D uHistory;
  uniform sampler2D uPeakTree;
  uniform float uFrame;
  uniform float uSampleRate;
  uniform float uGain;
  const float ROWS = 1442.0;
  const float BINS = 16384.0;
  float historySample(float bin, float frame) {
    if (frame < 0.0) return 0.0;
    float row = mod(floor(frame), ROWS);
    return texture2D(uHistory, vec2((clamp(bin, 0.0, BINS - 1.0) + .5) / BINS, (row + .5) / ROWS)).r;
  }
  float binAt(float x) {
    // A soft logarithmic axis includes DC and the final FFT bin, while keeping
    // useful space for bass detail. No analysed frequency is cropped away.
    float knee = 30.0 * 32768.0 / uSampleRate;
    return knee * (pow(1.0 + (BINS - 1.0) / knee, clamp(x, 0.0, 1.0)) - 1.0);
  }
  float treeSample(float node, float frame) {
    if (node >= BINS) return historySample(node - BINS, frame);
    float row = mod(floor(frame), ROWS);
    return texture2D(uPeakTree, vec2((node + .5) / BINS, (row + .5) / ROWS)).r;
  }
  float intervalPeak(float first, float last, float frame) {
    if (frame < 0.0) return 0.0;
    float left = BINS + clamp(floor(first), 0.0, BINS - 1.0);
    float right = BINS + clamp(ceil(last), 0.0, BINS - 1.0);
    float peak = 0.0;
    // Decompose the exact interval into complete binary subtrees. Adjacent
    // probes can miss a single FFT peak; every covered bin contributes here.
    for (int level = 0; level < 15; level++) {
      if (left > right) break;
      if (mod(left, 2.0) > .5) {
        peak = max(peak, treeSample(left, frame));
        left += 1.0;
      }
      if (mod(right, 2.0) < .5) {
        peak = max(peak, treeSample(right, frame));
        right -= 1.0;
      }
      left = floor(left * .5);
      right = floor(right * .5);
    }
    return peak;
  }
  float spectrum(float x, float halfSpan, float frame) {
    float first = binAt(x - halfSpan);
    float last = binAt(x + halfSpan);
    float a = intervalPeak(first, last, floor(frame));
    float fraction = fract(frame);
    if (fraction < .000001) return a;
    float b = intervalPeak(first, last, floor(frame) + 1.0);
    return mix(a, b, fraction);
  }
`;

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
  let latestFrame = -1;
  let lastLabels = '';
  let labelState = null;
  const halfLut = new Uint16Array(65536);
  for (let i = 0; i < halfLut.length; i++) halfLut[i] = THREE.DataUtils.toHalfFloat(i / 65535);
  const historyData = new Uint16Array(BINS * ROWS);
  const peakTreeData = new Uint16Array(BINS * ROWS);
  const stamps = new Int32Array(ROWS).fill(-999999);
  const texture = new THREE.DataTexture(historyData, BINS, ROWS, THREE.RedFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  const peakTreeTexture = new THREE.DataTexture(peakTreeData, BINS, ROWS, THREE.RedFormat, THREE.HalfFloatType);
  peakTreeTexture.minFilter = THREE.NearestFilter;
  peakTreeTexture.magFilter = THREE.NearestFilter;
  peakTreeTexture.generateMipmaps = false;
  peakTreeTexture.unpackAlignment = 1;
  peakTreeTexture.needsUpdate = true;
  renderer.initTexture(peakTreeTexture);

  const common = {
    uHistory: { value: texture },
    uPeakTree: { value: peakTreeTexture },
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

  const minimap = createWaveformMinimap(scene, RECTS.overview, { color: '#dce0d4', playedColor: '#353b3c', barWidth: 2.3, barGap: .32 });
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

  const instrumentRect = { x: .06, y: .1044, w: .88, h: .2604 };
  const instrumentCanvas = document.createElement('canvas');
  const instrumentCtx = instrumentCanvas.getContext('2d', { willReadFrequently: true });
  let instrumentTexture = new THREE.CanvasTexture(instrumentCanvas);
  const instrumentMaterial = new THREE.MeshBasicMaterial({ map: instrumentTexture, transparent: true, depthTest: false, depthWrite: false });
  const instrumentMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), instrumentMaterial);
  instrumentMesh.renderOrder = 101;
  scene.add(instrumentMesh);
  let lastInstrumentLabels = '';
  function resizeInstrumentLabels() {
    const w = Math.max(1, Math.round(width * ratio * instrumentRect.w));
    const h = Math.max(1, Math.round(height * ratio * instrumentRect.h));
    if (instrumentCanvas.width !== w || instrumentCanvas.height !== h) {
      instrumentCanvas.width = w;
      instrumentCanvas.height = h;
      instrumentTexture.dispose();
      instrumentTexture = new THREE.CanvasTexture(instrumentCanvas);
      instrumentMaterial.map = instrumentTexture;
      instrumentMaterial.needsUpdate = true;
    }
    instrumentTexture.colorSpace = THREE.SRGBColorSpace;
    instrumentTexture.minFilter = THREE.LinearFilter;
    instrumentTexture.generateMipmaps = false;
    const box = rectToWorld(instrumentRect, aspect, 0);
    instrumentMesh.scale.set(box.width, box.height, 1);
    instrumentMesh.position.set(box.cx, box.cy, 0);
    lastInstrumentLabels = '';
  }
  function drawInstrumentLabels(time, hasAudio) {
    const key = [time, hasAudio, settings.labels, settings.gridOpacity, settings.rtaMin, settings.rtaMax, settings.rtaBoost].join('|');
    if (key === lastInstrumentLabels) return;
    lastInstrumentLabels = key;
    const ctx = instrumentCtx;
    ctx.clearRect(0, 0, instrumentCanvas.width, instrumentCanvas.height);
    ctx.save();
    ctx.scale(instrumentCanvas.width / (1920 * instrumentRect.w), instrumentCanvas.height / (1080 * instrumentRect.h));
    ctx.translate(-instrumentRect.x * 1920, -instrumentRect.y * 1080);
    instruments.drawLabels(ctx);
    ctx.restore();
    instrumentTexture.needsUpdate = true;
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
      ctx.strokeStyle = `rgba(153,184,183,${alpha})`; ctx.lineWidth = .75;
      ctx.beginPath(); ctx.moveTo(x1 * 1920, y1 * 1080); ctx.lineTo(x2 * 1920, y2 * 1080); ctx.stroke();
    };
    rule(.06,.073,.94,.073);
    const scopeDividerX = (INSTRUMENT_VISIBLE_EDGES.scopeRight + INSTRUMENT_RECTS.analyzer.x) / 2;
    rule(scopeDividerX,.097,scopeDividerX,.3592,settings.gridOpacity*.7);

    rule(.06,.3704,.94,.3704);
    rule(.06,.5662,.94,.5662);
    if (settings.labels) {
      const label = (text, x, y, color = '#a4bdbd', size = 13, align = 'left') => {
        ctx.fillStyle = color;
        ctx.font = `500 ${size}px "Inter", sans-serif`;
        ctx.textAlign = align;
        ctx.fillText(text, x * 1920, y * 1080);
      };
      label('S I G N A L   A T L A S', .06, .052, '#dde2d8', 18);
      label(hasAudio ? `STEREO STUDY  /  ${(analysis.sampleRate / 1000).toFixed(1)} kHz` : 'AN AUDIOVISUAL INSTRUMENT', .94, .051, '#638282', 10, 'right');
      label('01   PHASE SCOPE', .06, .096);
      label('02   SPECTRUM ANALYZER', INSTRUMENT_RECTS.analyzer.x, .096);
      label('03   PEAK dBFS', INSTRUMENT_RECTS.meters.x, .096);
      label('04   SPECTROGRAM', .06, .3924);
      label('05   TRACK OVERVIEW', .06, .5862);
      label(hasAudio ? `${(time / analysis.duration * 100).toFixed(1)}%` : '—', .94, .5862, '#638282', 10, 'right');
      label(elapsedText, .06, .737, '#d5dfd8', 18);
      const elapsedCaptionX = Math.max(.107, .06 + (ctx.measureText(elapsedText).width + 24) / 1920);
      label('ELAPSED', elapsedCaptionX, .737, '#809895', 11);
      label(remainingText, .94, .737, '#d5dfd8', 18, 'right');
      const remainingCaptionX = Math.min(.876, .94 - (ctx.measureText(remainingText).width + 24) / 1920);
      label('REMAINING', remainingCaptionX, .737, '#809895', 11, 'right');
      if (!hasAudio) label('LOAD A TRACK TO REVEAL ITS STRUCTURE', INSTRUMENT_RECTS.analyzer.x + INSTRUMENT_RECTS.analyzer.w / 2, .2248, '#75928f', 11, 'center');
    }
    // Track-start carets belong to the overview even when text labels are off.
    // Their tips sit beneath the waveform, with room above the time captions.
    if (hasAudio && markerEntries?.length) {
      const tipY = (RECTS.overview.y + RECTS.overview.h) * 1080 + 5;
      let active = -1;
      for (let i = 0; i < markerEntries.length; i++) if (markerEntries[i].time <= time) active = i;
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < markerEntries.length; i++) {
        const marker = markerEntries[i];
        if (marker.time < 0 || marker.time >= duration) continue;
        const x = (RECTS.overview.x + marker.time / duration * RECTS.overview.w) * 1920;
        ctx.strokeStyle = i === active ? '#dce0d4' : marker.time < time ? '#657475' : '#87adaf';
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

  function setHistoryFrames(frames) {
    if (disposed || !frames?.length) return;
    const updated = [];
    for (const entry of frames) {
      if (entry.frame < 0) continue;
      const row = entry.frame % ROWS;
      if (stamps[row] === entry.frame) continue;
      const offset = row * BINS;
      const source = entry.spectrum;
      for (let i = 0; i < BINS; i++) historyData[offset + i] = halfLut[source[i]];
      buildPeakTree(historyData, peakTreeData, BINS, offset, offset);
      stamps[row] = entry.frame;
      latestFrame = Math.max(latestFrame, entry.frame);
      updated.push(row);
    }
    if (!updated.length) return;
    if (updated.length > 48) {
      texture.needsUpdate = true;
      peakTreeTexture.needsUpdate = true;
      renderer.initTexture(texture);
      renderer.initTexture(peakTreeTexture);
    } else {
      const gl = renderer.getContext();
      renderer.state.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const [rowTexture, rowData] of [[texture, historyData], [peakTreeTexture, peakTreeData]]) {
        renderer.initTexture(rowTexture);
        const gpuTexture = renderer.properties.get(rowTexture).__webglTexture;
        renderer.state.activeTexture(gl.TEXTURE0);
        renderer.state.bindTexture(gl.TEXTURE_2D, gpuTexture);
        for (const row of updated) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, BINS, 1, gl.RED, gl.HALF_FLOAT, rowData.subarray(row * BINS, (row + 1) * BINS));
        }
      }
    }
    renderer.resetState();
  }

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
    common.uFrame.value = Math.min(time * FPS, Math.max(0, latestFrame));
    common.uSampleRate.value = analysis?.sampleRate || 48000;
    common.uGain.value = settings.gain;
    instruments.update({ frame, spectralFrame, levels, sampleRate: analysis?.sampleRate || 48000, hasAudio: Boolean(analysis?.buffer) });
    drawInstrumentLabels(time, Boolean(analysis?.buffer));
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
    historyData.fill(0); peakTreeData.fill(0); stamps.fill(-999999); latestFrame = -1;
    texture.needsUpdate = true;
    peakTreeTexture.needsUpdate = true;
    lastInstrumentLabels = '';
  }
  function dispose() {
    disposed = true;
    minimap.dispose?.();
    instruments.dispose();
    instrumentMesh.geometry.dispose(); instrumentMaterial.dispose(); instrumentTexture.dispose(); palette.dispose();
    curtain.geometry.dispose(); curtainMaterial.dispose();
    labelsMesh.geometry.dispose(); labelsMaterial.dispose(); labelsTexture.dispose(); texture.dispose(); peakTreeTexture.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  minimap.setPeaks(new Float32Array(16384));
  return {
    canvas: renderer.domElement, resize, render, setHistoryFrames, resetHistory,
    hitTest: (x, y) => instruments.hitTest(x, y),
    setOverview(peaks, rmsPeaks) { minimap.setPeaks(peaks, rmsPeaks); lastLabels = ''; },
    dispose,
    getInfo: () => ({ fftSize: 32768, fftBins: BINS, historyRows: ROWS, historyBytes: historyData.byteLength, peakTreeBytes: peakTreeData.byteLength, canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio, drawCalls: renderer.info.render.calls, labelFont: 'Inter', fontLoaded: document.fonts.check('500 11px "Inter"'), instruments: instruments.getInfo(), labelState }),
  };
}

import * as THREE from 'three';
import { createWaveformMinimap, createStereoMeters, createPhaseScope, createWaveformMicroscope, rectToWorld } from '../monitor-charts.js';
import { buildPeakTree } from './signal-atlas-peak-tree.js';
import { formatTrackTime } from './signal-atlas-setlist.js';
import { terrainEnergy } from './signal-atlas-color.js';

const BINS = 16384;
const COLUMNS = 16384;
const ROWS = 1442;
const RIDGES = 120;
const FPS = 60;
const BLACK = new THREE.Color(0x000000);
const RECTS = {
  waterfall: { x: .06, y: .108, w: .55, h: .367 },
  scope: { x: .565, y: .108, w: .306, h: .231 },
  microscope: { x: .565, y: .384, w: .306, h: .088 },
  meters: { x: .902, y: .124, w: .033, h: .343 },
  curtain: { x: .06, y: .519, w: .88, h: .093 },
  overview: { x: .06, y: .651, w: .88, h: .060 },
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
  float shape(float value) {
    // A continuous shoulder preserves loud bass contours instead of clipping
    // several distinct FFT levels to the same flat shelf.
    float x = max(0.0, value - .12) * uGain;
    return 1.0 - exp(-x * x * 1.9);
  }
`;

/** One instanced, indexed strip is reused for all 120 ridges. Only the history
 * texture changes; 16,384 columns do not require per-frame vertex uploads. */
function makeRidges(uniforms) {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions = new Float32Array(COLUMNS * 2 * 3);
  const along = new Float32Array(COLUMNS * 2);
  const side = new Float32Array(COLUMNS * 2);
  const indices = new Uint32Array((COLUMNS - 1) * 6);
  for (let i = 0; i < COLUMNS; i++) {
    along[i * 2] = along[i * 2 + 1] = i / (COLUMNS - 1);
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < COLUMNS - 1) {
      const a = i * 2, j = i * 6;
      indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], j);
    }
  }
  const ages = Float32Array.from({ length: RIDGES }, (_, i) => (RIDGES - 1 - i) / (RIDGES - 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(ages, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.instanceCount = RIDGES;
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: `${spectralSampling}
      attribute float aAlong;
      attribute float aSide;
      attribute float aAge;
      uniform float uHeight;
      uniform float uSeconds;
      uniform float uStroke;
      uniform vec2 uResolution;
      varying float vSide;
      varying float vAge;
      varying float vEnergy;
      vec4 projectPoint(float x) {
        float frame = uFrame - aAge * uSeconds * 60.0;
        float energy = shape(spectrum(x, .5 / 16383.0, frame));
        vec3 p = vec3((x - .5) * 14.0, energy * uHeight * 2.3, (aAge - .5) * -10.5);
        return projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
      void main() {
        vec4 p = projectPoint(aAlong);
        vec4 before = projectPoint(max(0.0, aAlong - 1.0 / 16383.0));
        vec4 after = projectPoint(min(1.0, aAlong + 1.0 / 16383.0));
        vec2 tangent = (after.xy / after.w - before.xy / before.w) * uResolution;
        vec2 normal = normalize(vec2(-tangent.y, tangent.x) + vec2(0.000001));
        p.xy += normal * aSide * (uStroke + .7) / uResolution * p.w;
        gl_Position = p;
        vSide = aSide;
        vAge = aAge;
        vEnergy = shape(spectrum(aAlong, .5 / 16383.0, uFrame - aAge * uSeconds * 60.0));
      }
    `,
    fragmentShader: `
      uniform vec3 uTerrainNear;
      uniform vec3 uTerrainFar;
      varying float vSide;
      varying float vAge;
      varying float vEnergy;
      void main() {
        float edge = 1.0 - smoothstep(.45, 1.0, abs(vSide));
        float major = 1.0-step(.5,mod(floor(vAge*119.0+.5),10.0));
        float fade = mix(.045, .80, pow(1.0 - vAge, 1.7));
        fade *= (.12 + vEnergy * .92) * mix(.66,1.0,major);
        vec3 color = mix(uTerrainFar, uTerrainNear, 1.0 - vAge * .85);
        gl_FragColor = vec4(color, edge * fade);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

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
  renderer.domElement.setAttribute('aria-label', 'Audio-reactive waterfall, stereo scope, waveform, spectrogram and track progress');

  let width = 1920, height = 1080, ratio = 1, aspect = 16 / 9;
  let disposed = false;
  let latestFrame = -1;
  let lastLabels = '';
  let labelState = null;
  let lastCamera = '';
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

  const nearColor = new THREE.Color();
  const farColor = new THREE.Color();
  const colorHsl = { h: 0, s: 0, l: 0 };
  let colorKey = '';
  let currentEnergy = 0;
  function applyTerrainColor(base, target) {
    target.copy(base);
    if (settings.energyHue) {
      base.getHSL(colorHsl);
      target.setHSL(colorHsl.h + currentEnergy * .18,
        colorHsl.s + (1 - colorHsl.s) * currentEnergy * .22, colorHsl.l);
    }
  }
  function updateTerrainColors(levels) {
    const near = settings.terrainNear || '#e3e6d6';
    const far = settings.terrainFar || '#5e9196';
    const key = `${near}|${far}`;
    if (key !== colorKey) {
      colorKey = key;
      // Custom shader colors are display RGB, matching the native pickers.
      nearColor.set(near).convertLinearToSRGB();
      farColor.set(far).convertLinearToSRGB();
    }
    currentEnergy = terrainEnergy(levels);
    applyTerrainColor(nearColor, common.uTerrainNear.value);
    applyTerrainColor(farColor, common.uTerrainFar.value);
  }

  const common = {
    uHistory: { value: texture },
    uPeakTree: { value: peakTreeTexture },
    uFrame: { value: 0 },
    uSampleRate: { value: 48000 },
    uGain: { value: settings.gain },
    uHeight: { value: settings.height },
    uSeconds: { value: settings.historySeconds },
    uStroke: { value: settings.lineWidth },
    uTerrainNear: { value: new THREE.Color() },
    uTerrainFar: { value: new THREE.Color() },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 50 / aspect, -50 / aspect, -10, 10);
  camera.position.z = 5;
  const terrain = new THREE.Scene();
  const terrainCamera = new THREE.PerspectiveCamera(34, 1, .1, 150);
  const ridges = makeRidges(common);
  const occlusionMaterial = new THREE.ShaderMaterial({
    uniforms: common, colorWrite: false, depthWrite: true, depthTest: true,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    vertexShader: `${spectralSampling}
      attribute float aAlong;
      attribute float aSide;
      attribute float aAge;
      uniform float uHeight;
      uniform float uSeconds;
      void main() {
        float energy = shape(spectrum(aAlong,.5/16383.0,uFrame-aAge*uSeconds*60.0));
        vec3 p=vec3((aAlong-.5)*14.0,aSide>0.0?energy*uHeight*2.3:0.0,(aAge-.5)*-10.5);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: 'void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}',
  });
  const occlusion = new THREE.Mesh(ridges.geometry, occlusionMaterial);
  occlusion.frustumCulled = false;
  ridges.renderOrder = 2;
  terrain.add(occlusion);
  terrain.add(ridges);

  const curtainMaterial = new THREE.ShaderMaterial({
    uniforms: { ...common, uDisplayHeight: { value: 200 } },
    depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `${spectralSampling}
      uniform float uDisplayHeight;
      varying vec2 vUv;
      void main() {
        float time = uFrame - (1.0 - vUv.x) * 1440.0;
        float band = vUv.y;
        float value = spectrum(band, .5 / uDisplayHeight, time);
        float signal=max(0.0,value-.15)*uGain*1.55;
        float light=1.0-exp(-signal*signal);
        vec3 low=vec3(.006,.020,.026);
        vec3 mid=vec3(.15,.40,.46);
        vec3 high=vec3(.82,.88,.80);
        vec3 color=mix(low,mid,smoothstep(.05,.57,light));
        color=mix(color,high,smoothstep(.57,.96,light));
        color*=smoothstep(.005,.07,light);
        color*=mix(.58,1.0,pow(vUv.x,.65));
        gl_FragColor=vec4(color,1.0);
      }
    `,
  });
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), curtainMaterial);
  scene.add(curtain);

  const resolution = new THREE.Vector2(width, height);
  const minimap = createWaveformMinimap(scene, RECTS.overview, { color: '#dce0d4', playedColor: '#353b3c', barWidth: 2.3, barGap: .32 });
  const meters = createStereoMeters(scene, RECTS.meters, resolution, { mode: 'stereo', colors: ['#84c5ca', '#c9a77a'] });
  const scope = createPhaseScope(scene, RECTS.scope, resolution, { mode: 'points', pointCount: 8192, color: '#a1d1cf', pointSize: 1.75, opacity: .78 });
  const microscope = createWaveformMicroscope(scene, RECTS.microscope, resolution, { colors: ['#84c5ca', '#c9a77a'], lineWidth: 1.3, opacity: .9, windowSeconds: .03, autoScale: true });

  const labelsCanvas = document.createElement('canvas');
  const labelsCtx = labelsCanvas.getContext('2d');
  let labelsTexture = new THREE.CanvasTexture(labelsCanvas);
  labelsTexture.colorSpace = THREE.SRGBColorSpace;
  labelsTexture.minFilter = THREE.LinearFilter;
  labelsTexture.generateMipmaps = false;
  const labelsMaterial = new THREE.MeshBasicMaterial({ map: labelsTexture, transparent: true, depthTest: false, depthWrite: false });
  const labelsMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 100 / aspect), labelsMaterial);
  labelsMesh.renderOrder = 100;
  scene.add(labelsMesh);

  let markerEntries = null;
  let markerVersion = 0;
  function drawLabels(time, analysis) {
    const hasAudio = Boolean(analysis?.buffer);
    if (markerEntries !== settings.setlist) { markerEntries = settings.setlist; markerVersion++; }
    const key = [Math.floor(time), analysis?.duration || 0, settings.labels, settings.gridOpacity, width, height, ratio, markerVersion].join('|');
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
    rule(.545,.097,.545,.472,settings.gridOpacity*.7);
    rule(.889,.097,.889,.472,settings.gridOpacity*.7);
    rule(.06,.488,.94,.488);
    rule(.06,.625,.94,.625);
    // A quiet crosshair and centre line remain useful without text labels.
    rule(RECTS.microscope.x,.428,.871,.428,settings.gridOpacity*.65);
    if (settings.labels) {
      const label = (text, x, y, color = '#8faaa9', size = 11, align = 'left') => {
        ctx.fillStyle = color;
        ctx.font = `500 ${size}px "Inter", sans-serif`;
        ctx.textAlign = align;
        ctx.fillText(text, x * 1920, y * 1080);
      };
      label('S I G N A L   A T L A S', .06, .052, '#dde2d8', 17);
      label(hasAudio ? `STEREO STUDY  /  ${(analysis.sampleRate / 1000).toFixed(1)} kHz` : 'AN AUDIOVISUAL INSTRUMENT', .94, .051, '#638282', 10, 'right');
      label('01   SPECTRAL TERRAIN', .06, .096);
      label('02   STEREO FIELD', RECTS.scope.x, .096);
      label('L    R', .918, .096, '#a3b7b3', 11, 'center');
      label('03   WAVEFORM DETAIL', RECTS.microscope.x, .369);
      label('04   FREQUENCY HISTORY', .06, .51);
      label('24 SEC', .94, .51, '#577272', 10, 'right');
      label('05   TRACK OVERVIEW', .06, .645);
      label(hasAudio ? `${(time / analysis.duration * 100).toFixed(1)}%` : '—', .94, .645, '#638282', 10, 'right');
      label(elapsedText, .06, .737, '#c6d1c8', 15);
      const elapsedCaptionX = Math.max(.107, .06 + (ctx.measureText(elapsedText).width + 24) / 1920);
      label('ELAPSED', elapsedCaptionX, .737, '#557372', 9);
      label(remainingText, .94, .737, '#c6d1c8', 15, 'right');
      const remainingCaptionX = Math.min(.876, .94 - (ctx.measureText(remainingText).width + 24) / 1920);
      label('REMAINING', remainingCaptionX, .737, '#557372', 9, 'right');
      if (!hasAudio) label('LOAD A TRACK TO REVEAL ITS STRUCTURE', .335, .294, '#75928f', 11, 'center');
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

  function setCamera() {
    const key = `${settings.viewAngle}|${aspect}`;
    if (key === lastCamera) return;
    lastCamera = key;
    const poses = { hero: [8.0, 9.7, 14.8], front: [0, 10.6, 17.5], side: [-10.4, 8.5, 13.6] };
    terrainCamera.position.fromArray(poses[settings.viewAngle] || poses.hero);
    terrainCamera.lookAt(0, .45, -.4);
    terrainCamera.aspect = RECTS.waterfall.w * width / (RECTS.waterfall.h * height);
    terrainCamera.updateProjectionMatrix();
  }

  function resize(w, h, pixelRatio = Math.max(1, window.devicePixelRatio || 1)) {
    width = Math.max(2, Math.round(w)); height = Math.max(2, Math.round(h)); ratio = pixelRatio;
    aspect = width / height;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.top = 50 / aspect; camera.bottom = -50 / aspect; camera.updateProjectionMatrix();
    resolution.set(width, height);
    for (const chart of [minimap, meters, scope, microscope]) {
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
    common.uResolution.value.set(width * RECTS.waterfall.w * ratio, height * RECTS.waterfall.h * ratio);
    curtainMaterial.uniforms.uDisplayHeight.value = height * ratio * RECTS.curtain.h;
    lastLabels = ''; lastCamera = ''; setCamera();
  }

  function render({ time = 0, analysis = null, frame = null, levels = null } = {}) {
    if (disposed) return;
    common.uFrame.value = Math.min(time * FPS, Math.max(0, latestFrame));
    common.uSampleRate.value = analysis?.sampleRate || 48000;
    common.uGain.value = settings.gain;
    common.uHeight.value = settings.height;
    common.uSeconds.value = settings.historySeconds;
    common.uStroke.value = settings.lineWidth * ratio;
    updateTerrainColors(levels);
    setCamera();
    if (frame) scope.update({ left: frame.left, right: frame.right, gain: settings.gain * 2.7, correlation: frame.correlation });
    meters.update({ levels: levels ? { ...levels, lHold: levels.lPeak, rHold: levels.rPeak }
      : { lRms: 0, rRms: 0, lPeak: 0, rPeak: 0, lHold: 0, rHold: 0 } });
    microscope.update({ buffer: analysis?.buffer || null, time, gain: settings.gain });
    minimap.update({ progress: analysis?.duration ? Math.min(1, time / analysis.duration) : 0 });
    drawLabels(time, analysis);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(BLACK, 1);
    renderer.clear(true, true, true);
    const r = RECTS.waterfall;
    renderer.setScissorTest(true);
    renderer.setViewport(r.x * width, (1 - r.y - r.h) * height, r.w * width, r.h * height);
    // Keep the accepted perspective framing, but trim its unused right margin
    // so the instruments can sit closer without sharing a drawing region.
    renderer.setScissor(r.x * width, (1 - r.y - r.h) * height, (.545 - r.x) * width, r.h * height);
    renderer.render(terrain, terrainCamera);
    renderer.setViewport(0, 0, width, height);
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
    meters.resetPeaks?.();
  }
  function dispose() {
    disposed = true;
    for (const chart of [minimap, meters, scope, microscope]) chart.dispose?.();
    ridges.geometry.dispose(); ridges.material.dispose(); occlusionMaterial.dispose();
    curtain.geometry.dispose(); curtainMaterial.dispose();
    labelsMesh.geometry.dispose(); labelsMaterial.dispose(); labelsTexture.dispose(); texture.dispose(); peakTreeTexture.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  minimap.setPeaks(new Float32Array(16384));
  return {
    canvas: renderer.domElement, resize, render, setHistoryFrames, resetHistory,
    setOverview(peaks, rmsPeaks) { minimap.setPeaks(peaks, rmsPeaks); lastLabels = ''; },
    dispose,
    getInfo: () => ({ fftSize: 32768, fftBins: BINS, columns: COLUMNS, ridges: RIDGES, historyRows: ROWS, historyBytes: historyData.byteLength, peakTreeBytes: peakTreeData.byteLength, canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio, drawCalls: renderer.info.render.calls, view: settings.viewAngle, labelFont: 'Inter', fontLoaded: document.fonts.check('500 11px "Inter"'), terrainColors: { newest: common.uTerrainNear.value.toArray(), history: common.uTerrainFar.value.toArray(), energy: currentEnergy, energyHue: Boolean(settings.energyHue) }, labelState }),
  };
}

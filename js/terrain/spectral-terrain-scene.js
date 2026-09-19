import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSpectralHistory } from './spectral-history.js';
import {
  TERRAIN_COLUMNS, TERRAIN_RIDGES, TERRAIN_HISTORY_ROWS, TERRAIN_MAX_RIDGES,
  TERRAIN_RIDGE_SECONDS, TERRAIN_RIDGE_SPACING, terrainHistoryLayout,
  createTerrainColumnRanges, mapTerrainEnvelope, terrainEnergy,
} from './spectral-terrain-math.js';

const FPS = 60;
const ASPECT = 16 / 9;
const PRESETS = {
  oblique: [8, 9.7, 14.8],
  front: [0, 10.6, 17.5],
  side: [-10.4, 8.5, 13.6],
};

// Each texel is the exact maximum of the source FFT interval for this column.
// Interpolate original history values before the continuous height shoulder.
const terrainSampling = `
  uniform sampler2D uHistory;
  uniform float uFrame;
  uniform float uGain;
  uniform float uHeight;
  uniform float uSeconds;
  uniform float uSpacing;
  uniform float uFrequencySpread;
  attribute float aColumn;
  attribute float aSide;
  uniform float uAge;
  uniform float uTimeOffset;
  uniform float uDepthOffset;
  uniform float uRidgeIndex;
  const float COLUMNS = ${TERRAIN_COLUMNS}.0;
  const float ROWS = ${TERRAIN_HISTORY_ROWS}.0;
  float historySample(float column, float frame) {
    if (frame < 0.0) return 0.0;
    float row = mod(floor(frame), ROWS);
    return texture2D(uHistory, vec2((clamp(column, 0.0, COLUMNS - 1.0) + .5) / COLUMNS, (row + .5) / ROWS)).r;
  }
  float energyAt(float column) {
    float frame = uFrame - uTimeOffset * 60.0;
    float value = historySample(column, floor(frame));
    float fraction = fract(frame);
    if (fraction >= .000001) value = mix(value, historySample(column, floor(frame) + 1.0), fraction);
    float x = max(0.0, value - .12) * uGain;
    return 1.0 - exp(-x * x * 1.9);
  }
  vec3 terrainPoint(float column, float energy) {
    float x = column / (COLUMNS - 1.0);
    // Expand the dense end outwards; the lower frequencies keep their spacing.
    // The right-edge spacing reaches the requested multiplier continuously.
    float tail = max(0.0, (x - .35) / .65);
    x += (uFrequencySpread - 1.0) * (.65 / 3.0) * tail * tail * tail;
    return vec3((x - .5) * 14.0,
      energy * uHeight * 2.3, 5.25 - uDepthOffset * uSpacing);
  }
`;

/** Every adjacent FFT-column pair gets a complete antialiased segment. The
 * capsule joins cannot fold over at subpixel peaks, unlike a shared normal strip.
 * Maximum blending prevents dense joins from accumulating into a fuzzy fill. */
function createTerrain(uniforms) {
  function makeGeometry(segments) {
    const count = segments ? (TERRAIN_COLUMNS - 1) * 4 : TERRAIN_COLUMNS * 2;
    const geometry = new THREE.BufferGeometry();
    const columns = new Float32Array(count);
    const sides = new Float32Array(count);
    const segmentStarts = segments ? new Float32Array(count) : null;
    const ends = segments ? new Float32Array(count) : null;
    const indices = new Uint32Array((TERRAIN_COLUMNS - 1) * 6);
    if (segments) {
      for (let i = 0; i < TERRAIN_COLUMNS - 1; i++) {
        const a = i * 4;
        columns.set([i, i, i + 1, i + 1], a);
        sides.set([-1, 1, -1, 1], a);
        segmentStarts.fill(i, a, a + 4);
        ends.set([0, 0, 1, 1], a);
        indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
      }
      geometry.setAttribute('aSegment', new THREE.BufferAttribute(segmentStarts, 1));
      geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    } else {
      for (let i = 0; i < TERRAIN_COLUMNS; i++) {
        const a = i * 2;
        columns[a] = columns[a + 1] = i;
        sides[a] = -1; sides[a + 1] = 1;
        if (i < TERRAIN_COLUMNS - 1) indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aColumn', new THREE.BufferAttribute(columns, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }
  const ridgeGeometry = makeGeometry(true);
  const occlusionGeometry = makeGeometry(false);
  const ridgeParameters = {
    uniforms, transparent: true, depthWrite: false, depthTest: true,
    side: THREE.DoubleSide, forceSinglePass: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    vertexShader: `${terrainSampling}
      attribute float aSegment;
      attribute float aEnd;
      uniform float uStroke;
      uniform float uFilterWidth;
      uniform vec2 uResolution;
      varying vec2 vSegmentPoint;
      varying float vLength;
      varying float vRadius;
      varying float vAge;
      varying float vMajor;
      varying float vEnergy;
      vec4 projectPoint(float column, float energy) {
        vec4 view = modelViewMatrix * vec4(terrainPoint(column, energy), 1.0);
        return projectionMatrix * view;
      }
      void main() {
        float startEnergy = energyAt(aSegment);
        float endEnergy = energyAt(aSegment + 1.0);
        vec4 start = projectPoint(aSegment, startEnergy);
        vec4 end = projectPoint(aSegment + 1.0, endEnergy);
        vec2 pixelDelta = (end.xy / end.w - start.xy / start.w) * uResolution * .5;
        float segmentLength = max(length(pixelDelta), .0001);
        vec2 tangent = pixelDelta / segmentLength;
        vec2 normal = vec2(-tangent.y, tangent.x);
        // Include the displayed pixel footprint in the strip, so a thin 4K
        // contour cannot fall between samples when the canvas is scaled down.
        float radius = (uStroke + uFilterWidth) * .5;
        float cap = (aEnd * 2.0 - 1.0) * radius;
        vec4 p = mix(start, end, aEnd);
        p.xy += (normal * aSide * radius + tangent * cap) * 2.0 / uResolution * p.w;
        gl_Position = p;
        vSegmentPoint = vec2(aEnd * segmentLength + cap, aSide * radius);
        vLength = segmentLength;
        vRadius = radius;
        vAge = clamp(uAge, 0.0, 1.0);
        vMajor = 1.0 - step(.5, mod(uRidgeIndex, 10.0));
        vEnergy = mix(startEnergy, endEnergy, aEnd);
      }
    `,
    fragmentShader: `
      uniform vec3 uTerrainBase;
      uniform vec3 uTerrainPeak;
      uniform float uStroke;
      uniform float uFilterWidth;
      varying vec2 vSegmentPoint;
      varying float vLength;
      varying float vRadius;
      varying float vAge;
      varying float vMajor;
      varying float vEnergy;
      void main() {
        vec2 delta = vSegmentPoint - vec2(clamp(vSegmentPoint.x, 0.0, vLength), 0.0);
        // Integrate both stroke edges over the output pixel. The cap preserves
        // subpixel energy rather than turning narrow contours into thick ink.
        float edge = clamp((vRadius - length(delta)) / uFilterWidth, 0.0, min(1.0, uStroke / uFilterWidth));
        float fade = mix(.29, .98, pow(1.0 - vAge, .85));
        fade *= (.4 + sqrt(max(0.0, vEnergy)) * .6) * mix(.86, 1.0, vMajor);
        // Elevation selects the tone; age only fades it into the distance.
        float peak = smoothstep(.40, .72, vEnergy);
        vec3 color = mix(uTerrainBase, uTerrainPeak, peak);
        // Filter luminance in linear light. Multiplying encoded sRGB by
        // coverage makes subpixel strokes too dark, especially in small views.
        vec3 ink = color * fade;
        vec3 linearInk = mix(ink / 12.92, pow((ink + .055) / 1.055, vec3(2.4)), step(vec3(.04045), ink));
        vec3 light = linearInk * edge;
        vec3 display = mix(light * 12.92, 1.055 * pow(light, vec3(1.0 / 2.4)) - .055, step(vec3(.0031308), light));
        gl_FragColor = vec4(display, 1.0);
      }
    `,
  };
  const occlusionParameters = {
    uniforms, transparent: true, colorWrite: false, depthWrite: true, depthTest: true,
    side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: `${terrainSampling}
      void main() {
        float energy = aSide > 0.0 ? energyAt(aColumn) : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(terrainPoint(aColumn, energy), 1.0);
      }
    `,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }',
  };
  const ridges = new THREE.Group();
  const occlusion = new THREE.Group();
  const layers = [];
  // A ridge writes its colour before its own depth curtain. Consequently its
  // expanded screen-space stroke cannot be cut by that curtain, while all
  // previously drawn foreground terrain still hides older ridges correctly.
  for (let index = 0; index < TERRAIN_MAX_RIDGES; index++) {
    const layerUniforms = { ...uniforms,
      uAge: { value: index / (TERRAIN_RIDGES - 1) },
      uTimeOffset: { value: index * TERRAIN_RIDGE_SECONDS },
      uDepthOffset: { value: index * TERRAIN_RIDGE_SPACING },
      uRidgeIndex: { value: index },
    };
    const ridgeMaterial = new THREE.ShaderMaterial({ ...ridgeParameters, uniforms: layerUniforms });
    const occlusionMaterial = new THREE.ShaderMaterial({ ...occlusionParameters, uniforms: layerUniforms });
    const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
    const curtain = new THREE.Mesh(occlusionGeometry, occlusionMaterial);
    ridge.frustumCulled = curtain.frustumCulled = false;
    ridges.add(ridge); occlusion.add(curtain);
    layers.push({ ridge, curtain });
  }
  function updateLayers(count, fromFront) {
    for (let index = 0; index < layers.length; index++) {
      const { ridge, curtain } = layers[index];
      ridge.visible = curtain.visible = index < count;
      const order = fromFront ? index : count - 1 - index;
      ridge.renderOrder = order * 2;
      curtain.renderOrder = order * 2 + 1;
    }
  }
  return { ridges, occlusion, updateLayers, dispose() {
    ridgeGeometry.dispose(); occlusionGeometry.dispose();
    for (const { ridge, curtain } of layers) { ridge.material.dispose(); curtain.material.dispose(); }
  } };
}

export function createSpectralTerrainScene(stage, settings) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  if (renderer.capabilities.maxTextureSize < TERRAIN_COLUMNS) {
    renderer.dispose();
    throw new Error('Spectral Terrain requires a GPU supporting 16,384-pixel textures at master quality.');
  }
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Audio-reactive spectral terrain. Drag to orbit, scroll to zoom, and right-drag to pan.');
  let disposed = false;
  let sampleRate = 48000;
  let ranges = createTerrainColumnRanges(sampleRate);
  const mappedRow = new Uint16Array(TERRAIN_COLUMNS);
  const history = createSpectralHistory(renderer, {
    bins: TERRAIN_COLUMNS, rows: TERRAIN_HISTORY_ROWS, peakTree: false, filter: THREE.NearestFilter,
    projectSpectrum: spectrum => mapTerrainEnvelope(spectrum, ranges, mappedRow),
  });
  const uniforms = {
    uHistory: { value: history.texture },
    uFrame: { value: 0 }, uGain: { value: settings.gain },
    uHeight: { value: settings.height }, uSeconds: { value: settings.historySeconds },
    uSpacing: { value: Number(settings.ridgeSpacing) || 1 },
    uFrequencySpread: { value: Number(settings.frequencySpread) || 1 },
    uStroke: { value: settings.lineWidth }, uFilterWidth: { value: 2 }, uResolution: { value: new THREE.Vector2(3840, 2160) },
    uTerrainBase: { value: new THREE.Color() }, uTerrainPeak: { value: new THREE.Color() },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, ASPECT, .1, 200);
  const terrain = createTerrain(uniforms);
  scene.add(terrain.occlusion, terrain.ridges);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.minDistance = 4;
  controls.maxDistance = 100;
  controls.minPolarAngle = .04;
  controls.maxPolarAngle = Math.PI * .49;
  controls.screenSpacePanning = true;
  let preset = 'oblique';
  let fittedHeight = settings.height;
  let historyLayout = terrainHistoryLayout(settings.historySeconds);
  let fittedHistorySeconds = settings.historySeconds;
  let fittedRidgeSpacing = ridgeSpacing();
  let fittedFrequencySpread = frequencySpread();
  let onChange = () => {};
  let applyingCamera = false;
  let width = 1920, height = 1080, ratio = 2;
  let rasterWidth = 3840, rasterHeight = 2160;
  let currentEnergy = 0;
  const baseColor = new THREE.Color();
  const peakColor = new THREE.Color();
  const colorHsl = { h: 0, s: 0, l: 0 };
  let colorKey = '';

  controls.addEventListener('start', () => { preset = null; });
  controls.addEventListener('change', () => { if (!applyingCamera) onChange(); });

  function ridgeSpacing() {
    return Math.max(.5, Math.min(3, Number(settings.ridgeSpacing) || 1));
  }

  function frequencySpread() {
    return Math.max(1, Math.min(1.8, Number(settings.frequencySpread) || 1));
  }

  function setView(view = 'oblique', { onlyExpand = false } = {}) {
    if (!PRESETS[view]) throw new RangeError('Choose the oblique, front, or side view.');
    applyingCamera = true;
    const maxHeight = Math.max(.1, settings.height) * 2.3;
    const oldestZ = 5.25 - historyLayout.depth * ridgeSpacing();
    const rightEdge = 7 + 14 * (frequencySpread() - 1) * .65 / 3;
    const target = onlyExpand ? controls.target.clone()
      : new THREE.Vector3((rightEdge - 7) * .5, maxHeight * .08, (5.25 + oldestZ) * .5);
    const direction = new THREE.Vector3(...PRESETS[view]).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * ASPECT;
    let distance = 0;
    for (const x of [-7, rightEdge]) for (const y of [0, maxHeight]) for (const z of [oldestZ, 5.25]) {
      const delta = new THREE.Vector3(x, y, z).sub(target);
      const towardCamera = delta.dot(direction);
      distance = Math.max(distance, towardCamera + Math.abs(delta.dot(right)) / (tanX * .94),
        towardCamera + Math.abs(delta.dot(up)) / (tanY * .94));
    }
    if (onlyExpand && distance <= camera.position.distanceTo(target) + 1e-7) {
      fittedHistorySeconds = settings.historySeconds;
      fittedRidgeSpacing = ridgeSpacing();
      fittedFrequencySpread = frequencySpread();
      applyingCamera = false;
      return;
    }
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    preset = view;
    fittedHeight = settings.height;
    fittedHistorySeconds = settings.historySeconds;
    fittedRidgeSpacing = ridgeSpacing();
    fittedFrequencySpread = frequencySpread();
    applyingCamera = false;
    onChange();
  }

  function getCameraState() {
    return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom, preset };
  }

  function setCameraState(state) {
    const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
    if (!state || !vector(state.position) || !vector(state.target) || !Number.isFinite(state.zoom) || state.zoom <= 0) {
      throw new TypeError('Camera state requires finite position, target, and positive zoom.');
    }
    applyingCamera = true;
    camera.position.fromArray(state.position);
    controls.target.fromArray(state.target);
    camera.zoom = state.zoom;
    camera.updateProjectionMatrix();
    controls.update();
    // OrbitControls round-trips spherical coordinates; retain the exact saved
    // vectors so capture restoration produces byte-identical projected frames.
    camera.position.fromArray(state.position);
    controls.target.fromArray(state.target);
    camera.lookAt(controls.target);
    preset = PRESETS[state.preset] ? state.preset : null;
    applyingCamera = false;
    onChange();
  }

  function setSampleRate(value) {
    if (!(value > 0) || !Number.isFinite(value)) throw new RangeError('A positive audio sample rate is required.');
    if (value === sampleRate) return;
    sampleRate = value;
    ranges = createTerrainColumnRanges(sampleRate);
    history.reset();
  }

  function updateColors(levels) {
    const base = settings.terrainBase || '#507BCB';
    const peak = settings.terrainPeak || '#B6FFF1';
    const key = `${base}|${peak}`;
    if (key !== colorKey) {
      colorKey = key;
      // Custom shader output is display RGB, matching the native color picker.
      baseColor.set(base).convertLinearToSRGB();
      peakColor.set(peak).convertLinearToSRGB();
    }
    currentEnergy = terrainEnergy(levels);
    for (const [base, output] of [[baseColor, uniforms.uTerrainBase.value], [peakColor, uniforms.uTerrainPeak.value]]) {
      output.copy(base);
      if (settings.energyHue) {
        base.getHSL(colorHsl);
        output.setHSL(colorHsl.h + currentEnergy * .18,
          colorHsl.s + (1 - colorHsl.s) * currentEnergy * .22, colorHsl.l);
      }
    }
  }

  function resize(w, h, pixelRatio = 2) {
    const requestedWidth = Math.max(2, Number(w) || 1920);
    const requestedHeight = Math.max(2, Number(h) || 1080);
    width = Math.min(requestedWidth, requestedHeight * ASPECT);
    height = width / ASPECT;
    const requestedRatio = Math.max(1, Number(pixelRatio) || 1);
    // Integer multiples keep both capture and fractional CSS sizes exactly 16:9.
    const scale = Math.max(1, Math.ceil(Math.max(width * requestedRatio / 16, height * requestedRatio / 9) - 1e-6));
    rasterWidth = scale * 16;
    rasterHeight = scale * 9;
    ratio = rasterWidth / width;
    renderer.setPixelRatio(1);
    renderer.setSize(rasterWidth, rasterHeight, false);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    uniforms.uResolution.value.set(rasterWidth, rasterHeight);
    camera.aspect = ASPECT;
    camera.updateProjectionMatrix();
  }

  function render({ time = 0, analysis = null, levels = null } = {}) {
    if (disposed) return;
    if (settings.historySeconds !== historyLayout.seconds) historyLayout = terrainHistoryLayout(settings.historySeconds);
    if (preset && settings.height !== fittedHeight) setView(preset);
    else if (preset && (settings.historySeconds !== fittedHistorySeconds || ridgeSpacing() !== fittedRidgeSpacing
      || frequencySpread() !== fittedFrequencySpread)) {
      setView(preset, { onlyExpand: true });
    }
    uniforms.uFrame.value = Math.min(time * FPS, Math.max(0, history.latestFrame));
    uniforms.uGain.value = settings.gain;
    uniforms.uHeight.value = settings.height;
    uniforms.uSeconds.value = settings.historySeconds;
    uniforms.uSpacing.value = ridgeSpacing();
    uniforms.uFrequencySpread.value = frequencySpread();
    uniforms.uStroke.value = settings.lineWidth * renderer.domElement.height / 1080;
    uniforms.uFilterWidth.value = ratio;
    updateColors(levels);
    terrain.ridges.visible = terrain.occlusion.visible = Boolean(analysis?.buffer);
    terrain.updateLayers(historyLayout.ridges, camera.position.z >= controls.target.z);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, rasterWidth, rasterHeight);
    renderer.render(scene, camera);
  }

  function resetHistory() { history.reset(); currentEnergy = 0; }
  function dispose() {
    disposed = true;
    controls.dispose(); terrain.dispose(); history.dispose(); renderer.dispose(); renderer.domElement.remove();
  }
  setView('oblique');
  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  return {
    canvas: renderer.domElement, resize, render, setSampleRate,
    setHistoryFrames: frames => history.setFrames(frames), resetHistory, dispose,
    setView, getCameraState, setCameraState,
    setInteractionEnabled(enabled) { controls.enabled = Boolean(enabled); },
    onChange(callback) { onChange = typeof callback === 'function' ? callback : () => {}; },
    setOnChange(callback) { onChange = typeof callback === 'function' ? callback : () => {}; },
    getInfo: () => ({
      fftSize: 32768, fftBins: 16384, columns: TERRAIN_COLUMNS, ridges: historyLayout.ridges,
      maxRidges: TERRAIN_MAX_RIDGES, terrainDepth: historyLayout.depth * ridgeSpacing(),
      terrainWidth: 14 * (1 + (frequencySpread() - 1) * .65 / 3),
      ridgeTimeStep: TERRAIN_RIDGE_SECONDS, ridgeDepthStep: TERRAIN_RIDGE_SPACING * ridgeSpacing(),
      frequencySpread: uniforms.uFrequencySpread.value,
      ...history.getInfo(), sampleRate, pixelRatio: ratio,
      canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      view: preset, camera: getCameraState(),
      terrainColors: { base: uniforms.uTerrainBase.value.toArray(), peaks: uniforms.uTerrainPeak.value.toArray(),
        energy: currentEnergy, energyHue: Boolean(settings.energyHue) },
    }),
  };
}

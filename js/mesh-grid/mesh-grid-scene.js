/* Mesh Grid source adapted with permission from vizz.fm.
 * Copyright (c) 2026 Mathew Preziotte. Original source release 1b2b169.
 * https://vizz.fm/app/ — retrieved 2026-09-20.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MESH_DEFAULTS } from './mesh-grid-settings.js';
import {
  meshVertexShader,
  meshFragmentShader,
  dotVertexShader,
  dotFragmentShader,
  dotGlowFragmentShader,
  backgroundVertexShader,
  backgroundFragmentShader,
} from './mesh-grid-shaders.js';
import { createMeshGridEffects } from './mesh-grid-effects.js';
import { resolveEffectOrder } from './mesh-grid-effect-settings.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** One isolated simulation, renderer, camera and feedback history per preview/export. */
export function createMeshGridScene({
  settings,
  width = window.innerWidth,
  height = window.innerHeight,
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2),
  interactive = true,
}) {
  let currentSettings = settings;
  let cssWidth = Math.max(1, width);
  let cssHeight = Math.max(1, height);
  let basePixelRatio = pixelRatio;
  let clock = 0;
  let disposed = false;
  let lastFrame = { spectrum: new Uint8Array(settings.fftSize / 2), time: 0 };
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: pixelRatio < 1.5,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  const canvas = renderer.domElement;
  canvas.className = 'visualization-canvas';
  const camera = new THREE.PerspectiveCamera(settings.cameraFov, cssWidth / cssHeight, 0.1, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = interactive;
  controls.mouseButtons.RIGHT = null;
  controls.enableDamping = interactive;
  controls.dampingFactor = 0.05;
  const background = createBackground();
  scene.add(background);
  const resources = { scene, renderer, camera, controls, threeCanvas: canvas };
  let layer = createMeshLayer(resources, settings);
  let structure = `${settings.gridSizeX}:${settings.gridSizeY}`;
  const effects = createMeshGridEffects({ renderer, scene, camera, settings });
  const invalidateCamera = () => effects.invalidate();
  controls.addEventListener('change', invalidateCamera);
  const orbitOffset = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const panOffset = new THREE.Vector3();
  const panTotal = new THREE.Vector3();
  let previousZoom = null;
  let previousPanX = null;
  let previousPanY = null;

  function resetMotion() {
    previousZoom = previousPanX = previousPanY = null;
    panTotal.set(0, 0, 0);
  }

  function getCameraState() {
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      quaternion: camera.quaternion.toArray(),
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      zoom: camera.zoom,
    };
  }

  function setCameraState(state) {
    if (!state) return;
    camera.position.set(state.position.x, state.position.y, state.position.z);
    controls.target.set(state.target.x, state.target.y, state.target.z);
    camera.zoom = state.zoom ?? 1;
    controls.update(0);
    // Retain the serialized quaternion after OrbitControls' spherical round-trip.
    if (Array.isArray(state.quaternion)) camera.quaternion.fromArray(state.quaternion);
    else if (state.quaternion) camera.quaternion.copy(state.quaternion);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    resetMotion();
    effects.invalidate();
  }

  function advanceCamera(config, dt, time) {
    const { cameraRotationX: rx, cameraRotationY: ry, cameraRotationZ: rz } = config;
    if (rx || ry || rz) {
      orbitOffset.subVectors(camera.position, controls.target);
      if (ry) orbitOffset.applyAxisAngle(Y_AXIS, ry * 120 * dt);
      if (rx) orbitOffset.applyAxisAngle(X_AXIS, rx * 120 * dt);
      if (rz) orbitOffset.applyAxisAngle(Z_AXIS, rz * 120 * dt);
      camera.position.copy(controls.target).add(orbitOffset);
      camera.lookAt(controls.target);
    }
    if (config.cameraZoomAmount) {
      const phase = Math.sin((2 * Math.PI * time) / config.cameraZoomPeriod);
      if (previousZoom !== null) {
        orbitOffset.subVectors(camera.position, controls.target);
        orbitOffset.multiplyScalar(1 + config.cameraZoomAmount * (phase - previousZoom));
        camera.position.copy(controls.target).add(orbitOffset);
        camera.lookAt(controls.target);
      }
      previousZoom = phase;
    } else previousZoom = null;

    if (config.cameraPanAmount) {
      const phaseX = Math.sin((2 * Math.PI * time) / config.cameraPanPeriod);
      const phaseY = Math.sin((2 * Math.PI * time) / (1.618033988749895 * config.cameraPanPeriod));
      if (previousPanX !== null) {
        const distance = camera.position.distanceTo(controls.target);
        camera.getWorldDirection(direction);
        right.crossVectors(direction, camera.up).normalize();
        up.crossVectors(right, direction).normalize();
        panOffset
          .set(0, 0, 0)
          .addScaledVector(right, config.cameraPanAmount * distance * (phaseX - previousPanX))
          .addScaledVector(up, config.cameraPanAmount * distance * (phaseY - previousPanY));
        camera.position.add(panOffset);
        controls.target.add(panOffset);
        panTotal.add(panOffset);
      }
      previousPanX = phaseX;
      previousPanY = phaseY;
    } else {
      if (panTotal.lengthSq()) {
        camera.position.sub(panTotal);
        controls.target.sub(panTotal);
        panTotal.set(0, 0, 0);
      }
      previousPanX = previousPanY = null;
    }
    camera.fov = THREE.MathUtils.clamp(
      config.cameraFov +
        80 * config.cameraFovAmount * Math.sin((2 * Math.PI * time) / config.cameraFovPeriod),
      5,
      160,
    );
    camera.updateProjectionMatrix();
    controls.dampingFactor = 1 - Math.pow(0.95, 120 * dt);
    controls.update(dt);
  }

  function resize(w, h, ratio = basePixelRatio) {
    cssWidth = Math.max(1, Math.round(w));
    cssHeight = Math.max(1, Math.round(h));
    basePixelRatio = ratio;
    const appliedRatio = THREE.MathUtils.clamp(ratio * (currentSettings.renderScale || 1), 0.25, 4);
    renderer.setPixelRatio(appliedRatio);
    renderer.setSize(cssWidth, cssHeight, false);
    camera.aspect = cssWidth / cssHeight;
    camera.updateProjectionMatrix();
    effects.resize(cssWidth, cssHeight, appliedRatio);
  }

  function renderFrame(frame, dt) {
    const config = frame.settings || currentSettings;
    const spectrum = frame.spectrum;
    const processed = resolveEffectOrder(config).length > 0 || !!config.antiAliasing;
    let bass = 0;
    layer.step({
      dt,
      dataArray: spectrum,
      bufferLength: spectrum.length,
      controls: config,
      renderer,
      isPostProcessingActive: processed,
      render(value) {
        bass = value;
      },
    });
    advanceCamera(config, dt, clock);
    updateBackground(background, config, clock, bass, canvas.width, canvas.height);
    const savedPosition = camera.position.clone();
    const savedFov = camera.fov;
    const savedFar = camera.far;
    if (config.cameraFlatten > 0) {
      const flattenedFov = savedFov + (5 - savedFov) * config.cameraFlatten;
      const scale = Math.tan((savedFov * Math.PI) / 360) / Math.tan((flattenedFov * Math.PI) / 360);
      camera.position
        .copy(controls.target)
        .add(orbitOffset.subVectors(savedPosition, controls.target).multiplyScalar(scale));
      camera.fov = flattenedFov;
      camera.far *= scale;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }
    try {
      effects.render({ ...frame, time: clock, settings: config }, dt);
    } finally {
      if (config.cameraFlatten > 0) {
        camera.position.copy(savedPosition);
        camera.fov = savedFov;
        camera.far = savedFar;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      }
    }
  }

  function step(frame, dt = 1 / 60) {
    if (disposed) return;
    const delta = Math.max(0, Number.isFinite(dt) ? dt : 0);
    clock = Number.isFinite(frame.time) ? frame.time : clock + delta;
    lastFrame = frame;
    renderFrame(frame, delta);
  }

  function setSettings(nextSettings) {
    currentSettings = nextSettings;
    const nextStructure = `${nextSettings.gridSizeX}:${nextSettings.gridSizeY}`;
    if (nextStructure !== structure) {
      const state = getCameraState();
      layer.dispose();
      layer = createMeshLayer(resources, nextSettings);
      structure = nextStructure;
      setCameraState(state);
      effects.reset();
    }
    effects.setSettings(nextSettings);
    lastFrame = { ...lastFrame, settings: undefined };
    resize(cssWidth, cssHeight, basePixelRatio);
  }

  function reset() {
    const state = currentSettings.cameraState;
    layer.dispose();
    layer = createMeshLayer(resources, currentSettings);
    clock = 0;
    lastFrame = { spectrum: new Uint8Array(currentSettings.fftSize / 2), time: 0 };
    effects.reset();
    resetMotion();
    if (state) setCameraState(state);
    else {
      controls.target.set(0, 0, 0);
      controls.update(0);
    }
  }

  function applyPreset(nextSettings) {
    setSettings(nextSettings);
    reset();
  }

  function onContextLost(event) {
    event.preventDefault();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  resize(cssWidth, cssHeight, basePixelRatio);
  if (settings.cameraState) setCameraState(settings.cameraState);

  return {
    canvas,
    renderer,
    camera,
    controls,
    scene,
    get geometry() {
      return layer.geometry;
    },
    step,
    render() {
      if (!disposed) renderFrame(lastFrame, 0);
    },
    setSettings,
    applyPreset,
    reset,
    resize,
    getCameraState,
    setCameraState,
    setInteractive(enabled) {
      controls.enabled = enabled;
      controls.enableDamping = enabled;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controls.removeEventListener('change', invalidateCamera);
      controls.dispose();
      layer.dispose();
      effects.dispose();
      background.geometry.dispose();
      background.material.dispose();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
    },
  };
}

const scaleFrameStep = (speed, dt) => speed * dt * 120;
const smoothFrameValue = (previous, next, damping, dt) =>
  Number.isNaN(next)
    ? previous
    : Number.isNaN(previous)
      ? next
      : previous + (next - previous) * (1 - Math.pow(damping, 120 * dt));

// Original fixed Perlin permutation and interpolation; no random seed or wall clock.
function perlinFade(e) {
  return e * e * e * (e * (6 * e - 15) + 10);
}
function perlinGradient(e, t, a, r) {
  let n = 15 & e,
    o = n < 8 ? t : a,
    i = n < 4 ? a : 12 === n || 14 === n ? t : r;
  return ((1 & n) == 0 ? o : -o) + ((2 & n) == 0 ? i : -i);
}
let perlinPermutation = (() => {
  let e = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69,
      142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219,
      203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
      74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230,
      220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209,
      76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198,
      173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
      207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44,
      154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79,
      113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12,
      191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
      184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29,
      24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
    ],
    t = Array(512);
  for (let a = 0; a < 256; a++) t[a] = t[a + 256] = e[a];
  return t;
})();
// 240 samples span three seconds of radial waterfall history.
const HISTORY_STEP_SECONDS = 3 / 240;

// The geometry kernel below retains upstream equations and local identifiers so
// its numerical behavior can be compared directly with source release 1b2b169.
// Persistent mesh/history storage uses descriptive names; per-vertex temporaries
// retain the source names to keep the copied equations directly traceable.
// React refs/lifecycle are replaced by instance-owned storage and explicit steps.
function createMeshLayer(resources, settings) {
  const ref = (current) => ({ current });
  const t = settings;
  const { gridColor: r, gridSizeX: n, gridSizeY: i } = settings;
  let wireMesh = ref(null),
    baseColor = ref(new THREE.Color(r)),
    elapsed = ref(0),
    positions = ref(null),
    originalPositions = ref(null),
    frequencies = ref(null),
    wireMaterial = ref(null),
    previousHeights = ref(null),
    fillMesh = ref(null),
    fillMaterial = ref(null),
    dotMesh = ref(null),
    dotMaterial = ref(null),
    glowMesh = ref(null),
    glowMaterial = ref(null),
    history = ref(null),
    historyTime = ref(0),
    lastHistoryTick = ref(-1);
  const childrenBefore = new Set(resources.scene.children);
  const setup = () => {
    let a = resources,
      { scene: r, camera: o } = a,
      u = Math.max(n, i);
    o.position.set((0.4 * n) / 2, (0.4 * u) / 2, 0.4 * u * 1.5),
      o.lookAt((0.4 * n) / 2, 0, (0.4 * i) / 2);
    let w = new THREE.PlaneGeometry(n, i, n - 1, i - 1);
    w.rotateX(-Math.PI / 2);
    let C = w.attributes.position.array;
    originalPositions.current = new Float32Array(C.length);
    for (let e = 0; e < C.length; e++) originalPositions.current[e] = C[e];
    positions.current = C;
    let k = C.length / 3,
      M = new Float32Array(k);
    for (let e = 0; e < k; e++) M[e] = 0;
    (frequencies.current = M), (previousHeights.current = new Float32Array(k));
    for (let e = 0; e < k; e++) previousHeights.current[e] = 0;
    w.setAttribute('frequency', new THREE.BufferAttribute(M, 1));
    let A = new Float32Array(2 * k);
    for (let e = 0; e < k; e++) (A[2 * e] = C[3 * e]), (A[2 * e + 1] = C[3 * e + 2]);
    w.setAttribute('planarPos', new THREE.BufferAttribute(A, 2));
    let R = new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: baseColor.current },
        time: { value: 0 },
        colorIntensity: { value: t.colorIntensity ?? MESH_DEFAULTS.colorIntensity },
        colorReactivity: { value: t.colorReactivity ?? MESH_DEFAULTS.colorReactivity },
        circleMode: { value: +!!t.circleShape },
        gridHalfX: { value: n / 2 },
        gridHalfZ: { value: i / 2 },
        angleHueMix: { value: 0 },
        surfaceOpacity: { value: 1 },
        surfaceShade: { value: 1 },
        fillReactivity: { value: 0 },
      },
      vertexShader: meshVertexShader,
      fragmentShader: meshFragmentShader,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    wireMaterial.current = R;
    let T = new THREE.Mesh(w, R);
    r.add(T), (wireMesh.current = T), T.position.set(0, 0, 0);
    let E = new THREE.ShaderMaterial({
        uniforms: {
          baseColor: { value: baseColor.current },
          time: { value: 0 },
          colorIntensity: { value: t.colorIntensity ?? MESH_DEFAULTS.colorIntensity },
          colorReactivity: { value: t.colorReactivity ?? MESH_DEFAULTS.colorReactivity },
          circleMode: { value: +!!t.circleShape },
          gridHalfX: { value: n / 2 },
          gridHalfZ: { value: i / 2 },
          angleHueMix: { value: 0 },
          surfaceOpacity: { value: 0 },
          surfaceShade: { value: 0.55 },
          fillReactivity: { value: 0 },
        },
        vertexShader: meshVertexShader,
        fragmentShader: meshFragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      _ = new THREE.Mesh(w, E);
    (_.visible = false),
      (T.renderOrder = 1),
      r.add(_),
      (fillMaterial.current = E),
      (fillMesh.current = _);
    let D = new THREE.ShaderMaterial({
        uniforms: {
          baseColor: { value: baseColor.current },
          time: { value: 0 },
          colorIntensity: { value: t.colorIntensity ?? MESH_DEFAULTS.colorIntensity },
          colorReactivity: { value: t.colorReactivity ?? MESH_DEFAULTS.colorReactivity },
          circleMode: { value: +!!t.circleShape },
          gridHalfX: { value: n / 2 },
          gridHalfZ: { value: i / 2 },
          angleHueMix: { value: 0 },
          dotSize: { value: 0 },
          dotReactivity: { value: 0.5 },
          uPixelRatio: { value: a.renderer.getPixelRatio() },
          sizeMul: { value: 1 },
        },
        vertexShader: dotVertexShader,
        fragmentShader: dotFragmentShader,
        transparent: true,
        depthWrite: false,
      }),
      z = new THREE.Points(w, D);
    (z.visible = false),
      (z.renderOrder = 2),
      r.add(z),
      (dotMaterial.current = D),
      (dotMesh.current = z);
    let P = new THREE.ShaderMaterial({
        uniforms: {
          baseColor: { value: baseColor.current },
          time: { value: 0 },
          colorIntensity: { value: t.colorIntensity ?? MESH_DEFAULTS.colorIntensity },
          colorReactivity: { value: t.colorReactivity ?? MESH_DEFAULTS.colorReactivity },
          circleMode: { value: +!!t.circleShape },
          gridHalfX: { value: n / 2 },
          gridHalfZ: { value: i / 2 },
          angleHueMix: { value: 0 },
          dotSize: { value: 0 },
          dotReactivity: { value: 0.5 },
          dotGlow: { value: 0 },
          uPixelRatio: { value: a.renderer.getPixelRatio() },
          sizeMul: { value: 3.5 },
        },
        vertexShader: dotVertexShader,
        fragmentShader: dotGlowFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      I = new THREE.Points(w, P);
    (I.visible = false),
      (I.renderOrder = 3),
      r.add(I),
      (glowMaterial.current = P),
      (glowMesh.current = I);
    let F = new THREE.AmbientLight(0xffffff, 0.5);
    r.add(F);
    let O = new THREE.DirectionalLight(0xffffff, 1);
    O.position.set(1, 1, 1), r.add(O);
    let L = new THREE.PointLight(0xffffff, 1, 100);
    return L.position.set(n / 2, 10, i / 2), r.add(L), a;
  };
  setup();
  const owned = resources.scene.children.filter((object) => !childrenBefore.has(object));
  // Displaced/wrapped surfaces may extend beyond the original flat bounds.
  for (const object of owned) object.frustumCulled = false;
  const draw = (e) => {
    let { dt: t, dataArray: a, bufferLength: r } = e,
      {
        cellSize: o,
        waveHeight: s,
        waveSpeed: y,
        waveComplexity: M = 0.7,
        colorIntensity: A = 0.8,
        colorReactivity: R = 1,
        dampeningFactor: T = 0.5,
        jaggedness: E = 0.6,
        perlinNoiseIntensity: _ = 0.2,
        perlinNoiseScale: D = 0.1,
        perlinNoiseSpeed: z = 0.1,
        meshBend: P = 0,
        sphereWrap: I = 0,
        spectrumSpiral: F = 0,
        spiralTurns: O = 3,
        spectrumSpread: L = 0,
        circleShape: U = false,
        radialMix: j = 1,
        flowMix: N = 0,
        angleHueMix: B = 0,
        fillOpacity: q = 0,
        fillReactivity: G = 0,
        lineReactivity: V = 0,
        dotSize: W = 0,
        dotReactivity: H = 0.5,
        dotGlow: $ = 0,
        sensitivity: Y = 1,
      } = e.controls;
    if (!positions.current || !originalPositions.current || !wireMesh.current) return;
    if (((elapsed.current += scaleFrameStep(0.01, t) * y), wireMaterial.current)) {
      (wireMaterial.current.uniforms.time.value = elapsed.current),
        (wireMaterial.current.uniforms.colorIntensity.value = A),
        (wireMaterial.current.uniforms.colorReactivity.value = R),
        (wireMaterial.current.uniforms.circleMode.value = +!!U),
        (wireMaterial.current.uniforms.angleHueMix.value = B),
        (wireMaterial.current.uniforms.surfaceOpacity.value = 1 - W * W),
        (wireMaterial.current.uniforms.fillReactivity.value = V);
      let e = W > 0 || V > 0;
      (wireMaterial.current.transparent = e),
        (wireMaterial.current.depthWrite = !e),
        (wireMesh.current.visible = W < 0.999);
    }
    if (fillMaterial.current && fillMesh.current) {
      let e = fillMaterial.current.uniforms;
      (e.time.value = elapsed.current),
        (e.colorIntensity.value = A),
        (e.colorReactivity.value = R),
        (e.circleMode.value = +!!U),
        (e.angleHueMix.value = B),
        (e.surfaceOpacity.value = q),
        (e.fillReactivity.value = G),
        (fillMaterial.current.depthWrite = q >= 0.99 && G <= 0.01),
        (fillMesh.current.visible = q > 0),
        fillMesh.current.scale.set(o, 1, o);
    }
    let Z = e.isPostProcessingActive ? 1 : e.renderer.getPixelRatio();
    if (dotMaterial.current && dotMesh.current) {
      let e = dotMaterial.current.uniforms;
      (e.uPixelRatio.value = Z),
        (e.time.value = elapsed.current),
        (e.colorIntensity.value = A),
        (e.colorReactivity.value = R),
        (e.circleMode.value = +!!U),
        (e.angleHueMix.value = B),
        (e.dotSize.value = W),
        (e.dotReactivity.value = H),
        (dotMesh.current.visible = W > 0),
        dotMesh.current.scale.set(o, 1, o);
    }
    if (glowMaterial.current && glowMesh.current) {
      let e = glowMaterial.current.uniforms;
      (e.uPixelRatio.value = Z),
        (e.time.value = elapsed.current),
        (e.colorIntensity.value = A),
        (e.colorReactivity.value = R),
        (e.circleMode.value = +!!U),
        (e.angleHueMix.value = B),
        (e.dotSize.value = W),
        (e.dotReactivity.value = H),
        (e.dotGlow.value = $),
        (glowMesh.current.visible = W > 0 && $ > 0),
        glowMesh.current.scale.set(o, 1, o);
    }
    wireMesh.current && wireMesh.current.scale.set(o, 1, o);
    let K = positions.current,
      X = originalPositions.current,
      Q = wireMesh.current.geometry,
      J = frequencies.current,
      ee = Math.floor(0.1 * r),
      et = Math.floor(0.5 * r),
      ea = 0;
    for (let e = 0; e < ee; e++) ea += a[e];
    let er = 0;
    for (let e = ee; e < et; e++) er += a[e];
    let en = ea / (0.1 * r) / 255,
      eo = er / (0.4 * r) / 255;
    (history.current && history.current.length === 240 * r) ||
      ((history.current = new Uint8Array(240 * r)),
      (historyTime.current = 0),
      (lastHistoryTick.current = -1));
    // Capture spectrum at 80 Hz; repeat the latest sample across skipped ticks.
    let ei = history.current;
    historyTime.current += t;
    let el = Math.floor(historyTime.current / HISTORY_STEP_SECONDS);
    if (el > lastHistoryTick.current) {
      let e = Math.max(lastHistoryTick.current + 1, el - 240 + 1);
      for (let t = e; t <= el; t++) {
        let e = (t % 240) * r;
        for (let t = 0; t < r; t++) ei[e + t] = a[t];
      }
      lastHistoryTick.current = el;
    }
    let es = 240 * N,
      eu = Math.min(239, el),
      ec = K.length / 3,
      ed = (n - 1) / 2,
      ef = (i - 1) / 2,
      em = Math.sqrt(ed * ed + ef * ef),
      ep = em > 0 ? 1 / em : 0,
      eh = 1 + 2 * L,
      eg = I > 0.001,
      ev = eg ? Math.min(n, i) / 2 / (I * Math.PI) : 0,
      eb = 1 / o,
      ey = eg ? 0.5 * o * ev * (1 - Math.cos(I * Math.PI)) : 0;
    (wireMesh.current.position.y = ey),
      fillMesh.current && (fillMesh.current.position.y = ey),
      dotMesh.current && (dotMesh.current.position.y = ey),
      glowMesh.current && (glowMesh.current.position.y = ey);
    // Radius selects spectrum/time history; spiral and angular waves share the same surface.
    for (let e = 0; e < ec; e++) {
      let i = X[3 * e + 1],
        l = e % n | 0,
        c = (e / n) | 0,
        d = l - ed,
        m = c - ef,
        h = Math.min(Math.sqrt(d * d + m * m) * ep, 1),
        g = Math.atan2(m, d),
        v = (g + Math.PI) / (2 * Math.PI),
        b = Math.min(Math.floor((L > 0 ? Math.pow(h, eh) : h) * (r - 1)), a.length - 1),
        y = -1;
      if (N > 0) {
        let e = Math.min(Math.floor(h * es), eu);
        e > 0 && (y = ((el - e + 240) % 240) * r);
      }
      let x = y >= 0 ? ei[y + b] / 255 : (a[b] ?? 0) / 255;
      if (F > 0) {
        let e = (h * O + v) % 1;
        L > 0 && (e = Math.pow(e, eh));
        let t = Math.min(Math.floor(e * (r - 1)), a.length - 1),
          n = y >= 0 ? ei[y + t] / 255 : (a[t] ?? 0) / 255;
        x += (n - x) * F;
      }
      let S = x,
        w = 0,
        C = 0;
      if (j > 0) {
        let e = Math.pow(M, 0.7);
        (w = 0.3 * Math.sin(4 * g + elapsed.current) * E * j),
          M > 0.3 &&
            (w += 0.2 * Math.sin(8 * g - 1.5 * elapsed.current) * E * j * ((M - 0.3) / 0.7)),
          M > 0.6 &&
            (w += 0.15 * Math.sin(12 * g + 0.7 * elapsed.current) * E * j * ((M - 0.6) / 0.4)),
          (C =
            Math.sin((Math.floor(v * (4 + 8 * e)) / (4 + 8 * e)) * Math.PI * (8 + 16 * e)) *
            E *
            0.2 *
            j);
      }
      let k = 0;
      if (j < 1) {
        if (
          ((k =
            (0.3 * Math.sin(4 * g + 2 * elapsed.current) +
              0.3 * Math.sin(6 * h - 1.5 * elapsed.current)) *
            S *
            (1 - j)),
          M > 0.2)
        ) {
          let e = Math.min(1, (M - 0.2) / 0.8);
          k +=
            (0.4 * Math.sin(8 * h - 2 * g + elapsed.current) * e +
              0.4 * Math.sin(6 * g + 5 * h - 1.2 * elapsed.current) * e) *
            S *
            (1 - j);
        }
        if (M > 0.4) {
          let e = Math.min(1, (M - 0.4) / 0.6);
          k +=
            (Math.sin(3 * g - 1.5 * elapsed.current) * eo * 0.6 * e +
              Math.sin(2 * g + 4 * h - 2.5 * elapsed.current) * (en + eo) * 0.5 * e) *
            (1 - j);
        }
      }
      let A = S + w + C + k;
      if (E > 0.1) {
        let e = Math.max(2, Math.floor(8 * (1 - E)));
        A = Math.floor(A * e) / e;
      }
      (A = Math.min(1, Math.max(0, A))), frequencies.current && (frequencies.current[e] = A);
      let R = 0;
      if (j > 0) {
        let e = M > 0.5 ? Math.floor(10 * h) / 10 : h;
        if (((R = x * (1 + en) * 1.5 * j), M > 0.3)) {
          let t = Math.min(1, (M - 0.3) / 0.7),
            a = 8 * e - elapsed.current;
          R +=
            (Math.sin(a) > 0 ? 1 : -1) *
            Math.pow(Math.abs(Math.sin(a)), 0.5) *
            en *
            E *
            0.8 *
            t *
            j;
        }
        if (M > 0.5) {
          let e = Math.min(1, (M - 0.5) / 0.5);
          R += Math.sin(3 * g + 2 * elapsed.current) * eo * E * 0.4 * e * j;
        }
        if (M > 0.7) {
          let e = Math.min(1, (M - 0.7) / 0.3);
          R += Math.sin(15 * h - 6 * en - 2 * elapsed.current) * en * 0.8 * e * j;
        }
      }
      let I = 0;
      if (j < 1) {
        if (((I = x * (1 + en) * 1.5 * (1 - j)), M > 0.2)) {
          let e = Math.min(1, (M - 0.2) / 0.8);
          I += Math.sin(8 * h - 2 * elapsed.current) * en * 0.8 * e * (1 - j);
        }
        if (M > 0.4) {
          let e = Math.min(1, (M - 0.4) / 0.6);
          I +=
            (Math.sin(3 * g - 1.5 * elapsed.current) * eo * 0.6 * e +
              Math.sin(2 * g + 4 * h - 2.5 * elapsed.current) * (en + eo) * 0.5 * e) *
            (1 - j);
        }
        if (M > 0.6) {
          let e = Math.min(1, (M - 0.6) / 0.4);
          I +=
            (Math.sin(10 * h) * Math.sin(4 * g) * en * 0.7 * e +
              Math.sin(15 * h - 3 * elapsed.current) * eo * 0.5 * e) *
            (1 - j);
        }
        if (M > 0.8) {
          let e = Math.min(1, (M - 0.8) / 0.2);
          I += 0.2 * Math.sin(8 * g + 20 * h + 0.5 * elapsed.current) * e * (1 - j);
        }
      }
      // Audio-driven radial/flow waves, followed by the source fixed Perlin field.
      let U = (R + I) * s * Y;
      if (
        (_ > 0 &&
          (U +=
            (2 *
              (function (e, t, a) {
                var r, n, o, i, l, s, u;
                let c = 255 & Math.floor(e),
                  d = 255 & Math.floor(t),
                  f = 255 & Math.floor(a);
                (e -= Math.floor(e)), (t -= Math.floor(t)), (a -= Math.floor(a));
                let m = perlinFade(e),
                  p = perlinFade(t),
                  h = perlinFade(a),
                  g = perlinPermutation[c] + d,
                  v = perlinPermutation[g] + f,
                  b = perlinPermutation[g + 1] + f,
                  y = perlinPermutation[c + 1] + d,
                  x = perlinPermutation[y] + f,
                  S = perlinPermutation[y + 1] + f;
                return (
                  0.5 +
                  0.5 *
                    ((u =
                      (o =
                        (r = perlinGradient(perlinPermutation[v], e, t, a)) +
                        m * (perlinGradient(perlinPermutation[x], e - 1, t, a) - r)) +
                      p *
                        ((n = perlinGradient(perlinPermutation[b], e, t - 1, a)) +
                          m * (perlinGradient(perlinPermutation[S], e - 1, t - 1, a) - n) -
                          o)),
                    u +
                      h *
                        ((s =
                          (i = perlinGradient(perlinPermutation[v + 1], e, t, a - 1)) +
                          m * (perlinGradient(perlinPermutation[x + 1], e - 1, t, a - 1) - i)) +
                          p *
                            ((l = perlinGradient(perlinPermutation[b + 1], e, t - 1, a - 1)) +
                              m *
                                (perlinGradient(perlinPermutation[S + 1], e - 1, t - 1, a - 1) -
                                  l) -
                              s) -
                          u))
                );
              })(l * D, c * D, elapsed.current * z) -
              1) *
            _ *
            s),
        E > 0.1)
      ) {
        let e = Math.max(3, Math.floor(20 * (1 - E)));
        U = Math.floor(U * e) / e;
      }
      let B = U;
      previousHeights.current &&
        ((B = smoothFrameValue(previousHeights.current[e], U, T * (1 - 0.5 * E), t)),
        (previousHeights.current[e] = B));
      let q = i + P * (1 - h * h * 2) + B;
      // Sphere wrapping keeps planarPos untouched for clipping and color.
      if (eg) {
        let t = X[3 * e],
          a = X[3 * e + 2],
          r = Math.sqrt(t * t + a * a),
          n = Math.min(r / ev, Math.PI),
          i = Math.sin(n),
          l = Math.cos(n),
          s = r > 1e-6 ? 1 / r : 0,
          u = t * s,
          c = a * s;
        (K[3 * e] = (ev + q * eb) * i * u),
          (K[3 * e + 1] = o * ev * (l - 1) + q * l),
          (K[3 * e + 2] = (ev + q * eb) * i * c);
      } else (K[3 * e] = X[3 * e]), (K[3 * e + 1] = q), (K[3 * e + 2] = X[3 * e + 2]);
    }
    wireMesh.current && J && (Q.attributes.frequency.needsUpdate = true),
      (Q.attributes.position.needsUpdate = true),
      e.render(en);
  };
  return {
    geometry: wireMesh.current.geometry,
    step(frame) {
      baseColor.current.set(frame.controls.gridColor);
      for (const material of [
        wireMaterial.current,
        fillMaterial.current,
        dotMaterial.current,
        glowMaterial.current,
      ]) {
        material.uniforms.baseColor.value.copy(baseColor.current);
      }
      draw(frame);
    },
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      for (const object of owned) {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
        resources.scene.remove(object);
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

const BACKGROUND_TYPES = {
  solid: 0,
  'gradient-linear': 1,
  'gradient-radial': 2,
  starfield: 3,
  plasma: 4,
  dust: 5,
  glow: 6,
  sky: 7,
};
const ANIMATED_BACKGROUNDS = new Set(['starfield', 'plasma', 'dust', 'glow', 'sky']);
const BACKGROUND_UNIFORMS = {
  backgroundRadialX: ['uRadialX', 0.5],
  backgroundRadialY: ['uRadialY', 0.5],
  backgroundRadialRadius: ['uRadialRadius', 0.5],
  backgroundRadialSharpness: ['uRadialSharpness', 1],
  backgroundStarDensity: ['uStarDensity', 1],
  backgroundTwinkleSpeed: ['uTwinkleSpeed', 1],
  backgroundAudioReactivity: ['uAudioReactivity', 0],
  backgroundPlasmaScale: ['uPlasmaScale', 5],
  backgroundPlasmaSpeed: ['uPlasmaSpeed', 1.2],
  backgroundPlasmaComplexity: ['uPlasmaComplexity', 3],
  backgroundDustDensity: ['uDustDensity', 1],
  backgroundDustSpeed: ['uDustSpeed', 1],
  backgroundDustOpacity: ['uDustOpacity', 1],
  backgroundDustSharpness: ['uDustSharpness', 0.5],
  backgroundGlowSize: ['uGlowSize', 1],
  backgroundGlowSpeed: ['uGlowSpeed', 1],
  backgroundGrain: ['uGrain', 0],
  backgroundSkySunSize: ['uSkySunSize', 0.12],
  backgroundSkyHaze: ['uSkyHaze', 0.5],
  backgroundSkyGlare: ['uSkyGlare', 0.3],
  backgroundSkyField: ['uSkyField', 0.15],
  backgroundSkyStreaks: ['uSkyStreaks', 0],
  backgroundSkyFlare: ['uSkyFlare', 0],
};

function setUniformColor(uniform, hex) {
  if (uniform.lastHex !== hex) {
    uniform.value.set(hex);
    uniform.lastHex = hex;
  }
}

function createBackground() {
  let geometry = new THREE.PlaneGeometry(2, 2),
    material = new THREE.ShaderMaterial({
      uniforms: {
        uBackgroundType: { value: 0 },
        uColor1: { value: new THREE.Color('#000000') },
        uColor2: { value: new THREE.Color('#ffffff') },
        uGradientAngle: { value: Math.PI / 4 },
        uRadialX: { value: 0.5 },
        uRadialY: { value: 0.5 },
        uRadialRadius: { value: 0.5 },
        uRadialSharpness: { value: 1 },
        uTime: { value: 0 },
        uAudioValue: { value: 0 },
        uStarDensity: { value: 1 },
        uTwinkleSpeed: { value: 1 },
        uAudioReactivity: { value: 0 },
        uPlasmaScale: { value: 5 },
        uPlasmaSpeed: { value: 1.2 },
        uPlasmaComplexity: { value: 3 },
        uDustDensity: { value: 1 },
        uDustSpeed: { value: 1 },
        uDustOpacity: { value: 1 },
        uDustSharpness: { value: 0.5 },
        uColor3: { value: new THREE.Color('#000000') },
        uGlowSize: { value: 1 },
        uGlowSpeed: { value: 1 },
        uGrain: { value: 0 },
        uSkySunSize: { value: 0.12 },
        uSkyHaze: { value: 0.5 },
        uSkyGlare: { value: 0.3 },
        uSkyField: { value: 0.15 },
        uSkyStreaks: { value: 0 },
        uSkyFlare: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uFadeAlpha: { value: 1 },
        uNeutral: { value: -1 },
        uBlendMode: { value: 0 },
        uFramebuffer: { value: null },
      },
      vertexShader: backgroundVertexShader,
      fragmentShader: backgroundFragmentShader,
      depthTest: false,
      depthWrite: false,
    }),
    mesh = new THREE.Mesh(geometry, material);
  return (
    (mesh.frustumCulled = false),
    (mesh.renderOrder = -1e3),
    (mesh.name = 'screenSpaceBackground'),
    mesh
  );
}
/** Same upstream screen-space background uniforms, driven by the injected clock. */
function updateBackground(mesh, settings, time, audio = 0, width = 1, height = 1) {
  const uniforms = mesh.material.uniforms;
  const type = settings.backgroundType ?? 'solid';
  uniforms.uBackgroundType.value = BACKGROUND_TYPES[type] ?? 0;
  setUniformColor(uniforms.uColor1, settings.backgroundColor ?? '#000000');
  setUniformColor(uniforms.uColor2, settings.backgroundGradientColor ?? '#ffffff');
  setUniformColor(uniforms.uColor3, settings.backgroundAccentColor ?? '#000000');
  uniforms.uGradientAngle.value = ((settings.backgroundGradientAngle ?? 45) * Math.PI) / 180;
  for (const [key, [uniform, fallback]] of Object.entries(BACKGROUND_UNIFORMS)) {
    uniforms[uniform].value = settings[key] ?? fallback;
  }
  uniforms.uTime.value = time;
  uniforms.uResolution.value.set(width, height);
  uniforms.uAudioValue.value = ANIMATED_BACKGROUNDS.has(type) ? audio : 0;
}

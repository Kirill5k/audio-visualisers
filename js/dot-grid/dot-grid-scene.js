/**
 * Dot Grid adapted from Vizz.fm with the author’s permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/9583-5bcee8001b3090e9.js
 * Source SHA-256: 049859defa821b49da55dd5e2aa55a68489e73c1bd528081dd1507ba80971cc9
 * Retrieved 2026-10-25. No additional license is granted.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { backgroundVertexShader, backgroundFragmentShader } from '../mesh-grid/mesh-grid-shaders.js';
import { createParticleDanceEffects } from '../particle-dance/particle-dance-effects.js';
import { resolveEffectOrder } from '../particle-dance/particle-dance-effect-settings.js';
import { createDotGridLoomMapper } from './dot-grid-loom.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** One isolated simulation, renderer, camera and feedback history per preview/export. */
export function createDotGridScene({
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
  let lastBass = 0;
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
  const initialSpan = Math.max((settings.gridWidth - 1) * settings.spacing, (settings.gridHeight - 1) * settings.spacing);
  camera.position.set(0, 0.8 * initialSpan, 0.8 * initialSpan);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = interactive;
  controls.mouseButtons.RIGHT = null;
  controls.enableDamping = interactive;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  controls.update(0);
  const background = createBackground();
  scene.add(background);
  const resources = { scene, renderer, camera, controls, threeCanvas: canvas };
  // Both the shared upstream scene setup and Dot Grid add their own light pair.
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const mainLight = new THREE.DirectionalLight(0xffffff, 1);
  mainLight.position.set(10, 10, 10);
  scene.add(mainLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const gridLight = new THREE.DirectionalLight(0xffffff, 1);
  gridLight.position.set(5, 10, 5);
  scene.add(gridLight);
  const layer = createDotGridLayer(resources, settings);
  const effects = createParticleDanceEffects({ renderer, scene, camera, settings });
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
    // Consume outstanding pointer damping before restoring a preset/seek. This
    // prevents a previous drag from moving a freshly restored camera next frame.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update(0);
    controls.enableDamping = damping;
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

  function renderFrame(frame, dt, advanceLayer = true) {
    const config = frame.settings || currentSettings;
    const spectrum = frame.spectrum;
    const processed = resolveEffectOrder(config).length > 0 || !!config.antiAliasing;
    let bass = lastBass;
    if (advanceLayer) layer.step({
      dt,
      // Explicit zero-time steps are paused control edits; render() skips this
      // path entirely and preserves every instance byte.
      immediate: dt === 0,
      dataArray: spectrum,
      bufferLength: spectrum.length,
      effectiveRange: frame.effectiveRange,
      loom: frame.loom,
      controls: config,
      renderer,
      pixelRatio: basePixelRatio,
      isPostProcessingActive: processed,
      render(value) {
        bass = lastBass = value;
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
    layer.setSettings(nextSettings);
    effects.setSettings(nextSettings);
    lastFrame = { ...lastFrame, settings: undefined };
    resize(cssWidth, cssHeight, basePixelRatio);
  }

  function reset() {
    const state = currentSettings.cameraState;
    layer.reset();
    clock = lastBass = 0;
    lastFrame = { spectrum: new Uint8Array(currentSettings.fftSize / 2), time: 0 };
    effects.reset();
    resetMotion();
    if (state) setCameraState(state);
    else {
      const span = Math.max((currentSettings.gridWidth - 1) * currentSettings.spacing, (currentSettings.gridHeight - 1) * currentSettings.spacing);
      camera.position.set(0, 0.8 * span, 0.8 * span);
      controls.target.set(0, 0, 0);
      camera.zoom = 1;
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
  layer.step({ dt: 0, dataArray: lastFrame.spectrum, controls: settings, render() {} });

  return {
    canvas,
    renderer,
    camera,
    controls,
    scene,
    get geometry() {
      return layer.geometry;
    },
    getDiagnostics: () => layer.getDiagnostics(),
    step,
    render() {
      if (!disposed) renderFrame(lastFrame, 0, false);
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


/**
 * Readable adaptation of the upstream `dot-grid` visualization hook. The mesh,
 * spectral routing, asymmetric scale decay, 120 Hz delay history, HSL response,
 * neighborhood terrain smoothing and plane/sphere interpolation are retained.
 */
function createDotGridLayer({ scene }, settings) {
  let mesh = null;
  let columns = 0, rows = 0;
  let gridCoordinates, previousScales, scales, rawHeights, heights, colors;
  let history = [], historyIndex = 0, historyAccumulator = 0, waveTime = 0;
  let peakScale = 0, peakHeight = 0;
  const matrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();
  const baseColor = new THREE.Color();
  const reactiveColor = new THREE.Color();
  const mixedColor = new THREE.Color();
  const baseHsl = { h: 0, s: 0, l: 0 };
  const loomMapper = createDotGridLoomMapper();
  const loomPalette = Array.from({ length: 4 }, () => new THREE.Color());
  let displayMode = 'dots', loomTime = 0;

  function stepLoom(frame) {
    const config = frame.controls;
    const light = loomMapper.map(frame.loom, config, columns, rows);
    const paletteHex = [config.loomViolet ?? '#7446ff', config.loomBlue ?? '#2f5bff',
      config.loomAmber ?? '#ffa53d', config.loomWhite ?? '#fff1d0'];
    for (let index = 0; index < 4; index++) loomPalette[index].set(paletteHex[index]);
    const brightness = Math.max(0, config.loomBrightness ?? 1);
    const baseScale = Math.max(0, config.dotSize ?? .13) / .1;
    const sizeResponse = Math.max(0, config.maxScale ?? 1) * .35;
    peakScale = peakHeight = 0;
    loomTime = frame.loom?.time ?? 0;
    // Palette coefficients are already mapped to emitted light by Spectral Loom.
    // Keep them linear through interpolation: a fading white peak stays white.
    for (let index = 0; index < columns * rows; index++) {
      const offset = index * 4;
      const intensity = light[offset] + light[offset + 1] + light[offset + 2] + light[offset + 3];
      const energy = Math.min(1, intensity);
      scales[index] = previousScales[index] = baseScale + energy * sizeResponse;
      peakScale = Math.max(peakScale, scales[index]);
      heights[index] = energy;
      mixedColor.setRGB(0, 0, 0);
      for (let color = 0; color < 4; color++) {
        const value = light[offset + color] * brightness;
        mixedColor.r += loomPalette[color].r * value;
        mixedColor.g += loomPalette[color].g * value;
        mixedColor.b += loomPalette[color].b * value;
      }
      colors[index * 3] = mixedColor.r;
      colors[index * 3 + 1] = mixedColor.g;
      colors[index * 3 + 2] = mixedColor.b;
    }
    writeInstances(config.spacing ?? .4, config.heightDisplacement ?? 0, config.sphereIntensity ?? 0);
    frame.render(frame.loom?.features?.bass ?? 0);
  }

  function releaseMesh() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
    mesh = null;
  }

  function reset() {
    previousScales.fill(1);
    scales.fill(1);
    rawHeights.fill(0);
    heights.fill(0);
    history = [];
    historyIndex = historyAccumulator = waveTime = peakScale = peakHeight = loomTime = 0;
  }

  function setSettings(config) {
    const nextColumns = Math.max(4, Math.min(300, Math.round(config.gridWidth ?? 16)));
    const nextRows = Math.max(4, Math.min(300, Math.round(config.gridHeight ?? 16)));
    if (mesh && nextColumns === columns && nextRows === rows) return;
    releaseMesh();
    columns = nextColumns;
    rows = nextRows;
    const count = columns * rows;
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    const material = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 });
    mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Dot Grid';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // Every instance can move between a plane and a sphere each frame. Disable
    // cached aggregate bounds so orbiting never hides a deformed visible grid.
    mesh.frustumCulled = false;
    gridCoordinates = new Float32Array(count * 2);
    previousScales = new Float32Array(count);
    scales = new Float32Array(count);
    rawHeights = new Float32Array(count);
    heights = new Float32Array(count);
    colors = new Float32Array(count * 3);
    const spacing = config.spacing ?? 0.5;
    const left = -(columns - 1) * spacing / 2;
    const top = -(rows - 1) * spacing / 2;
    baseColor.set(config.dotColor ?? '#00ffff');
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      gridCoordinates[index * 2] = column;
      gridCoordinates[index * 2 + 1] = row;
      matrix.makeTranslation(left + column * spacing, 0, top + row * spacing);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, baseColor);
    }
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    reset();
  }

  function step(frame) {
    const config = frame.controls;
    const spectrum = frame.dataArray;
    const dt = frame.dt;
    setSettings(config);
    displayMode = config.scrollingSpectrum ? 'loom' : 'dots';
    // Unlit Loom cells must remain dark even underneath the source lights.
    mesh.material.specular.setHex(displayMode === 'loom' ? 0x000000 : 0x111111);
    if (displayMode === 'loom') { stepLoom(frame); return; }
    const count = columns * rows;
    const dotSize = config.dotSize ?? 0.1;
    const spacing = config.spacing ?? 0.5;
    const maxScale = config.maxScale ?? 4;
    const colorReactivity = config.colorReactivity ?? 0.5;
    const trailIntensity = config.trailIntensity ?? 0.5;
    const spiral = config.spiralIntensity ?? 0;
    const symmetry = config.symmetry ?? 1;
    const waveDelay = config.waveDelay ?? 0;
    const displacement = config.heightDisplacement ?? 0.1;
    const smoothing = config.terrainSmoothing ?? 1;
    const waveModulation = config.waveModulation ?? 2;
    const sphere = config.sphereIntensity ?? 0;
    const sensitivity = config.sensitivity ?? 1;
    // The upstream analyser publishes this independently of its display array.
    const effectiveRange = Number.isFinite(frame.effectiveRange)
      ? frame.effectiveRange : Math.floor(spectrum.length * (config.spectrumCap ?? 1));
    const centerX = (columns - 1) / 2;
    const centerY = (rows - 1) / 2;
    const radius = Math.sqrt(centerX * centerX + centerY * centerY);
    const baseScale = dotSize / 0.1;
    const retention = Math.pow(trailIntensity, dt * 120);
    baseColor.set(config.dotColor ?? '#00ffff');
    baseColor.getHSL(baseHsl);
    waveTime += 0.016 * dt * 120;
    if (waveDelay > 0) {
      historyAccumulator += dt * 120;
      const samples = Math.min(Math.floor(historyAccumulator), 60);
      historyAccumulator -= samples;
      if (history[0]?.length !== spectrum.length) {
        history = [];
        historyIndex = 0;
      }
      for (let sample = 0; sample < samples; sample++) {
        if (history.length < 60) history.push(new Uint8Array(spectrum));
        else {
          history[historyIndex].set(spectrum);
          historyIndex = (historyIndex + 1) % 60;
        }
      }
    }
    peakScale = peakHeight = 0;
    for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const distance = Math.sqrt((column - centerX) ** 2 + (row - centerY) ** 2);
      const radialFraction = Math.min(distance / radius, 0.999);
      const angle = Math.atan2(row - centerY, column - centerX) + Math.PI;
      let foldedAngle = angle;
      if (symmetry > 1) {
        const sectorSize = 2 * Math.PI / symmetry;
        const sector = Math.floor(angle / sectorSize);
        const withinSector = angle - sector * sectorSize;
        foldedAngle = sector % 2 === 0 ? withinSector : sectorSize - withinSector;
      }
      const angularFraction = foldedAngle / (2 * Math.PI) * symmetry;
      let frequencyFraction;
      if (config.radialMode) {
        frequencyFraction = spiral > 0
          ? (radialFraction + angularFraction * spiral) % 1 : radialFraction;
      } else {
        let linearFraction;
        if (config.symmetricMode) {
          linearFraction = Math.min(Math.max(Math.abs(column - centerX) / centerX,
            Math.abs(row - centerY) / centerY), 0.999);
        } else if (config.mirrorY) {
          linearFraction = Math.min((Math.min(row, rows - 1 - row) * columns + column) /
            (Math.floor(centerY) * columns + columns - 1), 0.999);
        } else linearFraction = index / count;
        frequencyFraction = spiral > 0
          ? linearFraction * (1 - spiral) + ((radialFraction + angularFraction) % 1) * spiral
          : linearFraction;
      }
      const bin = Math.floor(frequencyFraction * effectiveRange);
      let sampledSpectrum = spectrum;
      if (waveDelay > 0 && history.length > 0) {
        const delay = Math.floor(radialFraction * waveDelay * 59);
        const historySlot = (historyIndex - 1 - delay + 2 * history.length) % history.length;
        sampledSpectrum = history[historySlot] || spectrum;
      }
      // Matches the source's bounded, one-bin average, including negative
      // routing fractions at spiral intensities above one.
      const firstBin = Math.max(0, Math.min(bin, sampledSpectrum.length));
      const lastBin = Math.max(firstBin, Math.min(bin + 1, sampledSpectrum.length));
      const energy = lastBin > firstBin ? sampledSpectrum[firstBin] / 255 * sensitivity : 0;
      const targetScale = baseScale + energy * maxScale;
      const previous = previousScales[index];
      const nextScale = !frame.immediate && targetScale < previous
        ? previous + (targetScale - previous) * (1 - retention) : targetScale;
      scales[index] = previousScales[index] = nextScale;
      peakScale = Math.max(peakScale, nextScale);
      const amplitude = maxScale > 0 ? Math.max(0, nextScale - baseScale) / maxScale : 0;
      if (displacement > 0) {
        let height = (amplitude - 0.5) * 2;
        if (waveModulation > 0) {
          height += (0.5 * Math.sin(0.3 * column + 2 * waveTime) +
            0.5 * Math.sin(0.3 * row + 1.7 * waveTime) +
            Math.sin(0.4 * distance - 3 * waveTime)) * waveModulation * amplitude;
        }
        rawHeights[index] = height;
      }
      const hueShift = (0.5 * frequencyFraction + 0.3 * amplitude) * colorReactivity;
      reactiveColor.setHSL((baseHsl.h + hueShift) % 1,
        Math.min(1, baseHsl.s + 0.3 * amplitude * colorReactivity),
        Math.min(0.8, baseHsl.l + 0.4 * amplitude));
      mixedColor.copy(baseColor).lerp(reactiveColor, colorReactivity);
      colors[index * 3] = mixedColor.r;
      colors[index * 3 + 1] = mixedColor.g;
      colors[index * 3 + 2] = mixedColor.b;
    }
    if (displacement > 0) for (let index = 0; index < count; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      let sum = rawHeights[index], neighbors = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = column + dx, y = row + dy;
        if (x >= 0 && x < columns && y >= 0 && y < rows) {
          sum += rawHeights[y * columns + x];
          neighbors++;
        }
      }
      heights[index] = rawHeights[index] * (1 - smoothing) + sum / neighbors * smoothing;
    }
    writeInstances(spacing, displacement, sphere);
    const bassEnd = Math.floor(0.1 * spectrum.length);
    let bass = 0;
    for (let bin = 0; bin < bassEnd; bin++) bass += spectrum[bin];
    frame.render(bassEnd ? bass / bassEnd / 255 * sensitivity : 0);
  }

  function writeInstances(spacing, displacement, sphere) {
    const count = columns * rows;
    const extentX = (columns - 1) * spacing;
    const extentY = (rows - 1) * spacing;
    const sphereRadius = 0.4 * Math.max(extentX, extentY);
    for (let index = 0; index < count; index++) {
      const column = gridCoordinates[index * 2];
      const row = gridCoordinates[index * 2 + 1];
      const x = -extentX / 2 + column * spacing;
      const z = -extentY / 2 + row * spacing;
      const height = displacement > 0 ? heights[index] * displacement : 0;
      const longitude = column / (columns - 1) * Math.PI * 2;
      const latitude = row / (rows - 1) * Math.PI;
      const expandedRadius = sphereRadius + height;
      matrix.makeTranslation(
        x * (1 - sphere) + Math.sin(latitude) * Math.cos(longitude) * expandedRadius * sphere,
        height * (1 - sphere) + expandedRadius * Math.cos(latitude) * sphere,
        z * (1 - sphere) + Math.sin(latitude) * Math.sin(longitude) * expandedRadius * sphere,
      );
      scaleVector.setScalar(scales[index]);
      matrix.scale(scaleVector);
      mesh.setMatrixAt(index, matrix);
      mixedColor.setRGB(colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]);
      mesh.setColorAt(index, mixedColor);
      peakHeight = Math.max(peakHeight, Math.abs(height));
    }
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
  }

  setSettings(settings);
  return {
    get geometry() { return mesh.geometry; },
    setSettings,
    step,
    reset,
    getDiagnostics() {
      return { gridWidth: columns, gridHeight: rows, dotCount: columns * rows,
        peakScale, peakHeight, waveTime, historyFrames: history.length, displayMode, loomTime };
    },
    dispose: releaseMesh,
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

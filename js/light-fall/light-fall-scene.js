/**
 * Light Fall adapted from Vizz.fm with the author’s permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-d2d9ec860a756c37.js
 * Source SHA-256: b5a11ca462673f6660f4a9cec6a3f551f0df9a874e8fe2897e67c2cad55cb416
 * Retrieved 2026-10-12. No additional license is granted.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { backgroundVertexShader, backgroundFragmentShader } from '../mesh-grid/mesh-grid-shaders.js';
import { createParticleDanceEffects } from '../particle-dance/particle-dance-effects.js';
import { resolveEffectOrder } from '../particle-dance/particle-dance-effect-settings.js';
import { lightFallVertexShader, lightFallFragmentShader } from './light-fall-shaders.js';
import { createLightFallTrails, MAX_TRAILS, DEFAULT_SEED, bendUv, PALETTE_HUE_OFFSETS, PALETTE_LIGHTNESS_FACTORS } from './light-fall-trails.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** One isolated simulation, renderer, camera and feedback history per preview/export. */
export function createLightFallScene({
  settings,
  width = window.innerWidth,
  height = window.innerHeight,
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2),
  interactive = true,
  seed = DEFAULT_SEED,
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
  camera.position.set(0, 40, 150);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = interactive;
  controls.mouseButtons.RIGHT = null;
  controls.enableDamping = interactive;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 30, 0);
  controls.update(0);
  const background = createBackground();
  scene.add(background);
  const resources = { scene, renderer, camera, controls, threeCanvas: canvas };
  const layer = createTrailLayer(resources, settings, seed);
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
      pixelRatio: basePixelRatio,
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
    effects.setSettings(nextSettings);
    lastFrame = { ...lastFrame, settings: undefined };
    resize(cssWidth, cssHeight, basePixelRatio);
  }

  function reset() {
    const state = currentSettings.cameraState;
    layer.reset();
    clock = 0;
    lastFrame = { spectrum: new Uint8Array(currentSettings.fftSize / 2), time: 0 };
    effects.reset();
    resetMotion();
    if (state) setCameraState(state);
    else {
      camera.position.set(0, 40, 150);
      controls.target.set(0, 30, 0);
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


/** Original tubes and paired floor reflections; all GPU resources survive reset. */
function createTrailLayer(resources, settings, seed) {
  const simulation = createLightFallTrails({ seed });
  const palette = Array.from({ length: 5 }, () => new THREE.Color());
  const hsl = { h: 0, s: 0, l: 0 };
  let previousColor = null;
  function updatePalette(color) {
    if (previousColor === color) return;
    previousColor = color;
    palette[0].set(color);
    palette[0].getHSL(hsl, THREE.SRGBColorSpace);
    for (let index = 0; index < 4; index++) {
      palette[index + 1].setHSL(
        (hsl.h + PALETTE_HUE_OFFSETS[index]) % 1,
        hsl.s, 1 - (1 - hsl.l) * PALETTE_LIGHTNESS_FACTORS[index], THREE.SRGBColorSpace,
      );
    }
  }
  updatePalette(settings.color0);
  const group = new THREE.Group();
  group.name = 'Light Fall Trails';
  resources.scene.add(group);
  const trails = simulation.output.layout.map((layout, index) => {
    const line = new THREE.LineCurve3(
      new THREE.Vector3(layout.geometryX, 0, 0), new THREE.Vector3(layout.geometryX, 0, 1),
    );
    const geometry = new THREE.TubeGeometry(line, 200, layout.radius, 8, false);
    // The vertex shader expands normalized z into a 500-unit path. CPU bounds
    // must contain every supported bend/meander or orbiting incorrectly culls it.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(layout.geometryX, 125, -13.625), 300);
    const uniforms = {
      uTime: { value: 0 }, uColor: { value: palette[layout.colorIndex].clone() },
      uColorIndex: { value: layout.colorIndex }, uSpeed: { value: layout.speed },
      uOffset: { value: layout.offset }, uTailLength: { value: layout.baseTailLength },
      uIntensityMultiplier: { value: 1 }, uBendUv: { value: bendUv(settings.arcRadius) },
      uArcRadius: { value: settings.arcRadius }, uMeander: { value: settings.pathMeander },
      uIsReflection: { value: 0 }, uDotDensity: { value: settings.dotDensity },
      uDotSize: { value: settings.dotSize }, uDotSpeed: { value: settings.dotSpeed },
      uBrightness: { value: settings.trailBrightness }, uDirection: { value: settings.inverseMotion ? -1 : 1 },
      uAudio: { value: 0 }, uAudioFast: { value: 0 },
      uAudioReactivity: { value: 0 }, uAudioColorShift: { value: 0 },
    };
    const reflectionUniforms = {
      ...uniforms, uIntensityMultiplier: { value: 0.4 }, uIsReflection: { value: 1 },
    };
    function material(values) {
      return new THREE.ShaderMaterial({
        vertexShader: lightFallVertexShader, fragmentShader: lightFallFragmentShader,
        uniforms: values, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
    }
    const mesh = new THREE.Mesh(geometry, material(uniforms));
    const reflection = new THREE.Mesh(geometry, material(reflectionUniforms));
    mesh.name = `Light Fall Trail ${index}`;
    reflection.name = `Light Fall Reflection ${index}`;
    reflection.scale.y = -1;
    reflection.position.y = -1;
    mesh.visible = reflection.visible = index < settings.trailCount;
    group.add(mesh, reflection);
    return { mesh, reflection, geometry, uniforms, reflectionUniforms };
  });
  function step(frame) {
    const config = frame.controls;
    const output = simulation.step(config, frame.dataArray, frame.dt);
    updatePalette(config.color0);
    const bend = bendUv(config.arcRadius);
    for (let index = 0; index < MAX_TRAILS; index++) {
      const trail = trails[index];
      trail.mesh.visible = trail.reflection.visible = index < output.count;
      if (!trail.mesh.visible) continue;
      trail.mesh.position.x = trail.reflection.position.x = output.offsetX[index];
      const u = trail.uniforms;
      u.uTime.value = output.time;
      u.uColor.value.copy(palette[simulation.output.layout[index].colorIndex]);
      u.uTailLength.value = output.tailLength[index];
      u.uAudio.value = output.slowEnergy[index];
      u.uAudioFast.value = output.fastEnergy[index];
      u.uAudioReactivity.value = config.audioReactivity;
      u.uAudioColorShift.value = config.audioColorShift;
      u.uArcRadius.value = config.arcRadius;
      u.uBendUv.value = bend;
      u.uMeander.value = config.pathMeander;
      u.uDotDensity.value = config.dotDensity;
      u.uDotSize.value = config.dotSize;
      u.uDotSpeed.value = config.dotSpeed;
      u.uBrightness.value = config.trailBrightness;
      u.uDirection.value = config.inverseMotion ? -1 : 1;
      u.uIntensityMultiplier.value = output.intensity[index];
      trail.reflectionUniforms.uIntensityMultiplier.value = 0.4 * output.intensity[index];
    }
    frame.render(output.bass);
  }
  return {
    geometry: trails[0].geometry,
    step,
    reset() { simulation.reset(); },
    getDiagnostics() {
      const { output } = simulation;
      let slowEnergy = 0, fastEnergy = 0;
      for (let index = 0; index < MAX_TRAILS; index++) {
        slowEnergy = Math.max(slowEnergy, output.slowEnergy[index]);
        fastEnergy = Math.max(fastEnergy, output.fastEnergy[index]);
      }
      return { trailCount: output.count, trailTime: output.time, slowEnergy, fastEnergy, geometryCount: trails.length, baseSeed: seed };
    },
    dispose() {
      resources.scene.remove(group);
      for (const trail of trails) {
        trail.geometry.dispose();
        trail.mesh.material.dispose();
        trail.reflection.material.dispose();
      }
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

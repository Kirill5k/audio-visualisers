import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LED_COLUMNS, LED_ROWS, LED_COUNT, evaluateLEDPattern } from './led-patterns.js';

const DEGREES = Math.PI / 180;
const VIEWS = { front: { yaw: 0, pitch: 0 }, left: { yaw: -22, pitch: 12 }, right: { yaw: 22, pitch: 12 } };
const LOOM_FRAME_HEIGHT = .8;
const LOOM_MAX_ZOOM = 1.05;

/** HDR, instanced 96 × 54 panel. Scene time is always supplied by the caller. */
export function createLEDGridScene(stage, settings) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);
  renderer.domElement.setAttribute('aria-label', 'Audio-reactive LED matrix with 96 columns and 54 rows');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, .1, 600);
  const flatCamera = new THREE.OrthographicCamera(-55, 55, 31, -31, .1, 600);
  flatCamera.position.set(0, 0, 100);
  flatCamera.lookAt(0, 0, 0);
  const target = new THREE.Vector3();
  const maxSamples = renderer.capabilities.maxSamples || 0;
  const targetBuffer = new THREE.WebGLRenderTarget(1920, 1080, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: Math.min(4, maxSamples),
    depthBuffer: false, stencilBuffer: false,
  });
  const composer = new EffectComposer(renderer, targetBuffer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), .22, .3, .92);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(outputPass);

  const offsets = new Float32Array(LED_COUNT * 2);
  const states = new Float32Array(LED_COUNT * 4);
  for (let row = 0; row < LED_ROWS; row++) {
    for (let column = 0; column < LED_COLUMNS; column++) {
      const index = row * LED_COLUMNS + column;
      offsets[index * 2] = column - (LED_COLUMNS - 1) / 2;
      offsets[index * 2 + 1] = row - (LED_ROWS - 1) / 2;
    }
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  const stateAttribute = new THREE.InstancedBufferAttribute(states, 4);
  stateAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aState', stateAttribute);
  geometry.instanceCount = LED_COUNT;
  const uniforms = {
    uViolet: { value: new THREE.Color('#7446FF') },
    uBlue: { value: new THREE.Color('#2F5BFF') },
    uAmber: { value: new THREE.Color('#FFA53D') },
    uWhite: { value: new THREE.Color('#FFF1D0') },
    uBrightness: { value: 1 },
    uGlow: { value: .65 },
    uHalo: { value: .045 },
    uFlat: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: `
      attribute vec2 aOffset;
      attribute vec4 aState;
      varying vec2 vCell;
      varying vec4 vState;
      void main() {
        vCell = position.xy;
        vState = aState;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy + aOffset, 0., 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 uViolet;
      uniform vec3 uBlue;
      uniform vec3 uAmber;
      uniform vec3 uWhite;
      uniform float uBrightness;
      uniform float uGlow;
      uniform float uHalo;
      uniform float uFlat;
      varying vec2 vCell;
      varying vec4 vState;
      float roundedBox(vec2 p, float halfSize, float radius) {
        vec2 q = abs(p) - vec2(halfSize - radius);
        return min(max(q.x, q.y), 0.) + length(max(q, 0.)) - radius;
      }
      void main() {
        float faceDistance = roundedBox(vCell, .35, .055);
        float housingDistance = roundedBox(vCell, .405, .075);
        float aa = max(fwidth(faceDistance), .00001);
        float face = 1. - smoothstep(-aa * .5, aa * .5, faceDistance);
        float housing = 1. - smoothstep(-aa * .5, aa * .5, housingDistance);
        float edge = exp(-abs(housingDistance + .015) * 130.) * housing;
        vec3 color = mix(uViolet, uBlue, vState.y);
        color = mix(color, uAmber, vState.z);
        color = mix(color, uWhite, vState.w * .82);
        float core = mix(.82 + .18 * exp(-dot(vCell, vCell) * 12.), 1., uFlat);
        float intensity = vState.x;
        vec3 emission = color * intensity * 2.05 * face * core;
        // The physical package is barely visible; darkness remains a true rest.
        vec3 package = vec3(.0010, .00115, .00165) * housing;
        package += vec3(.0014, .0016, .0022) * edge * (.65 + vCell.y) * (1. - uFlat);
        // Narrow per-diode halo preserves the 30% black gap between emitters.
        float halo = exp(-max(faceDistance, 0.) * 30.) * (1. - face);
        vec3 localGlow = color * intensity * halo * uGlow * uHalo;
        // Master light level, after audio response and before HDR bloom.
        gl_FragColor = vec4((package + emission + localGlow) * uBrightness, 1.);
      }
    `,
  });
  const panel = new THREE.Mesh(geometry, material);
  panel.frustumCulled = false;
  scene.add(panel);
  let disposed = false, width = 1920, height = 1080, ratio = 1;
  let view = 'front', yaw = 0, pitch = 0, zoom = 1, flatZoom = 1;
  let lastData = null;
  let stats = { litCoverage: 0, brightCoverage: 0, meanIntensity: 0, maxIntensity: 0, amberCoverage: 0, eventCount: 0, time: 0, mode: 'loom' };
  let colorKey = '';
  let pointer = null;
  const origin = new THREE.Vector3();
  const isFlat = () => settings.mode !== 'loom';
  function updateCamera(time = 0) {
    const flatHeight = Math.max(LED_ROWS / .88, LED_COLUMNS / camera.aspect / .88) / flatZoom;
    flatCamera.left = -flatHeight * camera.aspect * .5;
    flatCamera.right = -flatCamera.left;
    flatCamera.top = flatHeight * .5;
    flatCamera.bottom = -flatCamera.top;
    flatCamera.updateProjectionMatrix();
    const motionYaw = settings.motion ? Math.sin(time * .11) * 4 : 0;
    const motionPitch = settings.motion ? Math.sin(time * .083 + .7) * 2 : 0;
    const a = (yaw + motionYaw) * DEGREES;
    const b = (pitch + motionPitch) * DEGREES;
    // Fit the actual projected corners, including optional drift extrema.
    // A fixed front-view distance crops the near corner of an oblique panel.
    const fov = camera.fov * DEGREES;
    const panelHeight = Math.max(LED_ROWS / .88, LED_COLUMNS / camera.aspect / .88);
    let distance = panelHeight * .5 / Math.tan(fov * .5);
    const driftYaw = settings.motion ? [-4, 4] : [0];
    const driftPitch = settings.motion ? [-2, 2] : [0];
    for (const offsetYaw of driftYaw) for (const offsetPitch of driftPitch) {
      const fitYaw = (yaw + offsetYaw) * DEGREES, fitPitch = (pitch + offsetPitch) * DEGREES;
      for (const x of [-48, 48]) for (const y of [-27, 27]) {
        const depth = x * Math.sin(fitYaw) * Math.cos(fitPitch) + y * Math.sin(fitPitch);
        const projectedX = x * Math.cos(fitYaw);
        const projectedY = y * Math.cos(fitPitch) - x * Math.sin(fitYaw) * Math.sin(fitPitch);
        distance = Math.max(distance, depth + Math.abs(projectedX) / (Math.tan(fov * .5) * camera.aspect * .88),
          depth + Math.abs(projectedY) / (Math.tan(fov * .5) * .88));
      }
    }
    distance /= zoom;
    camera.position.set(Math.sin(a) * Math.cos(b) * distance, Math.sin(b) * distance, Math.cos(a) * Math.cos(b) * distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function syncColors() {
    const next = [settings.violet, settings.blue, settings.amber, settings.white].join('|');
    if (next === colorKey) return;
    colorKey = next;
    uniforms.uViolet.value.set(settings.violet || '#7446FF');
    uniforms.uBlue.value.set(settings.blue || '#2F5BFF');
    uniforms.uAmber.value.set(settings.amber || '#FFA53D');
    uniforms.uWhite.value.set(settings.white || '#FFF1D0');
  }
  function render(data = lastData || {}) {
    if (disposed) return;
    const started = performance.now();
    lastData = data;
    const result = evaluateLEDPattern(data, settings, states);
    const { values, ...metrics } = result;
    stats = metrics;
    stateAttribute.needsUpdate = true;
    syncColors();
    const brightness = Number(settings.brightness ?? 1);
    uniforms.uBrightness.value = Number.isFinite(brightness) ? Math.max(0, Math.min(2, brightness)) : 1;
    uniforms.uGlow.value = Math.max(0, Number(settings.glow) || 0);
    uniforms.uFlat.value = isFlat() ? 1 : 0;
    uniforms.uHalo.value = isFlat() ? .035 : .045;
    bloom.strength = uniforms.uGlow.value * (isFlat() ? .12 : .28);
    bloom.enabled = bloom.strength > 0;
    updateCamera(data.time || 0);
    renderPass.camera = isFlat() ? flatCamera : camera;
    renderer.info.reset();
    composer.render();
    stats.renderCpuMs = performance.now() - started;
  }
  function resize(nextWidth, nextHeight, pixelRatio = 1) {
    if (disposed) return;
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    ratio = Math.max(.1, Number(pixelRatio) || 1);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // Fit the complete perspective composition into the upper 80% of the
    // output. An off-centre projection keeps preview and export identical,
    // with the original camera angles and a full-resolution render target.
    camera.setViewOffset(width * LOOM_FRAME_HEIGHT, height * LOOM_FRAME_HEIGHT,
      -width * (1 - LOOM_FRAME_HEIGHT) * .5, 0, width, height);
    updateCamera(lastData?.time || 0);
  }
  function setView(name) {
    if (isFlat()) { flatZoom = 1; updateCamera(lastData?.time || 0); return; }
    const preset = VIEWS[name] || VIEWS.front;
    view = VIEWS[name] ? name : 'front';
    yaw = preset.yaw;
    pitch = preset.pitch;
    zoom = 1;
    target.copy(origin);
    updateCamera(lastData?.time || 0);
  }
  function resetCamera() { setView('front'); }
  function saveCamera() { return { view, yaw, pitch, zoom, flatZoom, target: target.toArray() }; }
  function restoreCamera(state) {
    if (!state) return;
    view = state.view || 'front';
    yaw = Number(state.yaw) || 0;
    pitch = Number(state.pitch) || 0;
    zoom = THREE.MathUtils.clamp(Number(state.zoom) || 1, .75, LOOM_MAX_ZOOM);
    flatZoom = Number(state.flatZoom) || 1;
    if (Array.isArray(state.target)) target.fromArray(state.target);
    updateCamera(lastData?.time || 0);
  }
  function onPointerDown(event) {
    if (event.button !== 0 || isFlat()) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch };
    renderer.domElement.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId || isFlat()) return;
    yaw = THREE.MathUtils.clamp(pointer.yaw - (event.clientX - pointer.x) * .11, -35, 35);
    pitch = THREE.MathUtils.clamp(pointer.pitch + (event.clientY - pointer.y) * .11, -22, 22);
    view = 'custom';
    render();
  }
  function onPointerUp(event) {
    if (pointer?.id === event.pointerId) pointer = null;
  }
  function onWheel(event) {
    event.preventDefault();
    if (isFlat()) flatZoom = THREE.MathUtils.clamp(flatZoom * Math.exp(-event.deltaY * .001), .75, 1.20);
    // Leave room for bloom above the board and for titles below, even zoomed in.
    else zoom = THREE.MathUtils.clamp(zoom * Math.exp(-event.deltaY * .001), .75, LOOM_MAX_ZOOM);
    render();
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  resize(width, height, ratio);
  updateCamera();
  return {
    canvas: renderer.domElement, render, resize, setView, resetCamera, saveCamera, restoreCamera,
    getInfo: () => ({ ...stats, columns: LED_COLUMNS, rows: LED_ROWS, leds: LED_COUNT,
      view: isFlat() ? 'front' : view, projection: isFlat() ? 'orthographic' : 'perspective', planeZ: 0,
      camera: isFlat() ? { view: 'front', yaw: 0, pitch: 0, zoom: flatZoom, target: [0, 0, 0] } : saveCamera(),
      width: renderer.domElement.width, height: renderer.domElement.height,
      pixelRatio: ratio, hdr: true, multisamples: targetBuffer.samples,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    dispose() {
      disposed = true;
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      geometry.dispose(); material.dispose(); bloom.dispose(); outputPass.dispose(); composer.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}

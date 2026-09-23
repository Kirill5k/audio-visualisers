import * as THREE from 'three';
import { createDeepDrift } from '../js/starfield/deep-drift-scene.js';
import { createStarfieldSettings } from '../js/starfield/starfield-settings.js';
import { createDeepDriftResponseTimeline, DEFAULT_RESPONSE_SETTINGS } from '../js/starfield/deep-drift-response.js';

const list = document.querySelector('#results');
const summary = document.querySelector('#summary');
const errors = document.querySelector('#errors');
const shaderErrors = [];
const originalError = console.error;
console.error = (...args) => {
  shaderErrors.push(args.map(String).join(' '));
  originalError(...args);
};
let passed = 0, failed = 0;
const FPS = 60, TARGET_FRAME = 1200;
const distanceAt = time => time * 34;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function syntheticFeature(frame) {
  const time = frame / FPS;
  const level = time < 2 ? 0 : .4 + .25 * Math.sin(time * .61) ** 2;
  const levels = new Float32Array(32), onsets = new Float32Array(32);
  for (let band = 0; band < 32; band++) levels[band] = level * (.2 + .8 * Math.sin(time * .37 + band * .21) ** 2);
  if (frame > 120 && frame % 30 === 0) onsets[(frame / 30 * 7) % 32] = .85;
  return {
    rms: level * .16, energy: level, bass: level * (.4 + .6 * Math.sin(time * 1.1) ** 2),
    mids: level * (.4 + .6 * Math.sin(time * .71 + 1) ** 2),
    highs: level * (.3 + .7 * Math.sin(time * 2.13 + 2) ** 2),
    kick: frame % 30 < 4 ? level : 0, levels, onsets,
  };
}
const settings = { ...createStarfieldSettings(), ...DEFAULT_RESPONSE_SETTINGS, drift: 0 };
const response = createDeepDriftResponseTimeline({
  frameCount: 25 * FPS,
  getFeatureFrame: frame => ({ frame, features: syntheticFeature(frame) }),
  settings,
});
function makeScene(configuration = settings) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(360, 202);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 360 / 202, .05, 6500);
  camera.updateMatrixWorld();
  const spectrum = new THREE.DataTexture(new Float32Array(256 * 64), 256, 64, THREE.RedFormat, THREE.FloatType);
  spectrum.needsUpdate = true;
  const world = createDeepDrift({ scene, camera, spectrumTexture: spectrum, settings: configuration });
  world.resize(360, 202, 1);
  document.querySelector('#canvases').append(renderer.domElement);
  return {
    renderer, scene, camera, world, settings: configuration,
    dispose() { world.dispose(); spectrum.dispose(); renderer.dispose(); },
  };
}
function inputAt(time, extras = {}) {
  return { time, delta: 1 / FPS, distance: distanceAt(time), frame: Math.round(time * FPS),
    features: response.sample(time), playing: true, light: 1, ...extras };
}
function advance(instance, from = 0, to = TARGET_FRAME) {
  for (let frame = from; frame <= to; frame++) instance.world.update(inputAt(frame / FPS));
}
function draw(instance) {
  instance.renderer.render(instance.scene, instance.camera);
  const gl = instance.renderer.getContext();
  const output = new Uint8Array(360 * 202 * 4);
  gl.readPixels(0, 0, 360, 202, gl.RGBA, gl.UNSIGNED_BYTE, output);
  assert(gl.getError() === gl.NO_ERROR, 'WebGL reported an error');
  return output;
}
function hash(bytes) {
  let output = 0x811c9dc5;
  for (const byte of bytes) output = Math.imul(output ^ byte, 0x1000193) >>> 0;
  return output;
}
function matchingPixels(actual, expected, message, tolerance = 2) {
  let maximum = 0;
  for (let i = 0; i < actual.length; i++) maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
  assert(maximum <= tolerance, `${message}: maximum channel difference ${maximum}`);
}
function canonicalEvents(world) {
  const state = world.saveState();
  return { events: state.events, lastEventTime: state.lastEventTime,
    lastProcessedFrame: state.lastProcessedFrame, nebula: state.nebulaActivity };
}
async function test(name, callback) {
  const row = document.createElement('li');
  row.textContent = `Running: ${name}`;
  list.append(row);
  try {
    await callback();
    passed++; row.className = 'pass'; row.textContent = `PASS: ${name}`;
  } catch (error) {
    failed++; row.className = 'fail'; row.textContent = `FAIL: ${name} — ${error.message}`;
    errors.textContent += `${error.stack}\n`;
  }
  summary.textContent = `${passed} passed, ${failed} failed; running…`;
  await new Promise(requestAnimationFrame);
}

let preview, exported;
try {
  preview = makeScene();
  await test('Synthetic music produces visible particles without WebGL shader errors', () => {
    advance(preview);
    const output = draw(preview);
    assert(output.some((byte, index) => index % 4 !== 3 && byte > 10), 'The scene is entirely dark');
    assert(preview.world.getStats().dustParticles > 30000, 'Dust wisps were not created');
    assert(shaderErrors.length === 0, shaderErrors.join('\n'));
  });

  await test('Presentation at 30, 60 and 120 Hz cannot add, remove or duplicate canonical events', () => {
    for (const rate of [30, 60, 120]) {
      preview.world.reset();
      advance(preview, 0, 1200);
      const before = canonicalEvents(preview.world);
      for (let frame = 0; frame < rate; frame++) {
        // Canonical time stays fixed; only the fractional render time changes.
        preview.world.present(inputAt(20 + (frame % 2) / (rate * 2)));
      }
      equal(canonicalEvents(preview.world), before, `${rate} Hz presentation changed canonical events`);
    }
  });

  await test('Eight-second seek reconstruction matches sequential playback at 20 seconds', () => {
    preview.world.reset();
    advance(preview);
    preview.world.present(inputAt(20.007));
    const sequential = draw(preview);
    const expectedEvents = preview.world.saveState().events;
    preview.world.reset({ preserveFlow: true });
    advance(preview, TARGET_FRAME - 8 * FPS);
    preview.world.present(inputAt(20.007));
    equal(preview.world.saveState().events, expectedEvents, 'Seek reconstructed different light events');
    matchingPixels(draw(preview), sequential, 'Seek pixels differ');
  });

  await test('Wisp triangles remain local and recycling does not bridge near and far depth', () => {
    const foundation = preview.scene.children.find(object => object.name.includes('continuous wisp'));
    assert(foundation, 'Continuous wisp foundation is missing');
    const geometry = foundation.geometry;
    const depth = geometry.getAttribute('aParticle');
    const indices = geometry.index.array;
    const step = foundation.userData.wispDepthStep;
    for (let triangle = 0; triangle < indices.length; triangle += 3) {
      const z = [0, 1, 2].map(offset => depth.getX(indices[triangle + offset]));
      assert(Math.max(...z) - Math.min(...z) <= step + 1e-7, 'A wisp triangle spans unrelated depth rows');
    }
    preview.world.reset();
    advance(preview);
    // The surface uses one shared world grid for every vertex. Immediately on
    // each grid rollover the outgoing near/far rows are fully faded; surviving
    // triangles must occupy the same world coordinates and produce the same
    // pixels. This catches near/far bridges even when they are deterministic.
    for (const grid of [30, 37, 45]) {
      const distance = grid * step - preview.world.getStats().dustPhase * 9;
      preview.world.present(inputAt(20, { distance: distance - 0.00001 }));
      const before = draw(preview);
      preview.world.present(inputAt(20, { distance: distance + 0.00001 }));
      matchingPixels(draw(preview), before, `Visible surface discontinuity at grid ${grid}`, 2);
    }
  });

  await test('Foundation triangles use native GPU clipping in Forward, Left, Right and Up views', () => {
    preview.world.reset();
    advance(preview);
    const foundation = preview.scene.children.find(object => object.name.includes('continuous wisp'));
    const originalMaterial = foundation.material;
    const referenceMaterial = originalMaterial.clone();
    referenceMaterial.uniforms = originalMaterial.uniforms;
    // The reference always leaves final projection to the GPU. In particular,
    // a partially visible triangle cannot teleport its behind-camera vertices
    // to the point-sprite discard coordinate. That previously drew huge fans.
    referenceMaterial.vertexShader = originalMaterial.vertexShader.replace(/}\s*$/, '\n gl_Position = projectionMatrix * view;\n}');
    referenceMaterial.needsUpdate = true;
    const visibility = preview.scene.children.map(object => object.visible);
    preview.scene.children.forEach(object => { object.visible = object === foundation; });
    try {
      for (const [pitch, yaw] of [[0, 0], [0, 25], [0, -25], [15, 0]]) {
        preview.camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
        preview.camera.updateMatrixWorld();
        foundation.material = originalMaterial;
        const actual = draw(preview);
        foundation.material = referenceMaterial;
        matchingPixels(draw(preview), actual, `Incorrect native clipping at pitch ${pitch}, yaw ${yaw}`, 0);
      }
    } finally {
      foundation.material = originalMaterial;
      referenceMaterial.dispose();
      preview.scene.children.forEach((object, index) => { object.visible = visibility[index]; });
      preview.camera.rotation.set(0, 0, 0);
      preview.camera.updateMatrixWorld();
    }
  });

  await test('Fixed-time preview and isolated export scene produce equivalent pixels', () => {
    preview.world.reset();
    advance(preview);
    preview.world.present(inputAt(20.007));
    exported = makeScene(structuredClone(settings));
    advance(exported);
    exported.world.present(inputAt(20.007));
    matchingPixels(draw(exported), draw(preview), 'Preview/export pixels differ');
  });

  await test('Export completion or cancellation restores the exact preview presentation', () => {
    preview.world.present(inputAt(20.007, { light: .63 }));
    const saved = preview.world.saveState();
    const before = draw(preview);
    for (const end of [90, 300]) {
      preview.world.reset({ preserveFlow: true });
      advance(preview, 0, end);
      preview.world.present(inputAt(end / FPS + .005));
      draw(preview);
      preview.world.restoreState(saved);
      matchingPixels(draw(preview), before, `Restore after ${end / FPS}s export differs`, 0);
    }
  });

  await test('Live dust flow changes preserve phase at the edit and advance at the new speed', () => {
    preview.world.present(inputAt(20));
    const phase = preview.world.getStats().dustPhase;
    const before = hash(draw(preview));
    settings.dustFlow = .35;
    preview.world.present(inputAt(20));
    assert(Math.abs(preview.world.getStats().dustPhase - phase) < 1e-9, 'Flow slider moved the current instantly');
    assert(hash(draw(preview)) === before, 'Flow slider changed fixed-time pixels');
    preview.world.present(inputAt(20.5));
    assert(Math.abs(preview.world.getStats().dustPhase - phase - .175) < 1e-8, 'Flow did not advance at the new speed');
    settings.dustFlow = 1;
    preview.world.present(inputAt(20.5));
    preview.world.reset();
  });

  await test('Pausing freezes dust geometry and travel while illumination eases down', () => {
    advance(preview);
    const input = inputAt(20.007);
    preview.world.present(input);
    const lit = draw(preview);
    const before = preview.world.saveState().dustRivers;
    preview.world.present({ ...input, playing: false, light: .15 });
    const paused = preview.world.saveState().dustRivers;
    for (const key of ['uPhase', 'uDistance', 'uBass', 'uMids', 'uHighs', 'uBreath'])
      assert(paused[key] === before[key], `Pause altered shape or travel: ${key}`);
    assert(paused.uLight === .15, 'Pause light was not applied');
    assert(hash(draw(preview)) !== hash(lit), 'Pause illumination did not change');
    preview.world.present(input);
    matchingPixels(draw(preview), lit, 'Resume did not restore presentation', 0);
  });

  await test('Shared background mode excludes Deep Drift dust and musical event state', () => {
    const backgroundSettings = { ...createStarfieldSettings(), backgroundOnly: true };
    const background = makeScene(backgroundSettings);
    try {
      advance(background, 1170, 1200);
      draw(background);
      const stats = background.world.getStats();
      assert(!stats.dustActive && !stats.dustParticles, 'Shared background gained Deep Drift dust');
      assert(stats.activeLightEvents === 0, 'Shared background gained local flare events');
      assert(background.scene.children.every(object => !object.name.includes('wisps')), 'Dust object exists in shared background');
      assert(shaderErrors.length === 0, shaderErrors.join('\n'));
    } finally { background.dispose(); }
  });

  await test('All scene materials compiled without errors', () => assert(shaderErrors.length === 0, shaderErrors.join('\n')));
} catch (error) {
  failed++; errors.textContent += `${error.stack}\n`;
} finally {
  preview?.dispose(); exported?.dispose();
  console.error = originalError;
}
summary.textContent = `${passed} passed, ${failed} failed — complete`;
document.title = `${failed ? 'FAIL' : 'PASS'}: Deep Drift scene regression`;

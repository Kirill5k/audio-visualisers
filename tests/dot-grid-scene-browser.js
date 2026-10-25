import { createDotGridScene } from '../js/dot-grid/dot-grid-scene.js';
import { createSettings } from '../js/dot-grid/dot-grid-settings.js';
import { PRESETS } from '../js/dot-grid/dot-grid-presets.js';

const list = document.querySelector('#results');
const summary = document.querySelector('#summary');
const errors = document.querySelector('#errors');
let passed = 0;
let failed = 0;
const shaderErrors = [];
const originalError = console.error;
console.error = (...args) => {
  shaderErrors.push(args.map(String).join(' '));
  originalError(...args);
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function frame(settings, index, silent = false) {
  const spectrum = new Uint8Array(settings.fftSize / 2);
  if (!silent) for (let bin = 0; bin < spectrum.length; bin++) {
    const envelope = Math.exp((-bin / spectrum.length) * 3);
    spectrum[bin] = Math.round(255 * envelope * (0.35 + 0.3 * Math.sin(bin * 0.063 + index * 0.31) ** 2));
  }
  return { spectrum, time: index / 60, settings };
}
function dots(instance) {
  const mesh = instance.scene.getObjectByName('Dot Grid');
  assert(mesh?.isInstancedMesh, 'Expected the source sphere grid as an InstancedMesh');
  return mesh;
}
function pixels(instance) {
  const gl = instance.renderer.getContext();
  const result = new Uint8Array(instance.canvas.width * instance.canvas.height * 4);
  gl.readPixels(0, 0, instance.canvas.width, instance.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, result);
  assert(gl.getError() === gl.NO_ERROR, 'WebGL reported an error');
  return result;
}
function hash(bytes) {
  let result = 0x811c9dc5;
  for (const byte of bytes) result = Math.imul(result ^ byte, 0x1000193) >>> 0;
  return result;
}
function geometrySnapshot(instance) {
  const mesh = dots(instance);
  return { matrix: Array.from(mesh.instanceMatrix.array), color: Array.from(mesh.instanceColor.array) };
}
function runFrames(instance, settings, count = 8, silent = false) {
  for (let index = 0; index < count; index++) instance.step(frame(settings, index, silent), 1 / 60);
  const mesh = dots(instance);
  assert(mesh.count === settings.gridWidth * settings.gridHeight, 'Live grid dimensions do not match its instance count');
  assert(mesh.instanceMatrix.array.every(Number.isFinite), 'Dot transforms contain NaN or infinity');
  assert(mesh.instanceColor?.array.every(Number.isFinite), 'Dot colors contain NaN or infinity');
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    assert(attribute.array.every(Number.isFinite), `${name} contains NaN or infinity`);
  }
  return pixels(instance);
}
async function test(name, callback) {
  const row = document.createElement('li');
  row.textContent = `Running: ${name}`;
  list.append(row);
  try {
    await callback();
    passed++;
    row.className = 'pass';
    row.textContent = `PASS: ${name}`;
  } catch (error) {
    failed++;
    row.className = 'fail';
    row.textContent = `FAIL: ${name} — ${error.message}`;
    errors.textContent += `${error.stack}\n`;
  }
  summary.textContent = `${passed} passed, ${failed} failed; running…`;
  await new Promise(requestAnimationFrame);
}

let preview;
try {
  const initial = createSettings();
  preview = createDotGridScene({ settings: initial, width: 360, height: 202, pixelRatio: 1, interactive: true });
  document.querySelector('#canvases').append(preview.canvas);
  await test('Linked source preset preserves its 64 × 64 lit sphere grid', () => {
    const mesh = dots(preview);
    assert(mesh.count === 4096, `Expected 4,096 source dots, found ${mesh.count}`);
    assert(mesh.geometry === preview.geometry && mesh.geometry.type === 'SphereGeometry', 'Dots lost the shared source sphere geometry');
    const shape = mesh.geometry.parameters;
    assert(shape.radius === .1 && shape.widthSegments === 16 && shape.heightSegments === 16, 'Source sphere radius or segments changed');
    assert(mesh.material.isMeshPhongMaterial && mesh.material.shininess === 100, 'Source Phong material changed');
    const lights = preview.scene.children.filter(object => object.isLight);
    assert(lights.filter(light => light.isAmbientLight && light.intensity === .5).length === 2, 'Expected both source ambient lights');
    assert(lights.filter(light => light.isDirectionalLight && light.intensity === 1).length === 2, 'Expected both source directional lights');
  });

  for (const preset of PRESETS) {
    await test(`${preset.name}: renders finite, visible dots`, () => {
      const settings = createSettings(preset.id);
      preview.applyPreset(settings);
      const output = runFrames(preview, settings, 4);
      assert(output.some((byte, index) => index % 4 !== 3 && byte > 5), 'Frame is entirely dark');
      assert(shaderErrors.length === 0, shaderErrors.join('\n'));
    });
  }

  await test('Audio changes dot size, height and color', () => {
    const settings = { ...createSettings(), heightDisplacement: 2, colorReactivity: 1, waveDelay: 0 };
    preview.applyPreset(settings);
    runFrames(preview, settings, 8, true);
    const quiet = geometrySnapshot(preview);
    preview.reset();
    runFrames(preview, settings, 8);
    const active = geometrySnapshot(preview);
    assert(active.matrix.some((value, index) => index % 16 === 0 && Math.abs(value - quiet.matrix[index]) > .0001), 'Audio did not change dot scale');
    assert(active.matrix.some((value, index) => index % 16 === 13 && Math.abs(value - quiet.matrix[index]) > .0001), 'Audio did not displace dot height');
    assert(active.color.some((value, index) => Math.abs(value - quiet.color[index]) > .0001), 'Audio did not change dot color');
  });

  await test('Live grid dimensions rebuild dots while preserving the camera', () => {
    const settings = { ...createSettings(), gridWidth: 19, gridHeight: 23, spacing: .7 };
    const cameraBefore = preview.getCameraState();
    preview.setSettings(settings);
    assert(JSON.stringify(preview.getCameraState()) === JSON.stringify(cameraBefore), 'Live settings moved camera');
    runFrames(preview, settings);
    assert(dots(preview).count === 437, 'Live grid dimensions were not applied');
  });

  await test('Sphere deformation changes dot positions', () => {
    const flat = { ...createSettings(), gridWidth: 24, gridHeight: 24, sphereIntensity: 0 };
    preview.applyPreset(flat);
    runFrames(preview, flat);
    const before = geometrySnapshot(preview).matrix;
    const sphere = { ...flat, sphereIntensity: 1 };
    preview.applyPreset(sphere);
    runFrames(preview, sphere);
    const after = geometrySnapshot(preview).matrix;
    assert(after.some((value, index) => index % 16 >= 12 && index % 16 <= 14 && Math.abs(value - before[index]) > .001), 'Sphere control did not change dot positions');
  });

  await test('Reset clears wave history and reproduces geometry, camera and pixels', () => {
    const settings = { ...createSettings(), waveDelay: .5 };
    preview.applyPreset(settings);
    const first = hash(runFrames(preview, settings, 12));
    const geometry = JSON.stringify(geometrySnapshot(preview));
    assert(preview.getDiagnostics().waveTime > 0, 'Wave clock did not advance');
    preview.reset();
    const reset = preview.getDiagnostics();
    assert(reset.waveTime === 0 && reset.historyFrames === 0, 'Temporal state leaked through reset');
    const second = hash(runFrames(preview, settings, 12));
    assert(JSON.stringify(geometrySnapshot(preview)) === geometry, 'Reset changed dot geometry or colors');
    assert(first === second, `Reset changed pixels: ${first} versus ${second}`);
  });

  await test('Paused repaint preserves geometry and pixels; camera changes repaint', () => {
    const original = hash(pixels(preview));
    const geometry = JSON.stringify(geometrySnapshot(preview));
    preview.render();
    assert(JSON.stringify(geometrySnapshot(preview)) === geometry, 'Paused repaint advanced dots');
    assert(hash(pixels(preview)) === original, 'Paused repaint changed pixels');
    const pose = preview.getCameraState();
    pose.position.x += 4;
    preview.setCameraState(pose);
    preview.render();
    assert(hash(pixels(preview)) !== original, 'Paused camera change was not rendered');
  });

  await test('Paused size decreases and zero controls apply without advancing time', () => {
    const settings = { ...createSettings(), dotSize: .4, maxScale: 8, waveDelay: 0 };
    preview.applyPreset(settings);
    runFrames(preview, settings, 8);
    const before = preview.getDiagnostics();
    const reduced = { ...settings, dotSize: .01, maxScale: 1 };
    preview.setSettings(reduced);
    preview.step(frame(reduced, 7), 0);
    const smaller = preview.getDiagnostics();
    assert(smaller.peakScale < before.peakScale, 'Paused scale decrease retained old dot size');
    assert(smaller.waveTime === before.waveTime, 'Paused size edit advanced wave time');
    const zero = { ...reduced, dotSize: 0, maxScale: 0, heightDisplacement: 0 };
    preview.setSettings(zero);
    preview.step(frame(zero, 7), 0);
    assert(preview.getDiagnostics().peakScale === 0, 'Zero dot size or audio scale fell back to a default');
    assert(preview.getDiagnostics().peakHeight === 0, 'Zero displacement fell back to its default');
    const geometry = JSON.stringify(geometrySnapshot(preview));
    preview.render();
    assert(JSON.stringify(geometrySnapshot(preview)) === geometry, 'Repainting paused edits changed geometry');
  });

  await test('Preview and isolated export render identical fixed-time frames', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    const exported = createDotGridScene({ settings: structuredClone(settings), width: 360, height: 202, pixelRatio: 1, interactive: false });
    document.querySelector('#canvases').append(exported.canvas);
    try {
      const first = runFrames(preview, settings, 10);
      const second = runFrames(exported, settings, 10);
      assert(JSON.stringify(geometrySnapshot(preview)) === JSON.stringify(geometrySnapshot(exported)), 'Preview/export dot transforms or colors differ');
      assert(first.length === second.length, 'Preview/export dimensions differ');
      let maxDifference = 0;
      for (let index = 0; index < first.length; index++) maxDifference = Math.max(maxDifference, Math.abs(first[index] - second[index]));
      assert(maxDifference <= 2, `Preview/export maximum channel error: ${maxDifference}`);
    } finally { exported.dispose(); }
  });

  await test('Resize honors CSS dimensions and pixel ratio', () => {
    preview.resize(320, 180, 2);
    preview.step(frame(createSettings(), 11), 1 / 60);
    assert(preview.canvas.width === 640 && preview.canvas.height === 360, 'Incorrect physical canvas size');
    assert(preview.camera.aspect === 320 / 180, 'Incorrect camera aspect');
    pixels(preview);
    preview.resize(360, 202, 1);
  });
  await test('No shader compile errors occurred', () => assert(shaderErrors.length === 0, shaderErrors.join('\n')));
} catch (error) {
  failed++;
  errors.textContent += `${error.stack}\n`;
} finally {
  preview?.dispose();
  console.error = originalError;
}
summary.textContent = `${passed} passed, ${failed} failed — complete`;
document.title = `${failed ? 'FAIL' : 'PASS'}: Dot Grid scene regression`;
document.body.dataset.result = failed ? 'failed' : 'passed';
window.dotGridSceneResults = { passed: failed === 0, checks: passed + failed, failed, errors: errors.textContent };

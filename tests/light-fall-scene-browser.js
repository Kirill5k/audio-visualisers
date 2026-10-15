import { createLightFallScene } from '../js/light-fall/light-fall-scene.js';
import { createSettings } from '../js/light-fall/light-fall-settings.js';
import { PRESETS } from '../js/light-fall/light-fall-presets.js';

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
function frame(settings, index) {
  const spectrum = new Uint8Array(settings.fftSize / 2);
  for (let bin = 0; bin < spectrum.length; bin++) {
    const envelope = Math.exp((-bin / spectrum.length) * 3);
    spectrum[bin] = Math.round(
      255 * envelope * (0.35 + 0.3 * Math.sin(bin * 0.063 + index * 0.31) ** 2),
    );
  }
  return { spectrum, time: index / 60, settings };
}
function pixels(instance) {
  const gl = instance.renderer.getContext();
  const result = new Uint8Array(instance.canvas.width * instance.canvas.height * 4);
  gl.readPixels(
    0,
    0,
    instance.canvas.width,
    instance.canvas.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    result,
  );
  assert(gl.getError() === gl.NO_ERROR, 'WebGL reported an error');
  return result;
}
function hash(bytes) {
  let result = 0x811c9dc5;
  for (const byte of bytes) result = Math.imul(result ^ byte, 0x1000193) >>> 0;
  return result;
}
function runFrames(instance, settings, count = 8) {
  for (let index = 0; index < count; index++) instance.step(frame(settings, index), 1 / 60);
  const geometries = new Set();
  instance.scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
  assert(geometries.size > 0, 'Scene has no geometry');
  for (const geometry of geometries) for (const [name, attribute] of Object.entries(geometry.attributes)) {
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

try {
  const initial = createSettings();
  const preview = createLightFallScene({
    settings: initial,
    width: 360,
    height: 202,
    pixelRatio: 1,
    interactive: true,
  });
  document.querySelector('#canvases').append(preview.canvas);
  await test('Original 700 trail meshes and 700 floor reflections share paired geometry', () => {
    const group = preview.scene.getObjectByName('Light Fall Trails');
    assert(group?.children.length === 1400, 'Expected 1,400 source and reflection meshes');
    const geometries = new Set();
    for (let index = 0; index < 700; index++) {
      const source = group.getObjectByName(`Light Fall Trail ${index}`);
      const reflection = group.getObjectByName(`Light Fall Reflection ${index}`);
      assert(source?.geometry === reflection?.geometry && Boolean(source), `Trail ${index} lost its shared reflection geometry`);
      assert(reflection.scale.y === -1 && reflection.position.y === -1, `Trail ${index} reflection has the wrong floor transform`);
      geometries.add(source.geometry);
    }
    assert(geometries.size === 700, 'Original independent trail paths were not retained');
  });
  for (const preset of PRESETS) {
    await test(`${preset.name}: renders finite, visible geometry`, () => {
      const settings = createSettings(preset.id);
      preview.applyPreset(settings);
      const output = runFrames(preview, settings, 4);
      assert(
        output.some((byte, index) => index % 4 !== 3 && byte > 5),
        'Frame is entirely dark',
      );
      assert(shaderErrors.length === 0, shaderErrors.join('\n'));
    });
  }

  await test('Linked variant contains visible blue trails over the background', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    const output = runFrames(preview, settings, 12);
    let bluePixels = 0;
    for (let offset = 0; offset < output.length; offset += 4) {
      if (output[offset + 2] > 15 && output[offset + 2] > output[offset] * 1.2) bluePixels++;
    }
    assert(bluePixels > 100, `Only ${bluePixels} blue pixels found`);
  });

  await test('Live trail count and path edits preserve camera', () => {
    const settings = { ...createSettings(), trailCount: 19, arcRadius: 50, pathMeander: 8, inverseMotion: true };
    const cameraBefore = preview.getCameraState();
    preview.setSettings(settings);
    assert(JSON.stringify(preview.getCameraState()) === JSON.stringify(cameraBefore), 'Live settings moved camera');
    runFrames(preview, settings);
    assert(preview.getDiagnostics().trailCount === 19, 'Live trail count was not applied');
  });

  await test('Audio envelopes and visual time reset after a seek or replay', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    runFrames(preview, settings, 12);
    const active = preview.getDiagnostics();
    assert(active.trailTime > 0, 'Animation clock did not advance');
    preview.reset();
    const reset = preview.getDiagnostics();
    assert(reset.trailTime === 0 && reset.slowEnergy === 0 && reset.fastEnergy === 0, 'Temporal state leaked through reset');
  });

  await test('Reset reproduces the same geometry, background, camera and feedback pixels', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    const first = hash(runFrames(preview, settings, 12));
    preview.reset();
    const second = hash(runFrames(preview, settings, 12));
    assert(first === second, `Reset changed pixels: ${first} versus ${second}`);
  });

  await test('Paused repaint preserves pixels; camera changes invalidate cached frame', () => {
    const original = hash(pixels(preview));
    preview.render();
    assert(hash(pixels(preview)) === original, 'Paused redraw changed pixels');
    const pose = preview.getCameraState();
    pose.position.x += 4;
    preview.setCameraState(pose);
    preview.render();
    assert(hash(pixels(preview)) !== original, 'Paused camera change was not rendered');
  });

  await test('Preview and isolated export scene render identical fixed-time frames', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    const exported = createLightFallScene({
      settings: structuredClone(settings),
      width: 360,
      height: 202,
      pixelRatio: 1,
      interactive: false,
    });
    document.querySelector('#canvases').append(exported.canvas);
    try {
      const first = runFrames(preview, settings, 10);
      const second = runFrames(exported, settings, 10);
      assert(first.length === second.length, 'Preview/export dimensions differ');
      let maxDifference = 0;
      for (let index = 0; index < first.length; index++)
        maxDifference = Math.max(maxDifference, Math.abs(first[index] - second[index]));
      assert(maxDifference <= 2, `Preview/export maximum channel error: ${maxDifference}`);
    } finally {
      exported.dispose();
    }
  });

  await test('Resize honors CSS dimensions and pixel ratio', () => {
    preview.resize(320, 180, 2);
    preview.step(frame(createSettings(), 11), 1 / 60);
    assert(
      preview.canvas.width === 640 && preview.canvas.height === 360,
      'Incorrect physical canvas size',
    );
    assert(preview.camera.aspect === 320 / 180, 'Incorrect camera aspect');
    pixels(preview);
    preview.resize(360, 202, 1);
  });

  await test('No shader compile errors occurred', () =>
    assert(shaderErrors.length === 0, shaderErrors.join('\n')));
  preview.dispose();
} catch (error) {
  failed++;
  errors.textContent += `${error.stack}\n`;
}
console.error = originalError;
summary.textContent = `${passed} passed, ${failed} failed — complete`;
document.title = `${failed ? 'FAIL' : 'PASS'}: Light Fall scene regression`;
document.body.dataset.result = failed ? 'failed' : 'passed';
window.lightFallSceneResults = { passed: failed === 0, checks: passed + failed, failed, errors: errors.textContent };

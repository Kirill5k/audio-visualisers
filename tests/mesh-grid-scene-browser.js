import { createMeshGridScene } from '../js/mesh-grid/mesh-grid-scene.js';
import { createSettings } from '../js/mesh-grid/mesh-grid-settings.js';
import { PRESETS } from '../js/mesh-grid/mesh-grid-presets.js';

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
  const positions = instance.geometry.attributes.position.array;
  assert(positions.every(Number.isFinite), 'Mesh positions contain NaN or infinity');
  assert(
    instance.geometry.attributes.frequency.array.every(Number.isFinite),
    'Frequency attributes contain invalid values',
  );
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
  const preview = createMeshGridScene({
    settings: initial,
    width: 360,
    height: 202,
    pixelRatio: 1,
    interactive: true,
  });
  document.querySelector('#canvases').append(preview.canvas);
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

  await test('Structural changes rebuild width/depth and preserve camera', () => {
    const settings = { ...createSettings(), gridSizeX: 29, gridSizeY: 23, sphereWrap: 1 };
    const cameraBefore = preview.getCameraState();
    preview.setSettings(settings);
    assert(preview.geometry.attributes.position.count === 29 * 23, 'Incorrect vertex count');
    const cameraAfter = preview.getCameraState();
    assert(
      Math.abs(cameraAfter.position.x - cameraBefore.position.x) < 1e-8,
      'Structural change moved camera',
    );
    runFrames(preview, settings);
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
    pose.position.x += 35;
    preview.setCameraState(pose);
    preview.render();
    assert(hash(pixels(preview)) !== original, 'Paused camera change was not rendered');
  });

  await test('Preview and isolated export scene render identical fixed-time frames', () => {
    const settings = createSettings();
    preview.applyPreset(settings);
    const exported = createMeshGridScene({
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
document.title = `${failed ? 'FAIL' : 'PASS'}: Mesh Grid scene regression`;

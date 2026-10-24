import { createParticleDanceScene } from '../js/particle-dance/particle-dance-scene.js';
import { createSettings } from '../js/particle-dance/particle-dance-settings.js';
import { PRESETS } from '../js/particle-dance/particle-dance-presets.js';

const list = document.querySelector('#results');
const summary = document.querySelector('#summary');
const errors = document.querySelector('#errors');
let passed = 0;
let failed = 0;
const shaderErrors = [];
const MOTION_KEYS = ['elasticExpansion', 'twistingCurrents', 'travellingRipples', 'particleJets', 'gatheringRelease'];
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
  return { spectrum, onsetSpectrum: spectrum, sampleRate: 48000, time: index / 60, settings };
}
function musicalFrame(settings, index) {
  const spectrum = new Uint8Array(settings.fftSize / 2);
  // Repeated attacks, sustained mids and quieter gaps exercise independent envelopes.
  const phase = index % 24;
  for (let bin = 0; bin < spectrum.length; bin++) {
    spectrum[bin] = phase < 4 ? 230 : phase < 12 ? (bin > 4 && bin < 80 ? 135 : 45) : 8;
  }
  return { spectrum, onsetSpectrum: spectrum, sampleRate: 48000, time: index / 60, settings };
}
function motionSettings(enabled = true) {
  return {
    ...createSettings(PRESETS.find(preset => preset.name.endsWith('#3')).id),
    particleCount: 500,
    ...Object.fromEntries(MOTION_KEYS.map(key => [key, enabled])),
  };
}
function runMusicalFrames(instance, settings, count = 36) {
  for (let index = 0; index < count; index++) instance.step(musicalFrame(settings, index), 1 / 60);
  const trails = instance.scene.getObjectByName('particle-jet-trails');
  assert(instance.geometry.attributes.position.array.every(Number.isFinite), 'Particle motion contains invalid positions');
  assert(trails.geometry.attributes.position.array.every(Number.isFinite), 'Jet trails contain invalid positions');
  return pixels(instance);
}
function geometrySnapshot(instance) {
  const trails = instance.scene.getObjectByName('particle-jet-trails');
  return {
    particles: Array.from(instance.geometry.attributes.position.array),
    trailCount: trails.geometry.drawRange.count,
    trails: Array.from(trails.geometry.attributes.position.array.subarray(0, trails.geometry.drawRange.count * 3)),
  };
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
  assert(positions.every(Number.isFinite), 'Particle positions contain NaN or infinity');
  assert(
    instance.geometry.attributes.size.array.every(Number.isFinite),
    'Size attributes contain invalid values',
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
  const preview = createParticleDanceScene({
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

  await test('Live particle count and hotspot edits preserve camera', () => {
    const settings = { ...createSettings(), particleCount: 670, hotspotCount: 11, showConnections: true, showHotspots: true, densityGlow: true };
    const cameraBefore = preview.getCameraState();
    preview.setSettings(settings);
    assert(JSON.stringify(preview.getCameraState()) === JSON.stringify(cameraBefore), 'Live settings moved camera');
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

  for (const key of MOTION_KEYS) {
    await test(`Variant #3: ${key} independently moves particles`, () => {
      const disabled = motionSettings(false);
      preview.applyPreset(disabled);
      runMusicalFrames(preview, disabled);
      const baseline = preview.geometry.attributes.position.array.slice();
      const enabled = { ...disabled, [key]: true };
      preview.applyPreset(enabled);
      runMusicalFrames(preview, enabled);
      const moved = preview.geometry.attributes.position.array;
      assert(moved.some((value, index) => Math.abs(value - baseline[index]) > .0001), `${key} did not change particle positions`);
      const trails = preview.scene.getObjectByName('particle-jet-trails');
      if (key === 'particleJets') {
        assert(trails.visible && trails.geometry.drawRange.count > 0, 'High-frequency attacks did not create jet trails');
        preview.setSettings(disabled);
        preview.render();
        assert(!trails.visible && trails.geometry.drawRange.count === 0, 'Disabling jets left visible trail segments');
      }
    });
  }

  await test('All five motions preserve particles, jet trails and pixels on pause and reset', () => {
    const settings = motionSettings();
    preview.applyPreset(settings);
    const firstPixels = hash(runMusicalFrames(preview, settings));
    const firstGeometry = JSON.stringify(geometrySnapshot(preview));
    assert(geometrySnapshot(preview).trailCount > 0, 'Expected active jet trails for the pause/reset check');
    preview.render();
    assert(JSON.stringify(geometrySnapshot(preview)) === firstGeometry, 'Paused repaint advanced motion or jet trails');
    assert(hash(pixels(preview)) === firstPixels, 'Paused motion repaint changed pixels');
    preview.reset();
    const secondPixels = hash(runMusicalFrames(preview, settings));
    assert(JSON.stringify(geometrySnapshot(preview)) === firstGeometry, 'Reset did not reproduce particle motion and jet trails');
    assert(firstPixels === secondPixels, 'Reset did not reproduce motion pixels');
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
    const settings = motionSettings();
    preview.applyPreset(settings);
    const exported = createParticleDanceScene({
      settings: structuredClone(settings),
      width: 360,
      height: 202,
      pixelRatio: 1,
      interactive: false,
    });
    document.querySelector('#canvases').append(exported.canvas);
    try {
      const first = runMusicalFrames(preview, settings);
      const second = runMusicalFrames(exported, settings);
      assert(JSON.stringify(geometrySnapshot(preview)) === JSON.stringify(geometrySnapshot(exported)), 'Preview/export motion or jet trail geometry differs');
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
document.title = `${failed ? 'FAIL' : 'PASS'}: Particle Dance scene regression`;

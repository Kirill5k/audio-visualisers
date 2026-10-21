import { createLEDGridScene } from '../js/led-grid/led-grid-scene.js';

const list = document.querySelector('#results');
const summary = document.querySelector('#summary');
const errors = document.querySelector('#errors');
const measurements = [];
const consoleErrors = [];
const originalError = console.error;
console.error = (...args) => {
  consoleErrors.push(args.map(String).join(' '));
  originalError(...args);
};
let passed = 0, failed = 0;
const settings = {
  mode: 'loom', loomFullHeight: false, loomHorizontal: false, motion: false,
  brightness: 1, glow: 0, gain: 1, persistence: 3,
};
// Uniform emitted light makes every physical LED measurable, independently of
// musical sparsity. The source stays at the analyser's original 96 × 54 size.
const loomLight = new Float32Array(96 * 54 * 4);
for (let offset = 0; offset < loomLight.length; offset += 4) loomLight[offset] = .2;
const data = {
  time: 1,
  loomLight,
  features: { bass: .65, mids: .5, highs: .4, energy: .7, rms: .16, width: .5 },
  waveform: { frames: [{ time: 1, age: 0, rmsLeft: .2, rmsRight: .2,
    left: Float32Array.from({ length: 128 }, (_, index) => Math.sin(index * .12) * .3),
    right: Float32Array.from({ length: 128 }, (_, index) => Math.cos(index * .1) * .3),
  }] },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(bytes) {
  let output = 0x811c9dc5;
  for (const byte of bytes) output = Math.imul(output ^ byte, 0x1000193) >>> 0;
  return output;
}

function runs(values) {
  const result = [];
  for (let index = 0; index < values.length; index++) {
    if (!values[index]) continue;
    const start = index;
    while (index + 1 < values.length && values[index + 1]) index++;
    result.push({ start, end: index, center: (start + index) / 2 });
  }
  return result;
}

function pitch(segments) {
  return (segments.at(-1).center - segments[0].center) / (segments.length - 1);
}

function readPixels(scene) {
  scene.render(data);
  const { width, height } = scene.canvas;
  const gl = scene.canvas.getContext('webgl2');
  assert(gl, 'The renderer did not expose a WebGL2 context');
  const bytes = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  assert(gl.getError() === gl.NO_ERROR, 'WebGL reported an error during readPixels');
  return { bytes, width, height };
}

function measure(frame) {
  const { bytes, width, height } = frame;
  const columns = new Uint8Array(width), rows = new Uint8Array(height);
  const mask = new Uint8Array(width * height);
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // readPixels starts at the lower left; report normal top-down screen bounds.
    const offset = ((height - 1 - y) * width + x) * 4;
    if (Math.max(bytes[offset], bytes[offset + 1], bytes[offset + 2]) <= 40) continue;
    mask[y * width + x] = 1;
    columns[x] = rows[y] = 1;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  assert(right >= left && bottom >= top, 'The rendered grid is entirely dark');
  return { width, height, left, right, top, bottom, mask,
    columnRuns: runs(columns), rowRuns: runs(rows) };
}

// With bloom disabled each lit diode is a separate connected component. This
// checks that all rows remain visible even when perspective slants their edges.
function countDiodes(measurement) {
  const { width, height } = measurement;
  const mask = measurement.mask.slice();
  const queue = new Uint32Array(mask.length);
  let count = 0;
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    count++;
    let first = 0, last = 1;
    queue[0] = index; mask[index] = 0;
    while (first < last) {
      const pixel = queue[first++], x = pixel % width;
      const enqueue = neighbor => {
        if (mask[neighbor]) { mask[neighbor] = 0; queue[last++] = neighbor; }
      };
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (pixel >= width) enqueue(pixel - width);
      if (pixel + width < width * height) enqueue(pixel + width);
    }
  }
  return count;
}

function record(label, measurement) {
  const { mask, columnRuns, rowRuns, ...bounds } = measurement;
  measurements.push({ label, ...bounds, visibleColumns: columnRuns.length, visibleRows: rowRuns.length });
  document.querySelector('#measurements').textContent = JSON.stringify(measurements, null, 2);
}

function assertUnclipped(measurement, label) {
  assert(measurement.left > 0 && measurement.right < measurement.width - 1 &&
    measurement.top > 0 && measurement.bottom < measurement.height - 1,
  `${label}: lit LEDs touch the canvas edge`);
  const count = countDiodes(measurement);
  assert(count === 96 * 69, `${label}: expected 6624 visible LEDs, found ${count}`);
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

let scene;
try {
  scene = createLEDGridScene(document.querySelector('#stage'), settings);
  scene.resize(1920, 1080, 1);

  await test('The default grid visibly contains 96 columns and 54 rows', () => {
    settings.loomFullHeight = false;
    const original = measure(readPixels(scene));
    record('Default front at 1920 × 1080', original);
    assert(scene.getInfo().rows === 54 && scene.getInfo().leds === 5184, 'Default grid dimensions changed');
    assert(original.columnRuns.length === 96, `Expected 96 columns, found ${original.columnRuns.length}`);
    assert(original.rowRuns.length === 54, `Expected 54 rows, found ${original.rowRuns.length}`);
  });

  await test('Full height adds 15 rows below the original grid without enlarging LEDs', () => {
    settings.loomFullHeight = false;
    const original = measure(readPixels(scene));
    settings.loomFullHeight = true;
    const extended = measure(readPixels(scene));
    record('Extra rows front at 1920 × 1080', extended);
    assert(scene.getInfo().rows === 69 && scene.getInfo().leds === 6624, 'Full-height grid dimensions are not 96 × 69');
    assert(extended.columnRuns.length === 96 && extended.rowRuns.length === 69,
      `Expected 96 × 69 visible LEDs, found ${extended.columnRuns.length} × ${extended.rowRuns.length}`);
    assert(Math.abs(original.top - extended.top) <= 1, 'The top edge moved when rows were added');
    assert(Math.abs(original.left - extended.left) <= 1 && Math.abs(original.right - extended.right) <= 1,
      'The grid became wider when rows were added');
    assert(Math.abs(pitch(original.columnRuns) - pitch(extended.columnRuns)) < .05, 'Horizontal LED spacing changed');
    assert(Math.abs(pitch(original.rowRuns) - pitch(extended.rowRuns)) < .05, 'Vertical LED spacing changed');
    assert(Math.abs((extended.bottom - original.bottom) - 15 * pitch(original.rowRuns)) <= 2,
      'The lower edge did not extend by exactly 15 LED rows');
    assertUnclipped(extended, 'Front view');
  });

  await test('Turning extra rows off restores the original frame exactly', () => {
    settings.loomFullHeight = false;
    const original = hash(readPixels(scene).bytes);
    settings.loomFullHeight = true;
    readPixels(scene);
    settings.loomFullHeight = false;
    assert(hash(readPixels(scene).bytes) === original, 'Toggling back changed the original rendered frame');
  });

  for (const mode of ['calligraphy', 'choreography']) {
    await test(`Extra rows do not alter ${mode} dimensions or pixels`, () => {
      settings.mode = mode;
      settings.loomFullHeight = false;
      const original = readPixels(scene);
      measure(original); // Ensure equality is not merely comparing two black frames.
      settings.loomFullHeight = true;
      const toggled = readPixels(scene);
      assert(scene.getInfo().rows === 54 && scene.getInfo().leds === 5184, `${mode} gained rows`);
      assert(hash(toggled.bytes) === hash(original.bytes), `${mode} pixels changed`);
    });
  }

  await test('Added rows remain fully visible in Front, Left and Right views after resizing', () => {
    settings.mode = 'loom';
    settings.loomFullHeight = true;
    for (const [width, height] of [[1920, 1080], [1280, 800], [960, 540]]) {
      // Match the app's minimum 4K backing canvas. At CSS resolution alone,
      // antialiasing can connect adjacent oblique LED faces across a one-pixel
      // gap, which makes component counting report missing rows incorrectly.
      const pixelRatio = Math.max(2, 3840 / width);
      scene.resize(width, height, pixelRatio);
      for (const view of ['front', 'left', 'right']) {
        scene.setView(view);
        const rendered = measure(readPixels(scene));
        const label = `${view} at ${width} × ${height}, pixel ratio ${pixelRatio}`;
        record(label, rendered);
        assertUnclipped(rendered, label);
      }
    }
  });

  await test('All grid materials compile and render without console errors', () => {
    assert(consoleErrors.length === 0, consoleErrors.join('\n'));
  });
} catch (error) {
  failed++;
  errors.textContent += `${error.stack}\n`;
} finally {
  scene?.dispose();
  console.error = originalError;
}
summary.textContent = `${passed} passed, ${failed} failed — complete`;
document.title = `${failed ? 'FAIL' : 'PASS'}: LED Grid extra rows regression`;
window.ledGridRowsResults = { passed, failed, measurements, errors: errors.textContent, consoleErrors };

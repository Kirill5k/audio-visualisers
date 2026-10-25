const iframe = document.querySelector('#app');
const run = document.querySelector('#run');
const summary = document.querySelector('#summary');
const results = document.querySelector('#results');
const errors = document.querySelector('#errors');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
let app;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wavFile(buffer) {
  const channels = Math.min(buffer.numberOfChannels, 2), rate = buffer.sampleRate;
  const frames = Math.min(Math.round(8 * rate), buffer.length);
  const start = Math.min(Math.round(12 * rate), buffer.length - frames);
  const data = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(data);
  const text = (offset, value) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, data.byteLength - 44, true);
  for (let index = 0; index < frames; index++) for (let channel = 0; channel < channels; channel++) {
    view.setInt16(44 + (index * channels + channel) * 2, Math.max(-1, Math.min(1, buffer.getChannelData(channel)[start + index])) * 32767, true);
  }
  return new File([data], 'reference-loom-excerpt.wav', { type: 'audio/wav' });
}

function mesh() {
  const dots = app.scene.scene.getObjectByName('Dot Grid');
  assert(dots?.isInstancedMesh, 'The sphere grid is missing');
  assert(dots.instanceMatrix.array.every(Number.isFinite), 'Dot transforms contain NaN or infinity');
  assert(dots.instanceColor?.array.every(Number.isFinite), 'Dot colors contain NaN or infinity');
  return dots;
}

function colors() { return mesh().instanceColor.array.slice(); }
function equal(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function pixels() {
  app.scene.render();
  const { renderer, canvas } = app.scene, gl = renderer.getContext();
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  assert(gl.getError() === gl.NO_ERROR, 'WebGL reported an error');
  return bytes;
}

async function runChecks() {
  run.disabled = true; results.replaceChildren(); errors.textContent = '';
  document.body.dataset.result = 'running';
  summary.textContent = 'Preparing eight seconds of reference audio…';
  const reports = [], consoleErrors = [], browser = iframe.contentWindow;
  const originalError = browser.console.error;
  browser.console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); originalError.apply(browser.console, args); };
  const unhandled = event => consoleErrors.push(String(event.reason?.stack || event.reason || event.message));
  browser.addEventListener('error', unhandled);
  browser.addEventListener('unhandledrejection', unhandled);
  async function test(name, callback) {
    const row = document.createElement('li'); row.textContent = `Running: ${name}`; results.append(row);
    try { await callback(); reports.push({ name, passed: true }); row.className = 'pass'; row.textContent = `PASS: ${name}`; }
    catch (error) { reports.push({ name, passed: false, error: error.message }); row.className = 'fail'; row.textContent = `FAIL: ${name} — ${error.message}`; errors.textContent += `${error.stack}\n`; }
    summary.textContent = `${reports.filter(report => report.passed).length} passed, ${reports.filter(report => !report.passed).length} failed; running…`;
    await new Promise(requestAnimationFrame);
  }
  try {
    const context = new AudioContext();
    let clip;
    try {
      const response = await fetch('../reference.mp3');
      assert(response.ok, 'reference.mp3 is required for this browser check');
      clip = wavFile(await context.decodeAudioData(await response.arrayBuffer()));
    } finally { await context.close(); }
    await app.load(clip, { autoplay: false });
    app.audio.setMuted(true);
    const initial = { presetId: app.getState().presetId, width: app.settings.gridWidth, height: app.settings.gridHeight, camera: JSON.stringify(app.scene.getCameraState()) };
    await app.setSetting('scrollingSpectrum', true);

    await test('Scrolling Spectrum Mode preserves the selected variant and displays its spectrum', async () => {
      assert(app.settings.scrollingSpectrum === true, 'The checkbox did not activate the spectrum');
      assert(app.getState().presetId === initial.presetId, 'Enabling the spectrum selected a different variant');
      assert(JSON.stringify(app.scene.getCameraState()) === initial.camera, 'Enabling the spectrum moved the camera');
      const checkbox = iframe.contentDocument.getElementById('control-scrollingSpectrum');
      assert(checkbox?.type === 'checkbox' && checkbox.checked, 'Scrolling Spectrum Mode checkbox is missing or unchecked');
      assert(checkbox.closest('label').textContent.trim() === 'Scrolling Spectrum Mode', 'The checkbox label does not match the requested mode');
      for (const key of ['loomHorizontal', 'loomGain', 'loomPersistence', 'loomBrightness']) {
        assert(iframe.contentDocument.getElementById(`control-${key}`), `${key} control is missing`);
      }
      await app.seek(2);
      assert(mesh().count === initial.width * initial.height, 'Enabling the spectrum changed the grid dimensions');
      assert(colors().some(value => value > .01), 'Reference audio produced no lit dots');
      const frame = pixels();
      assert(frame.some((value, index) => index % 4 !== 3 && value > 12), 'The spectrum grid rendered an entirely dark frame');
    });

    await test('The configuration checkbox toggles the mode without changing variant, dimensions, or camera', async () => {
      await app.seek(6); const expected = colors(), camera = JSON.stringify(app.scene.getCameraState());
      for (const enabled of [false, true]) {
        const checkbox = iframe.contentDocument.getElementById('control-scrollingSpectrum');
        checkbox.checked = enabled;
        checkbox.dispatchEvent(new browser.Event('input', { bubbles: true }));
        const started = performance.now();
        while (app.locked && performance.now() - started < 30000) await tick(20);
        assert(!app.locked && app.settings.scrollingSpectrum === enabled, 'The mode checkbox did not apply its value');
        assert(app.getState().presetId === initial.presetId, 'Toggling the checkbox changed the selected variant');
        assert(mesh().count === initial.width * initial.height, 'Toggling the checkbox changed grid dimensions');
        assert(JSON.stringify(app.scene.getCameraState()) === camera, 'Toggling the checkbox moved the camera');
      }
      assert(equal(expected, colors()), 'Turning the spectrum back on did not restore its history');
    });

    await test('The rendered spectrum changes with the reference audio', async () => {
      await app.seek(2); const first = colors(), firstPixels = pixels();
      await app.seek(6);
      assert(!equal(first, colors()), 'Different audio times produced identical dot colors');
      assert(!equal(firstPixels, pixels()), 'Different audio times produced identical visible frames');
    });

    await test('Nonsequential seeks reconstruct the same absolute-time spectrum history', async () => {
      await app.seek(6); const expected = colors(), expectedPixels = pixels();
      await app.seek(1.5); await app.seek(7.5); await app.seek(6);
      assert(equal(expected, colors()), 'Seeking back to six seconds changed the spectrum history');
      assert(equal(expectedPixels, pixels()), 'Seeking back to six seconds changed the rendered frame');
    });

    await test('Paused playback preserves the spectrum, audio time, and rendered frame', async () => {
      await app.seek(6);
      const expected = colors(), expectedPixels = pixels(), time = app.audio.getPlaybackPosition();
      await tick(180);
      assert(!app.audio.isPlaying && app.audio.getPlaybackPosition() === time, 'Paused audio position advanced');
      assert(equal(expected, colors()) && equal(expectedPixels, pixels()), 'The paused spectrum continued changing');
    });

    await test('Horizontal orientation remaps the spectrum and can be restored while paused', async () => {
      await app.seek(6); const expected = colors();
      await app.setSetting('loomHorizontal', true);
      assert(!equal(expected, colors()), 'Horizontal orientation did not remap the dots');
      assert(app.audio.getPlaybackPosition() === 6, 'Orientation changed audio position');
      await app.setSetting('loomHorizontal', false);
      assert(equal(expected, colors()), 'Restoring vertical orientation changed the spectrum history');
    });

    await test('Grid dimensions remain editable and restore the original spectrum mapping', async () => {
      await app.seek(6); const expected = colors();
      await app.setSetting('gridWidth', 48); await app.setSetting('gridHeight', 36);
      assert(mesh().count === 48 * 36, 'Edited dimensions did not rebuild the sphere grid');
      assert(colors().some(value => value > .01), 'Resized grid lost the spectrum');
      await app.setSetting('gridWidth', initial.width); await app.setSetting('gridHeight', initial.height);
      assert(mesh().count === initial.width * initial.height && equal(expected, colors()), 'Restoring dimensions changed the spectrum mapping');
      assert(app.audio.getPlaybackPosition() === 6, 'Resizing changed audio position');
    });

    await test('Gain and brightness respond to paused edits', async () => {
      await app.seek(6); const expected = colors();
      await app.setSetting('loomGain', .2);
      assert(!equal(expected, colors()), 'Gain did not change the spectrum');
      await app.setSetting('loomGain', 1.3);
      assert(equal(expected, colors()), 'Restoring gain did not reproduce the spectrum');
      await app.setSetting('loomBrightness', 0);
      assert(colors().every(value => value === 0), 'Zero brightness left lit spectrum dots');
      await app.setSetting('loomBrightness', 1);
      assert(equal(expected, colors()), 'Restoring brightness did not reproduce the spectrum');
    });

    await test('The production transport plays and pauses the reference excerpt', async () => {
      await app.seek(2);
      const before = colors();
      iframe.contentDocument.querySelector('#playPauseBtn').click();
      await tick(500);
      iframe.contentDocument.querySelector('#playPauseBtn').click();
      await tick(100);
      assert(!app.audio.isPlaying && app.audio.getPlaybackPosition() > 2.2, 'Transport did not play and pause the excerpt');
      assert(!equal(before, colors()), 'Playing audio did not update the spectrum');
    });
    await test('No rendering or audio errors occurred', () => assert(consoleErrors.length === 0, consoleErrors.join('\n')));
  } catch (error) {
    reports.push({ name: 'Prepare scrolling spectrum integration checks', passed: false, error: error.message });
    errors.textContent += `${error.stack}\n`;
  } finally {
    browser.console.error = originalError;
    browser.removeEventListener('error', unhandled);
    browser.removeEventListener('unhandledrejection', unhandled);
    await app.audio.pause();
    run.disabled = false;
  }
  const failed = reports.filter(report => !report.passed).length;
  window.dotGridLoomResults = { passed: failed === 0, checks: reports, errors: consoleErrors };
  summary.textContent = `${reports.length - failed} passed, ${failed} failed — complete`;
  summary.className = failed ? 'fail' : 'pass';
  document.body.dataset.result = failed ? 'failed' : 'passed';
  document.title = `${failed ? 'FAIL' : 'PASS'}: Dot Grid scrolling spectrum checks`;
}

run.addEventListener('click', runChecks);
const started = performance.now();
const ready = setInterval(() => {
  app = iframe.contentWindow.__dotGridTest;
  if (app) { clearInterval(ready); run.disabled = false; summary.textContent = 'Ready. Run the checks to inspect the production scrolling spectrum.'; }
  else if (performance.now() - started > 30000 || iframe.contentDocument?.querySelector('#fatal')?.textContent) {
    clearInterval(ready); document.body.dataset.result = 'failed';
    summary.textContent = iframe.contentDocument?.querySelector('#fatal')?.textContent || 'Dot Grid did not initialize in 30 seconds';
  }
}, 100);

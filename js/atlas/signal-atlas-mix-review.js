// Opt-in checks for the production mix controls. No work runs on import.
const CONTROL_IDS = ['terrainNear', 'terrainFar', 'energyHue', 'setlistInput'];

function setControl(id, value) {
  const input = document.getElementById(id);
  if (!input || input.disabled) throw new Error(`The ${id} control is unavailable.`);
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function snapshotPixels() {
  const canvas = document.querySelector('#stage canvas');
  const gl = canvas?.getContext('webgl2');
  if (!gl) throw new Error('The production WebGL2 canvas is unavailable.');
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const bottomBytes = canvas.width * Math.floor(canvas.height * .25) * 4;
  let hash = 2166136261, bottomQuarterNonBlackPixels = 0, markerStripNonBlackPixels = 0;
  // The overview ends at 71.1%; carets occupy 71.5–72.1%. This strip excludes
  // both the waveform and elapsed/remaining text, isolating actual marker ink.
  const markerBottom = Math.floor(canvas.height * (1 - .724));
  const markerTop = Math.ceil(canvas.height * (1 - .713));
  const markerLeft = Math.floor(canvas.width * .057);
  const markerRight = Math.ceil(canvas.width * .943);
  for (let i = 0; i < pixels.length; i += 4) {
    const nonBlack = pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0;
    if (i < bottomBytes && nonBlack) bottomQuarterNonBlackPixels++;
    const pixel = i / 4;
    const y = Math.floor(pixel / canvas.width), x = pixel % canvas.width;
    if (nonBlack && y >= markerBottom && y < markerTop && x >= markerLeft && x < markerRight) markerStripNonBlackPixels++;
    for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ pixels[i + channel], 16777619);
  }
  return { width: canvas.width, height: canvas.height, hash: (hash >>> 0).toString(16).padStart(8, '0'),
    bottomQuarterNonBlackPixels, markerStripNonBlackPixels, gpuError: gl.getError() };
}

function closeRGB(actual, expected) {
  return Array.isArray(actual) && actual.length === 3 && actual.every((value, i) => Math.abs(value - expected[i]) < 1e-5);
}

/** Exercise real DOM events, worker seeks, shader uniforms, and captured pixels.
 * The currently loaded reference and every modified setting are restored. */
export async function runMixControlChecks(api) {
  const initial = api.getState();
  if (!initial.ready || initial.fileName !== 'reference.mp3') throw new Error('Load the reference track before running mix-control checks.');
  if (initial.busy || initial.recording || initial.exporting) throw new Error('Wait for the current operation to finish.');
  const controls = Object.fromEntries(CONTROL_IDS.map(id => {
    const input = document.getElementById(id);
    return [id, input.type === 'checkbox' ? input.checked : input.value];
  }));
  const results = { passed: false, checks: {}, frames: {}, restored: false };
  const started = performance.now();
  await api.pause();
  const savedTime = api.getState().position;
  const nearRGB = [1, 136 / 255, 68 / 255], farRGB = [68 / 255, 119 / 255, 204 / 255];
  try {
    setControl('setlistInput', `00:00 Grooved Terrain - Ice Volcano
04:02 Lost Astronaut - There's Something About You
08:04 AIKON, PÔNGO - Lost In You
11:51 M.ono - Ataraa`);
    await api.renderAt(80);
    const sample = api.getState();
    results.checks.sampleSetlistFiltersDuration = sample.setlist.entries.length === 2 && sample.setlist.outOfRange.length === 2 && sample.setlist.errors.length === 0;

    setControl('setlistInput', '00:00 First\n00:30 Second\n01:00 Third\n02:00 Fourth\n04:00 Fifth');
    await api.renderAt(80);
    results.checks.fiveMarkerLabels = api.getState().scene.labelState.markerCount === 5;
    results.frames.marked = snapshotPixels();
    results.checks.caretsProduceVisiblePixels = results.frames.marked.markerStripNonBlackPixels > 30;
    setControl('setlistInput', '');
    await api.renderAt(80);
    results.frames.cleared = snapshotPixels();
    results.checks.clearingRemovesMarkerPixels = api.getState().scene.labelState.markerCount === 0 && results.frames.cleared.markerStripNonBlackPixels === 0;

    setControl('terrainNear', '#ff8844');
    setControl('terrainFar', '#4477cc');
    setControl('energyHue', false);
    await api.renderAt(80);
    const base = api.getState();
    results.colors = { base: base.scene.terrainColors };
    results.checks.nativePickersSetShaderColors = base.settings.terrainNear === '#ff8844' && base.settings.terrainFar === '#4477cc'
      && closeRGB(base.scene.terrainColors.newest, nearRGB) && closeRGB(base.scene.terrainColors.history, farRGB);
    results.frames.baseColor = snapshotPixels();

    setControl('energyHue', true);
    await api.renderAt(80);
    const shifted = api.getState();
    results.colors.shifted = shifted.scene.terrainColors;
    results.frames.hue = snapshotPixels();
    results.checks.energyChangesHue = shifted.settings.energyHue && shifted.scene.terrainColors.energy > 0
      && !closeRGB(shifted.scene.terrainColors.newest, nearRGB) && !closeRGB(shifted.scene.terrainColors.history, farRGB)
      && results.frames.hue.hash !== results.frames.baseColor.hash;
    await api.renderAt(12);
    await api.renderAt(80);
    results.frames.hueAfterSeek = snapshotPixels();
    results.checks.hueIsDeterministicAfterSeek = results.frames.hue.hash === results.frames.hueAfterSeek.hash
      && JSON.stringify(results.colors.shifted) === JSON.stringify(api.getState().scene.terrainColors);

    setControl('energyHue', false);
    await api.renderAt(80);
    results.frames.hueDisabled = snapshotPixels();
    const disabled = api.getState();
    results.checks.disabledHueRestoresBase = closeRGB(disabled.scene.terrainColors.newest, nearRGB)
      && closeRGB(disabled.scene.terrainColors.history, farRGB) && results.frames.baseColor.hash === results.frames.hueDisabled.hash;

    setControl('setlistInput', '00:00 First\n00:00 Duplicate\n00:75 Invalid seconds\n01:00 <b>Plain text title</b>');
    await api.renderAt(80);
    const invalid = api.getState();
    const status = document.getElementById('setlistStatus');
    results.checks.invalidRowsExplainProblems = invalid.setlist.entries.length === 2 && invalid.setlist.errors.length === 2
      && /2 rows ignored/u.test(status.textContent) && /Line 2: Duplicate/u.test(status.textContent) && /Line 3:/u.test(status.textContent);
    results.checks.titlesRemainPlaintext = invalid.setlist.entries[1].title === '<b>Plain text title</b>'
      && !status.querySelector('b');
    results.frames.invalidSetlist = snapshotPixels();
    results.checks.bottomQuarterBlack = Object.values(results.frames).every(frame => frame.bottomQuarterNonBlackPixels === 0);
    results.checks.noGpuErrors = Object.values(results.frames).every(frame => frame.gpuError === 0);
  } catch (error) {
    results.error = error?.message || String(error);
  } finally {
    try {
      for (const [id, value] of Object.entries(controls)) setControl(id, value);
      await api.renderAt(savedTime);
      const restored = api.getState();
      results.restored = restored.position === savedTime && CONTROL_IDS.every(id => {
        const input = document.getElementById(id);
        return (input.type === 'checkbox' ? input.checked : input.value) === controls[id];
      });
      if (initial.playing) await api.play();
      results.restored &&= api.getState().playing === initial.playing;
    } catch (error) { results.restorationError = error?.message || String(error); }
  }
  results.passed = !results.error && results.restored && Object.keys(results.checks).length === 12 && Object.values(results.checks).every(Boolean);
  results.durationSeconds = Math.round((performance.now() - started) / 10) / 100;
  return results;
}

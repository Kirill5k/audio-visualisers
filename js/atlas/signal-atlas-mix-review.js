// Opt-in checks for the production analysis controls. No work runs on import.
import { ATLAS_COLOR_DEFAULTS, ATLAS_COLOR_PRESETS } from './signal-atlas-palette.js';

const COLOR_IDS = Object.keys(ATLAS_COLOR_DEFAULTS);
const CONTROL_IDS = ['rtaMin', 'rtaMax', 'rtaBoost', 'rtaPreset', 'gain', 'gridOpacity', 'labels', 'setlistInput', ...COLOR_IDS];
// These regions follow the scene's spectrogram/overview layout and headings.
const COLOR_RECTS = {
  spectrogram: { x: .06, y: .4014, w: .88, h: .1518 },
  overview: { x: .06, y: .5922, w: .88, h: .1188 },
  headings: { x: .05, y: .03, w: .90, h: .073 },
};
const waitForPausedPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function setControl(id, value) {
  const input = document.getElementById(id);
  if (!input || input.disabled) throw new Error(`The ${id} control is unavailable.`);
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function snapshotPixels(rects) {
  const canvas = document.querySelector('#stage canvas');
  const gl = canvas?.getContext('webgl2');
  if (!gl) throw new Error('The production WebGL2 canvas is unavailable.');
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const bottomBytes = canvas.width * Math.floor(canvas.height * .25) * 4;
  let hash = 2166136261, outsideSpectrogramHash = 2166136261, bottomQuarterNonBlackPixels = 0, markerStripNonBlackPixels = 0;
  const spectrogram = COLOR_RECTS.spectrogram;
  const spectrumLeft = Math.floor(canvas.width * spectrogram.x);
  const spectrumRight = Math.ceil(canvas.width * (spectrogram.x + spectrogram.w));
  const spectrumBottom = Math.floor(canvas.height * (1 - spectrogram.y - spectrogram.h));
  const spectrumTop = Math.ceil(canvas.height * (1 - spectrogram.y));
  // The overview ends at 71.1%; carets occupy 70.6–71.1%. The playhead also
  // crosses this strip, so compare marker ink against an unmarked frame.
  const markerBottom = Math.floor(canvas.height * (1 - .712));
  const markerTop = Math.ceil(canvas.height * (1 - .705));
  const markerLeft = Math.floor(canvas.width * .057);
  const markerRight = Math.ceil(canvas.width * .943);
  for (let i = 0; i < pixels.length; i += 4) {
    const nonBlack = pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0;
    if (i < bottomBytes && nonBlack) bottomQuarterNonBlackPixels++;
    const pixel = i / 4;
    const y = Math.floor(pixel / canvas.width), x = pixel % canvas.width;
    if (nonBlack && y >= markerBottom && y < markerTop && x >= markerLeft && x < markerRight) markerStripNonBlackPixels++;
    const outsideSpectrogram = x < spectrumLeft || x >= spectrumRight || y < spectrumBottom || y >= spectrumTop;
    for (let channel = 0; channel < 4; channel++) {
      hash = Math.imul(hash ^ pixels[i + channel], 16777619);
      if (outsideSpectrogram) outsideSpectrogramHash = Math.imul(outsideSpectrogramHash ^ pixels[i + channel], 16777619);
    }
  }
  const instrumentHashes = {};
  for (const [name, rect] of Object.entries({ ...rects, ...COLOR_RECTS })) {
    const left = Math.max(0, Math.floor(canvas.width * rect.x));
    const right = Math.min(canvas.width, Math.ceil(canvas.width * (rect.x + rect.w)));
    const bottom = Math.max(0, Math.floor(canvas.height * (1 - rect.y - rect.h)));
    const top = Math.min(canvas.height, Math.ceil(canvas.height * (1 - rect.y)));
    let regionHash = 2166136261;
    for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) {
      const offset = (y * canvas.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) regionHash = Math.imul(regionHash ^ pixels[offset + channel], 16777619);
    }
    instrumentHashes[name] = (regionHash >>> 0).toString(16).padStart(8, '0');
  }
  return { width: canvas.width, height: canvas.height, hash: (hash >>> 0).toString(16).padStart(8, '0'),
    outsideSpectrogramHash: (outsideSpectrogramHash >>> 0).toString(16).padStart(8, '0'),
    instrumentHashes, bottomQuarterNonBlackPixels, markerStripNonBlackPixels, gpuError: gl.getError() };
}

function effectiveRta(api) { return api.getState().scene.instruments.rta; }
function sameRange(actual, min, max) { return actual.min === min && actual.max === max; }

/** Exercise real DOM events, worker seeks, analysis controls and captured pixels.
 * The currently loaded reference and every modified setting are restored. */
export async function runMixControlChecks(api) {
  const initial = api.getState();
  if (!initial.ready || initial.fileName !== 'reference.mp3') throw new Error('Load the reference track before running analysis-control checks.');
  if (initial.busy || initial.recording || initial.exporting) throw new Error('Wait for the current operation to finish.');
  const controls = Object.fromEntries(CONTROL_IDS.map(id => {
    const input = document.getElementById(id);
    if (!input) throw new Error(`The ${id} control is unavailable.`);
    return [id, input.type === 'checkbox' ? input.checked : input.value];
  }));
  const colorPreset = document.getElementById('colorPreset');
  if (!colorPreset || colorPreset.disabled) throw new Error('The colour preset control is unavailable.');
  const savedColorPreset = colorPreset.value;
  const results = { passed: false, checks: {}, frames: {}, restored: false };
  const wasClean = document.body.classList.contains('clean');
  const started = performance.now();
  await api.pause();
  const savedTime = api.getState().position;
  const capture = () => snapshotPixels(api.getState().scene.instruments.rects);
  try {
    if (wasClean) document.getElementById('cleanBtn').click();
    setControl('labels', true);
    setControl('setlistInput', `00:00 Grooved Terrain - Ice Volcano
04:02 Lost Astronaut - There's Something About You
08:04 AIKON, PÔNGO - Lost In You
11:51 M.ono - Ataraa`);
    await api.renderAt(80);
    const sample = api.getState();
    results.checks.sampleSetlistFiltersDuration = sample.setlist.entries.length === 2 && sample.setlist.outOfRange.length === 2 && sample.setlist.errors.length === 0;

    setControl('setlistInput', '');
    await api.renderAt(80);
    results.frames.unmarked = capture();
    setControl('setlistInput', '00:00 First\n00:30 Second\n01:00 Third\n02:00 Fourth\n04:00 Fifth');
    await api.renderAt(80);
    results.checks.fiveMarkerLabels = api.getState().scene.labelState.markerCount === 5;
    results.frames.marked = capture();
    results.checks.caretsProduceVisiblePixels = results.frames.marked.markerStripNonBlackPixels - results.frames.unmarked.markerStripNonBlackPixels > 30;
    setControl('setlistInput', '');
    await api.renderAt(80);
    results.frames.cleared = capture();
    results.checks.clearingRemovesMarkerPixels = api.getState().scene.labelState.markerCount === 0
      && results.frames.cleared.markerStripNonBlackPixels === results.frames.unmarked.markerStripNonBlackPixels;

    results.presets = {};
    for (const [preset, min, max] of [['full', 20, 20000], ['bass', 20, 500], ['mids', 500, 4000], ['highs', 4000, 20000]]) {
      setControl('rtaPreset', preset);
      await api.renderAt(80);
      const rta = effectiveRta(api);
      results.presets[preset] = rta;
      results.checks[`${preset}PresetSetsRange`] = sameRange(rta, min, Math.min(max, initial.analysis.sampleRate / 2))
        && Number(document.getElementById('rtaMin').value) === rta.min
        && Number(document.getElementById('rtaMax').value) === rta.max;
    }

    setControl('rtaPreset', 'full');
    setControl('rtaMin', 120);
    setControl('rtaMax', 8000);
    await api.renderAt(80);
    results.checks.manualRangeUsesCustom = sameRange(effectiveRta(api), 120, 8000)
      && document.getElementById('rtaPreset').value === 'custom';
    const previousRange = effectiveRta(api);
    setControl('rtaMin', 0);
    await api.renderAt(80);
    results.checks.zeroFrequencyRejected = sameRange(effectiveRta(api), previousRange.min, previousRange.max)
      && document.getElementById('rtaMin').getAttribute('aria-invalid') === 'true'
      && Boolean(document.getElementById('rtaStatus').textContent.trim());
    setControl('rtaMin', previousRange.min);
    setControl('rtaMax', 100);
    await api.renderAt(80);
    results.checks.reversedRangeRejected = sameRange(effectiveRta(api), previousRange.min, previousRange.max)
      && document.getElementById('rtaMax').getAttribute('aria-invalid') === 'true'
      && Boolean(document.getElementById('rtaStatus').textContent.trim());

    setControl('rtaPreset', 'full');
    setControl('rtaBoost', 0);
    await api.renderAt(80);
    results.frames.rawRta = capture();
    const rawRta = effectiveRta(api);
    setControl('rtaBoost', 18);
    await api.renderAt(80);
    results.frames.boostedRta = capture();
    results.checks.boostChangesAnalyzer = rawRta.boost === 0 && effectiveRta(api).boost === 18
      && results.frames.rawRta.instrumentHashes.analyzer !== results.frames.boostedRta.instrumentHashes.analyzer;
    results.checks.boostPreservesPeakMeter = results.frames.rawRta.instrumentHashes.meters === results.frames.boostedRta.instrumentHashes.meters;
    await api.renderAt(12);
    await api.renderAt(80);
    results.frames.boostedAfterSeek = capture();
    results.checks.analyzerDeterministicAfterSeek = results.frames.boostedRta.hash === results.frames.boostedAfterSeek.hash;

    setControl('gain', .7);
    await api.renderAt(80);
    results.frames.lowGain = capture();
    setControl('gain', 2.2);
    await api.renderAt(80);
    results.frames.highGain = capture();
    results.checks.gainChangesHistory = results.frames.lowGain.hash !== results.frames.highGain.hash;
    results.checks.gainPreservesInstruments = ['scope', 'analyzer', 'meters'].every(name =>
      results.frames.lowGain.instrumentHashes[name] === results.frames.highGain.instrumentHashes[name]);

    // Exercise paused invalidation directly. Seeking between these edits would
    // hide missing control handlers or stale material/label palette caches.
    for (const id of COLOR_IDS) setControl(id, ATLAS_COLOR_DEFAULTS[id]);
    setControl('gain', 1.3);
    setControl('gridOpacity', .3);
    setControl('rtaBoost', 6);
    await waitForPausedPaint();
    results.frames.defaultColors = capture();
    results.checks.defaultColorInputsInferOriginal = colorPreset.value === 'original';
    const colorTime = api.getState().position;
    const colorFrame = api.getState().uploadedFrame;
    const sameRegions = (before, after, names) => names.every(name => before.instrumentHashes[name] === after.instrumentHashes[name]);
    const changedRegions = (before, after, names) => names.every(name => before.instrumentHashes[name] !== after.instrumentHashes[name]);
    const paintedWhilePaused = () => {
      const state = api.getState();
      return !state.playing && !state.busy && state.position === colorTime && state.uploadedFrame === colorFrame;
    };
    let colorsPaintedWhilePaused = paintedWhilePaused();

    // Finish with Original so the individual picker checks share the same
    // default baseline. Every selection must repaint without seeking.
    const colorPresets = Object.entries(ATLAS_COLOR_PRESETS);
    let previousPresetFrame = results.frames.defaultColors;
    for (const [key, preset] of [...colorPresets.filter(([name]) => name !== 'original'), ['original', ATLAS_COLOR_PRESETS.original]]) {
      setControl('colorPreset', key);
      await waitForPausedPaint();
      const frame = capture();
      results.frames[`colorPreset_${key}`] = frame;
      results.checks[`${key}ColorPresetSynchronizesInputs`] = colorPreset.value === key && COLOR_IDS.every(id =>
        document.getElementById(id).value.toUpperCase() === preset.colors[id].toUpperCase());
      results.checks[`${key}ColorPresetRepaintsWhilePaused`] = paintedWhilePaused() && frame.hash !== previousPresetFrame.hash;
      colorsPaintedWhilePaused &&= paintedWhilePaused();
      previousPresetFrame = frame;
    }
    results.checks.originalColorPresetRestoresDefaultPixels = results.frames.colorPreset_original.hash === results.frames.defaultColors.hash;

    setControl('colorPrimary', '#40d9f2');
    await waitForPausedPaint();
    results.frames.primaryColor = capture();
    colorsPaintedWhilePaused &&= paintedWhilePaused();
    results.checks.manualColorEditSelectsCustom = colorPreset.value === 'custom';
    results.checks.primaryColorChangesTraces = changedRegions(results.frames.defaultColors, results.frames.primaryColor, ['analyzer', 'overview']);
    results.checks.primaryColorPreservesMeterAndSpectrogram = sameRegions(results.frames.defaultColors, results.frames.primaryColor, ['meters', 'spectrogram']);

    setControl('colorAccent', '#e94dc4');
    await waitForPausedPaint();
    results.frames.accentColor = capture();
    colorsPaintedWhilePaused &&= paintedWhilePaused();
    results.checks.accentColorChangesTraces = changedRegions(results.frames.primaryColor, results.frames.accentColor, ['scope', 'analyzer', 'overview']);
    results.checks.accentColorPreservesMeterAndSpectrogram = sameRegions(results.frames.primaryColor, results.frames.accentColor, ['meters', 'spectrogram']);

    setControl('colorText', '#8fe867');
    await waitForPausedPaint();
    results.frames.textColor = capture();
    colorsPaintedWhilePaused &&= paintedWhilePaused();
    results.checks.textColorChangesHeadings = changedRegions(results.frames.accentColor, results.frames.textColor, ['headings']);
    results.checks.textColorPreservesTracesAndSpectrogram = sameRegions(results.frames.accentColor, results.frames.textColor, ['scope', 'analyzer', 'overview', 'spectrogram']);

    setControl('colorGuides', '#6987f5');
    await waitForPausedPaint();
    results.frames.guideColor = capture();
    colorsPaintedWhilePaused &&= paintedWhilePaused();
    results.checks.guideColorChangesInstrumentGrids = changedRegions(results.frames.textColor, results.frames.guideColor, ['scope', 'analyzer', 'meters']);
    results.checks.guideColorPreservesWaveformAndSpectrogram = sameRegions(results.frames.textColor, results.frames.guideColor, ['overview', 'spectrogram']);

    // Change all stops together: an individual stop need not have visible audio
    // energy at this time, but the whole alternative palette must affect history.
    setControl('colorSpectrogramLow', '#053a24');
    setControl('colorSpectrogramMid', '#15d5c0');
    setControl('colorSpectrogramHigh', '#f95ac0');
    await waitForPausedPaint();
    results.frames.customColors = capture();
    colorsPaintedWhilePaused &&= paintedWhilePaused();
    results.checks.spectrogramColorsChangeHistory = changedRegions(results.frames.guideColor, results.frames.customColors, ['spectrogram']);
    results.checks.spectrogramColorsPreserveOtherPixels = results.frames.guideColor.outsideSpectrogramHash === results.frames.customColors.outsideSpectrogramHash
      && sameRegions(results.frames.guideColor, results.frames.customColors, ['scope', 'analyzer', 'meters', 'overview', 'headings']);
    results.checks.colorsUpdateWhilePaused = colorsPaintedWhilePaused;
    await api.renderAt(12);
    await api.renderAt(colorTime);
    results.frames.customColorsAfterSeek = capture();
    results.checks.customColorsDeterministicAfterSeek = results.frames.customColors.hash === results.frames.customColorsAfterSeek.hash;

    const resetColors = document.getElementById('resetColorsBtn');
    if (!resetColors || resetColors.disabled) throw new Error('The Reset colours control is unavailable.');
    resetColors.click();
    await waitForPausedPaint();
    results.frames.resetColors = capture();
    results.checks.resetColorsRestoresInputs = COLOR_IDS.every(id =>
      document.getElementById(id).value.toUpperCase() === ATLAS_COLOR_DEFAULTS[id].toUpperCase());
    results.checks.resetColorsSelectsOriginal = colorPreset.value === 'original';
    results.checks.resetColorsRestoresDefaultPixels = paintedWhilePaused() && results.frames.defaultColors.hash === results.frames.resetColors.hash;

    const canvas = document.querySelector('#stage canvas');
    const bounds = canvas.getBoundingClientRect();
    const rect = api.getState().scene.instruments.rects.analyzer;
    const beforeHover = capture();
    canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true,
      clientX: bounds.left + (rect.x + rect.w / 2) * bounds.width,
      clientY: bounds.top + (rect.y + rect.h / 2) * bounds.height }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const hover = document.getElementById('spectrumHover');
    const tooltip = hover?.querySelector('.spectrum-tooltip');
    results.checks.hoverShowsMeasuredValues = Boolean(hover && !hover.hidden && tooltip
      && /Hz/u.test(tooltip.textContent) && /dBFS/u.test(tooltip.textContent));
    results.checks.hoverExcludedFromCanvas = capture().hash === beforeHover.hash;
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    results.checks.hoverClearsOnLeave = Boolean(hover?.hidden);

    setControl('setlistInput', '00:00 First\n00:00 Duplicate\n00:75 Invalid seconds\n01:00 <b>Plain text title</b>');
    await api.renderAt(80);
    const invalid = api.getState();
    const status = document.getElementById('setlistStatus');
    results.checks.invalidRowsExplainProblems = invalid.setlist.entries.length === 2 && invalid.setlist.errors.length === 2
      && /2 rows ignored/u.test(status.textContent) && /Line 2: Duplicate/u.test(status.textContent) && /Line 3:/u.test(status.textContent);
    results.checks.titlesRemainPlaintext = invalid.setlist.entries[1].title === '<b>Plain text title</b>' && !status.querySelector('b');
    results.frames.invalidSetlist = capture();
    results.checks.bottomQuarterBlack = Object.values(results.frames).every(frame => frame.bottomQuarterNonBlackPixels === 0);
    results.checks.noGpuErrors = Object.values(results.frames).every(frame => frame.gpuError === 0);
  } catch (error) {
    results.error = error?.message || String(error);
  } finally {
    try {
      // Start from a valid full range, then restore custom bounds in an order
      // that cannot temporarily reverse the interval and trigger validation.
      setControl('rtaPreset', 'full');
      setControl('rtaMin', controls.rtaMin);
      setControl('rtaMax', controls.rtaMax);
      for (const id of CONTROL_IDS.filter(id => !['rtaMin', 'rtaMax'].includes(id))) setControl(id, controls[id]);
      await api.renderAt(savedTime);
      const restored = api.getState();
      results.restored = restored.position === savedTime && CONTROL_IDS.every(id => {
        const input = document.getElementById(id);
        return (input.type === 'checkbox' ? input.checked : input.value) === controls[id];
      });
      // Restoring the seven picker values must infer a named preset or Custom;
      // assigning the disabled Custom option itself would bypass that behavior.
      results.restored &&= colorPreset.value === savedColorPreset;
      if (initial.playing) await api.play();
      results.restored &&= api.getState().playing === initial.playing;
      if (document.body.classList.contains('clean') !== wasClean) document.getElementById('cleanBtn').click();
      results.restored &&= document.body.classList.contains('clean') === wasClean;
    } catch (error) { results.restorationError = error?.message || String(error); }
  }
  results.passed = !results.error && results.restored && Object.keys(results.checks).length > 0 && Object.values(results.checks).every(Boolean);
  results.durationSeconds = Math.round((performance.now() - started) / 10) / 100;
  return results;
}

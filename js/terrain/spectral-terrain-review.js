import { installSpectralReview } from './spectral-review.js';
import { makeAudioFixture } from '../audio-review-fixtures.js';

function canvasSnapshot() {
  const canvas = document.querySelector('#stage canvas');
  const gl = canvas.getContext('webgl2');
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let hash = 2166136261, visible = 0, max = 0;
  let minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1;
  for (let i = 0; i < data.length; i += 4) {
    const light = Math.max(data[i], data[i + 1], data[i + 2]);
    max = Math.max(max, light);
    if (light > 3) {
      visible++;
      const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    hash = Math.imul(hash ^ data[i], 16777619);
    hash = Math.imul(hash ^ data[i + 1], 16777619);
    hash = Math.imul(hash ^ data[i + 2], 16777619);
  }
  return { hash: (hash >>> 0).toString(16), visiblePixels: visible, max,
    bounds: { minX, maxX, minY, maxY }, width: canvas.width, height: canvas.height, gpuError: gl.getError() };
}

async function runFixtureChecks(api) {
  const result = { passed: false, fixtures: [] };
  try {
    await api.unload();
    const empty = canvasSnapshot();
    result.emptyCanvasBlack = empty.visiblePixels === 0;
    for (const kind of ['silence', 'mono', 'right-only', 'opposite-phase']) {
      await api.loadFile(makeAudioFixture(kind));
      await api.renderAt(.5);
      const first = canvasSnapshot(), state = api.getState();
      await api.renderAt(.1);
      await api.renderAt(.5);
      const repeated = canvasSnapshot();
      api.flushAnalysisCache();
      await api.renderAt(.5);
      const evicted = canvasSnapshot();
      await api.renderAt(state.duration);
      const boundary = api.getState();
      await api.unload();
      const unloaded = canvasSnapshot();
      const checks = {
        fullResolution: state.quality.fftSize === 32768 && state.quality.frequencyBins === 16384
          && state.quality.terrainColumns === 16384 && state.quality.terrainRidges === 120,
        deterministicSeek: first.hash === repeated.hash,
        deterministicCacheEviction: first.hash === evicted.hash,
        gpuHealthy: first.gpuError === 0 && repeated.gpuError === 0,
        hasTerrain: kind === 'silence' || first.visiblePixels > 0,
        boundaryClamped: boundary.position === boundary.duration,
        unloadCleared: unloaded.hash === empty.hash && unloaded.visiblePixels === 0,
      };
      result.fixtures.push({ kind, checks, passed: Object.values(checks).every(Boolean), canvas: first });
    }
    const mono = result.fixtures.find(f => f.kind === 'mono');
    const opposite = result.fixtures.find(f => f.kind === 'opposite-phase');
    // Compare audible structure across separately decoded mono/stereo files;
    // byte-identical hashes are required above for repeats of the same track.
    result.oppositePhasePreserved = Math.abs(mono.canvas.visiblePixels - opposite.canvas.visiblePixels)
      <= Math.max(1, mono.canvas.visiblePixels * .01)
      && Math.abs(mono.canvas.max - opposite.canvas.max) <= 4;
    result.passed = result.emptyCanvasBlack && result.oppositePhasePreserved && result.fixtures.every(f => f.passed);
  } finally {
    await api.loadReference();
    await api.renderAt(80);
    result.referenceRestored = api.getState().ready && api.getState().position === 80;
  }
  return result;
}

function setControl(id, value) {
  const element = document.getElementById(id);
  if (element.type === 'checkbox') element.checked = value;
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function runControlChecks(api) {
  await api.renderAt(80);
  const before = api.getState(), controls = before.settings;
  const checks = {}, views = {};
  try {
    checks.preview4K = before.viewport.canvasWidth >= 3840 && before.viewport.canvasHeight >= 2160;
    for (const view of ['oblique', 'front', 'side']) {
      api.setView(view);
      await api.renderAt(80);
      const snap = canvasSnapshot();
      views[view] = snap;
      checks[`${view}Visible`] = snap.visiblePixels > 1000;
      checks[`${view}Framed`] = snap.bounds.minX > 0 && snap.bounds.maxX < snap.width - 1
        && snap.bounds.minY > 0 && snap.bounds.maxY < snap.height - 1;
    }
    api.setView('oblique');
    await api.renderAt(80);
    const baseline = canvasSnapshot();
    const baselineCamera = api.getCameraState();
    setControl('terrainNear', '#eeaa55');
    setControl('terrainFar', '#814d23');
    await api.renderAt(80);
    checks.colourControls = canvasSnapshot().hash !== baseline.hash;
    setControl('terrainNear', controls.terrainNear);
    setControl('terrainFar', controls.terrainFar);
    setControl('height', 3);
    for (const view of ['oblique', 'front', 'side']) {
      api.setView(view);
      await api.renderAt(80);
      const snap = canvasSnapshot();
      checks[`${view}MaximumReliefFramed`] = snap.bounds.minX > 0 && snap.bounds.maxX < snap.width - 1
        && snap.bounds.minY > 0 && snap.bounds.maxY < snap.height - 1;
    }
    setControl('height', controls.height);
    api.setView('oblique');
    setControl('historySeconds', 12);
    await api.renderAt(80);
    const history12 = canvasSnapshot();
    const layout12 = api.getState().scene;
    setControl('historySeconds', 2);
    await api.renderAt(80);
    const layout2 = api.getState().scene;
    checks.historyControl = canvasSnapshot().hash !== history12.hash;
    checks.historyAddsRidges = layout12.ridges === 239 && layout2.ridges === 40;
    checks.historyExtendsLength = layout12.terrainDepth > layout2.terrainDepth;
    checks.historyPreservesCadence = layout12.ridgeTimeStep === layout2.ridgeTimeStep;
    checks.historyPreservesSpacing = layout12.ridgeDepthStep === layout2.ridgeDepthStep;
    setControl('historySeconds', controls.historySeconds);
    api.setCameraState(baselineCamera);
    setControl('ridgeSpacing', 2);
    await api.renderAt(80);
    const spaced = api.getState().scene;
    checks.spacingChangesGeometry = spaced.ridgeDepthStep === layout12.ridgeDepthStep * 2;
    checks.spacingPreservesHistory = spaced.ridges === before.scene.ridges && spaced.ridgeTimeStep === before.scene.ridgeTimeStep;
    setControl('ridgeSpacing', controls.ridgeSpacing);
    api.setCameraState(baselineCamera);
    setControl('frequencySpread', 1);
    await api.renderAt(80);
    const originalSpread = canvasSnapshot();
    const originalWidth = api.getState().scene.terrainWidth;
    setControl('frequencySpread', 1.8);
    await api.renderAt(80);
    const widerSpectrum = api.getState().scene;
    checks.frequencySpreadChangesGeometry = canvasSnapshot().hash !== originalSpread.hash && widerSpectrum.frequencySpread === 1.8;
    checks.frequencySpreadKeepsDetail = widerSpectrum.columns === before.scene.columns
      && widerSpectrum.ridges === before.scene.ridges && widerSpectrum.ridgeDepthStep === before.scene.ridgeDepthStep;
    checks.frequencySpreadExtendsWidth = widerSpectrum.terrainWidth > originalWidth;
    setControl('frequencySpread', controls.frequencySpread);
    api.setCameraState(baselineCamera);
    setControl('lineWidth', 2);
    await api.renderAt(80);
    checks.strokeControl = canvasSnapshot().hash !== baseline.hash;
    setControl('lineWidth', controls.lineWidth);
    setControl('gain', .5);
    await api.renderAt(80);
    checks.intensityControl = canvasSnapshot().hash !== baseline.hash;
    setControl('gain', controls.gain);
    setControl('energyHue', true);
    await api.renderAt(80);
    checks.hueControl = canvasSnapshot().hash !== baseline.hash;
    setControl('energyHue', controls.energyHue);
    await api.renderAt(80);
    document.getElementById('muteBtn').click();
    await api.renderAt(80);
    checks.muteIndependent = canvasSnapshot().hash === baseline.hash;
    document.getElementById('muteBtn').click();
    await api.renderAt(80);
    api.flushAnalysisCache();
    await api.renderAt(10);
    await api.renderAt(80);
    checks.longSeekDeterministic = canvasSnapshot().hash === baseline.hash;
    checks.cacheBounded = api.getState().analysis.cachedFrames <= 1500;
  } finally {
    for (const [id, value] of Object.entries(controls)) if (document.getElementById(id)) setControl(id, value);
    api.setCameraState(before.camera);
    await api.renderAt(before.position);
  }
  return { passed: Object.values(checks).every(Boolean), checks, views, state: api.getState() };
}

installSpectralReview({
  getApi: () => window.spectralTerrain, slug: 'spectral-terrain', reservedBottomQuarter: false,
  runFixtureChecks, runMixControlChecks: runControlChecks,
  inspectCanvas: api => ({ ...api.getState(), canvas: canvasSnapshot() }),
});

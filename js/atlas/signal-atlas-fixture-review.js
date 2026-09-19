// Opt-in browser checks using actual WAV decoding, worker analysis and GPU draws.
// Importing this module has no side effects; the review button runs the checks.

import { makeAudioFixture as makeFixture } from '../audio-review-fixtures.js';

function readCanvas(api) {
  const canvas = document.querySelector('#stage canvas');
  const gl = canvas?.getContext('webgl2');
  if (!gl) throw new Error('The production WebGL2 canvas is unavailable');
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const gpuError = gl.getError();
  const bottomBytes = canvas.width * Math.floor(canvas.height * 0.25) * 4;
  let hash = 2166136261, bottomQuarterNonBlackPixels = 0, upperNonBlackPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const nonBlack = pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0;
    if (i < bottomBytes) bottomQuarterNonBlackPixels += Number(nonBlack);
    else upperNonBlackPixels += Number(nonBlack);
    for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ pixels[i + channel], 16777619);
  }
  // Crop the production stereo-meter panel, including a small antialias margin.
  // Its empty reference includes static grid/ticks, so bars cannot hide behind
  // the presence of labels or a non-black background.
  const rect = api.getState().scene.instruments.rects.meters;
  const left = Math.max(0, Math.floor(canvas.width * rect.x));
  const right = Math.min(canvas.width, Math.ceil(canvas.width * (rect.x + rect.w)));
  const bottom = Math.max(0, Math.floor(canvas.height * (1 - rect.y - rect.h)));
  const top = Math.min(canvas.height, Math.ceil(canvas.height * (1 - rect.y)));
  let meterHash = 2166136261;
  for (let y = bottom; y < top; y++) {
    for (let x = left; x < right; x++) {
      const index = (y * canvas.width + x) * 4;
      for (let channel = 0; channel < 4; channel++) meterHash = Math.imul(meterHash ^ pixels[index + channel], 16777619);
    }
  }
  return { width: canvas.width, height: canvas.height, hash: (hash >>> 0).toString(16).padStart(8, '0'),
    meterHash: (meterHash >>> 0).toString(16).padStart(8, '0'), bottomQuarterNonBlackPixels, upperNonBlackPixels, gpuError };
}

function progressPercent() {
  const seek = document.getElementById('seek');
  if (!seek) return null;
  return Number(seek.value) / Number(seek.max) * 100;
}

/** Runs only when explicitly called from the review UI. Restores the real
 * reference track paused at zero, even when an individual fixture fails. */
export async function runFixtureChecks(api) {
  const started = performance.now();
  const results = { passed: false, fixtures: [], referenceRestored: false };
  try {
    // Rendering silence first makes this an empty baseline even if a regression
    // leaves the preceding reference track's meters frozen during unload.
    const baselineLoaded = await api.loadFile(makeFixture('silence'));
    if (baselineLoaded === false) throw new Error('The app was busy before the fixture checks');
    await api.renderAt(0.5);
    await api.unload();
    const emptyState = api.getState();
    const emptyCanvas = readCanvas(api);
    results.emptyBaseline = emptyCanvas;
    for (const kind of ['mono', 'right-only', 'opposite-phase', 'silence']) {
      const result = { fixture: kind, checks: {}, passed: false };
      results.fixtures.push(result);
      try {
        const loaded = await api.loadFile(makeFixture(kind));
        if (loaded === false) throw new Error('The app could not load this fixture while busy');
        const initial = api.getState();
        result.checks.decodedActualWav = initial.ready && Math.abs(initial.duration - 0.72) < 0.001;
        result.checks.loadStartsStoppedAtZero = !initial.playing && !initial.finished && !initial.busy
          && initial.position === 0 && initial.uploadedFrame === 0;
        result.checks.fullResolutionAnalysis = initial.analysis.fftSize === 32768
          && initial.analysis.frequencyBinCount === 16384 && initial.analysis.spectrumBits === 16;
        result.checks.boundedCache = initial.analysis.cacheCapacity <= 1500;

        await api.renderAt(0.5);
        const first = readCanvas(api);
        const stateAtHalf = api.getState();
        const instruments = stateAtHalf.scene.instruments;
        const expectedCorrelation = { mono: 1, 'right-only': 0, 'opposite-phase': -1, silence: 0 }[kind];
        result.checks.phaseMatchesSignal = Number.isFinite(instruments.correlation)
          && Math.abs(instruments.correlation - expectedCorrelation) < .001;
        const silentMeter = meter => meter.sampleDb === -Infinity && meter.heldDb === -Infinity;
        const toneMeter = meter => Math.abs(meter.sampleDb - 20 * Math.log10(19660 / 32768)) < .15
          && meter.heldDb >= meter.sampleDb - .001;
        result.checks.peakMeterMatchesSignal = kind === 'silence'
          ? silentMeter(instruments.meters.left) && silentMeter(instruments.meters.right)
          : kind === 'right-only' ? silentMeter(instruments.meters.left) && toneMeter(instruments.meters.right)
            : toneMeter(instruments.meters.left) && toneMeter(instruments.meters.right);
        result.instruments = instruments;
        result.checks.pausedExactFrame = !stateAtHalf.playing && !stateAtHalf.busy && stateAtHalf.position === 0.5;
        result.checks.drawsVisibleContent = first.upperNonBlackPixels > 100;
        await api.renderAt(0.5);
        const repeated = readCanvas(api);
        await api.renderAt(0.12);
        await api.renderAt(0.5);
        const afterSeek = readCanvas(api);
        const sameSize = frame => frame.width === first.width && frame.height === first.height;
        result.checks.identicalRepeatedFrame = sameSize(repeated) && first.hash === repeated.hash;
        result.checks.identicalAfterSeek = sameSize(afterSeek) && first.hash === afterSeek.hash;
        result.checks.bottomQuarterBlack = [first, repeated, afterSeek].every(frame => frame.bottomQuarterNonBlackPixels === 0);
        result.checks.noGpuErrors = [first, repeated, afterSeek].every(frame => frame.gpuError === 0);
        result.canvas = first;

        if (kind === 'mono') {
          await api.renderAt(0.60);
          const startedPlayback = await api.play();
          const completionStarted = performance.now();
          let completedNaturally = false;
          // The opt-in test waits for the real AudioBufferSourceNode completion
          // callback. A seek to duration would not exercise that production path.
          while (performance.now() - completionStarted < 2000) {
            const current = api.getState();
            if (current.finished && !current.playing && !current.busy
              && current.position === current.duration && progressPercent() === 100) {
              completedNaturally = true;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          result.checks.naturalPlaybackCompletion = startedPlayback !== false && completedNaturally;
          await new Promise(resolve => setTimeout(resolve, 160));
          const stableEnd = api.getState();
          result.checks.naturalEndRemainsComplete = completedNaturally && stableEnd.finished
            && !stableEnd.playing && stableEnd.position === stableEnd.duration && progressPercent() === 100;
          result.naturalCompletionMilliseconds = Math.round(performance.now() - completionStarted);
          if (!completedNaturally) await api.pause();
        }

        await api.renderAt(initial.duration);
        const ended = api.getState();
        result.endProgressPercent = progressPercent();
        result.checks.completeAtTrackEnd = ended.finished && !ended.playing && !ended.busy && ended.position === ended.duration
          && result.endProgressPercent === 100;
        result.checks.endBottomQuarterBlack = readCanvas(api).bottomQuarterNonBlackPixels === 0;
        await api.renderAt(0);
        const replay = api.getState();
        result.checks.replayFromZero = replay.ready && !replay.playing && !replay.busy && replay.position === 0 && !replay.finished
          && progressPercent() === 0;

        // Replace a loaded nonzero frame, then unload directly from another
        // nonzero frame. Seeking to zero immediately before unload would mask
        // stale meter, hold-marker, or stereo-scope geometry.
        await api.renderAt(0.5);
        const replacementLoaded = await api.loadFile(makeFixture(kind));
        const replacement = api.getState();
        result.checks.replacementStartsAtZero = replacementLoaded !== false && replacement.ready
          && replacement.position === 0 && replacement.uploadedFrame === 0 && !replacement.finished
          && !replacement.playing && !replacement.busy && replacement.fileName === initial.fileName;
        await api.renderAt(0.5);
        const unloadWhilePlaying = kind === 'opposite-phase' || kind === 'silence';
        await api.play();
        if (!unloadWhilePlaying) {
          await api.pause();
          await api.renderAt(0.5);
        }
        const beforeUnload = api.getState();
        result.unloadFrom = unloadWhilePlaying ? 'playing' : 'paused';
        result.checks.unloadsDirectlyFromNonzero = beforeUnload.ready && beforeUnload.position >= 0.5
          && beforeUnload.position < beforeUnload.duration && !beforeUnload.finished && !beforeUnload.busy
          && (unloadWhilePlaying ? beforeUnload.playing : beforeUnload.paused && !beforeUnload.playing);
        await api.unload();
        const unloaded = api.getState();
        const unloadedCanvas = readCanvas(api);
        const baselineSizeMatches = unloadedCanvas.width === emptyCanvas.width && unloadedCanvas.height === emptyCanvas.height;
        const emptyLabelsMatch = unloaded.scene.labelState?.hasAudio === false && emptyState.scene.labelState?.hasAudio === false
          && ['elapsedText', 'remainingText', 'markerCount'].every(key => unloaded.scene.labelState?.[key] === emptyState.scene.labelState?.[key]);
        result.checks.unloadClearsTrack = !unloaded.ready && !unloaded.playing && !unloaded.paused && !unloaded.finished
          && !unloaded.busy && unloaded.position === 0 && unloaded.duration === 0 && unloaded.uploadedFrame === -1;
        result.checks.unloadedMeterMatchesEmpty = baselineSizeMatches && unloadedCanvas.meterHash === emptyCanvas.meterHash;
        result.checks.unloadedCanvasMatchesEmpty = baselineSizeMatches && emptyLabelsMatch && unloadedCanvas.hash === emptyCanvas.hash;
        result.checks.unloadBottomQuarterBlack = unloadedCanvas.bottomQuarterNonBlackPixels === 0;
        result.unloadedCanvas = unloadedCanvas;
        result.passed = Object.values(result.checks).every(Boolean);
      } catch (error) {
        result.error = error?.message || String(error);
      }
    }
  } catch (error) {
    results.error = error?.message || String(error);
  } finally {
    try {
      const loaded = await api.loadReference();
      if (loaded === false) throw new Error('Could not restore the reference while the app was busy');
      await api.pause();
      await api.renderAt(0);
      const restored = api.getState();
      results.referenceRestored = restored.ready && !restored.playing && restored.position === 0
        && restored.fileName === 'reference.mp3';
      results.referenceState = { fileName: restored.fileName, playing: restored.playing, position: restored.position };
    } catch (error) {
      results.restorationError = error?.message || String(error);
    }
  }
  results.passed = results.fixtures.length === 4 && results.fixtures.every(result => result.passed) && results.referenceRestored;
  results.durationSeconds = Math.round((performance.now() - started) / 10) / 100;
  return results;
}

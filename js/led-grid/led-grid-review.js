// Opt-in, local review controls. Every operation uses the public renderer and
// exporter; the evidence buttons are also usable without console evaluation.
if (new URLSearchParams(location.search).has('review')) {
  const modes = ['loom', 'calligraphy', 'choreography'];
  const modeNames = { loom: 'Spectral Loom', calligraphy: 'Waveform Calligraphy', choreography: 'Graphic Choreography' };
  const views = ['front', 'left', 'right'];
  const passageIds = ['quiet', 'dense', 'change'];
  const evidenceFrameCount = modes.length * passageIds.length * views.length;
  const tools = document.getElementById('reviewTools') || document.body.appendChild(document.createElement('aside'));
  tools.id = 'reviewTools';
  tools.hidden = false;
  tools.innerHTML = `<div class="section-title">Independent visual review</div>
    <button id="reviewReferenceBtn" class="action glass">Review: load reference track</button>
    <label>Exact track time <input id="reviewTime" type="number" min="0" step="0.016666667" value="0" aria-label="Review exact track time"></label>
    <label>Mode <select id="reviewMode" aria-label="Review mode">${modes.map(mode => `<option value="${mode}">${modeNames[mode]}</option>`).join('')}</select></label>
    <label>Passage <select id="reviewPassage" aria-label="Review passage"><option value="quiet">Quiet</option><option value="dense">Dense</option><option value="change">Changing energy</option></select></label>
    <label>View <select id="reviewView" aria-label="Review camera view"><option value="front">Front</option><option value="left">Left oblique</option><option value="right">Right oblique</option></select></label>
    <button id="reviewRenderBtn" class="action glass">Review: exact frame</button>
    <button id="reviewPassageBtn" class="action glass">Review: render selected passage</button>
    <button id="reviewPlayPassageBtn" class="action glass">Review: play eight-second passage</button>
    <button id="reviewMotionBtn" class="action glass">Review: toggle camera motion</button>
    <button id="reviewChecksBtn" class="action glass">Review: inspect quality</button>
    <button id="reviewSuiteBtn" class="action glass">Review: technical suite</button>
    <button id="reviewCancelBtn" class="action glass">Review: export cancellation</button>
    <button id="reviewRecordBtn" class="action glass">Review: recording restoration</button>
    <button id="reviewRecordFailureBtn" class="action glass">Review: recording failure recovery</button>
    <button id="reviewLoadCancelBtn" class="action glass">Review: load cancellation</button>
    <p style="font-size:11px;line-height:1.5">Load cancellation unloads the current track, cancels reference analysis, then reloads the reference paused at zero to verify recovery.</p>
    <label>Clip duration <input id="reviewClipDuration" type="number" min="0.5" max="30" step="0.5" value="2" aria-label="Review clip duration"></label>
    <button id="reviewClipBtn" class="action glass">Review: export encoded clip</button>
    <button id="reviewCaptureBtn" class="action glass">Review: download native frame</button>
    <button id="reviewNativeDetailBtn" class="action glass">Review: native LED detail crop</button>
    <button id="reviewSequenceBtn" class="action glass">Review: start ${evidenceFrameCount}-frame evidence sequence</button>
    <button id="reviewManifestBtn" class="action glass">Review: download evidence manifest</button>
    <p style="font-size:11px;line-height:1.5">H hides or restores the review toolbar in clean view. Capture each frame independently. Numeric audio fixtures run separately; this suite checks the live renderer and exporter.</p>
    <pre id="reviewStatus" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;color:#c5c1dc"></pre>`;
  const style = document.createElement('style');
  style.textContent = `#reviewTools label{display:grid;grid-template-columns:1fr 1.3fr;gap:8px;align-items:center;margin:9px 0;font-size:11px}#reviewTools input,#reviewTools select{min-width:0;width:100%;padding:6px;background:#15151b;color:#eae7fb;border:1px solid #383441;border-radius:4px}#reviewTools button{margin:3px 0}#ledReviewToolbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2001;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;max-width:95vw;padding:8px 10px;border:1px solid #554b6d;border-radius:9px;background:rgba(13,12,20,.94);color:#eae7fb;font:11px system-ui;box-shadow:0 4px 30px #0008}#ledReviewToolbar[hidden]{display:none}#ledReviewToolbar button{font:inherit;color:inherit;background:#272030;border:1px solid #494050;border-radius:4px;padding:6px 9px;cursor:pointer}#ledReviewToolbar button:disabled{opacity:.4;cursor:wait}#reviewOutput{position:fixed;inset:4vh 3vw;z-index:3000;overflow:auto;background:#0d0c13;border:1px solid #4d425b;border-radius:10px;padding:18px;color:#eae7fb;font:12px system-ui}#reviewOutput[hidden]{display:none}#reviewOutput video{display:block;max-width:100%;max-height:70vh;margin:12px auto;background:#000}#reviewOutput button,#reviewOutput a{display:inline-block;margin:5px 10px 5px 0;color:#f2eafa}#reviewOutput button{background:#282130;padding:8px;border:1px solid #665375;border-radius:5px}#reviewOutput pre{white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.appendChild(style);
  const toolbar = document.body.appendChild(document.createElement('aside'));
  toolbar.id = 'ledReviewToolbar';
  toolbar.hidden = true;
  toolbar.setAttribute('aria-label', 'Clean evidence controls');
  toolbar.innerHTML = `<span id="reviewShotCaption"></span><button id="reviewPreviousShot">Previous evidence frame</button><button id="reviewNextShot">Next evidence frame</button><button id="reviewCleanPlay">Play this passage</button><button id="reviewCleanPause">Pause exact frame</button><button id="reviewHideToolbar">Hide toolbar for screenshot (H)</button><button id="reviewShowControls">Show application controls</button>`;
  const output = document.getElementById('reviewOutput') || document.body.appendChild(document.createElement('aside'));
  output.id = 'reviewOutput';
  output.hidden = true;
  const $ = id => document.getElementById(id);
  const api = () => {
    if (!window.ledGrid) throw new Error('The LED Grid review interface is not ready.');
    return window.ledGrid;
  };
  const state = () => api().getState();
  const evidence = [];
  let shotIndex = -1, busy = false, videoURL, playStopTimer, lastVideoStart = 0;
  let frozenPassages;
  const report = value => { $('reviewStatus').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
  function setBusy(value) {
    busy = value;
    tools.querySelectorAll('button').forEach(button => { button.disabled = value; });
    toolbar.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    report('Working…');
    try { await action(); }
    catch (error) { report({ passed: false, error: error.message, stack: error.stack }); console.error(error); }
    finally { setBusy(false); }
  }
  function clearPassagePlayback() { clearTimeout(playStopTimer); playStopTimer = undefined; }
  async function stop() { clearPassagePlayback(); await api().pause(); }
  function trackTime() { return Math.max(0, Number($('reviewTime').value) || 0); }
  function setTrackTime(time) {
    $('reviewTime').value = String(time);
    if ($('seekSeconds')) $('seekSeconds').value = String(time);
  }
  function passages() {
    if (frozenPassages) return frozenPassages;
    const raw = api().getPassages();
    const find = id => Array.isArray(raw) ? raw.find(item => (item.id || item.kind || item.name) === id) : raw?.[id];
    const normalized = passageIds.map(id => {
      const value = find(id);
      const start = typeof value === 'number' ? value : value?.start ?? value?.time;
      if (!Number.isFinite(start)) throw new Error(`No ${id} reference passage has been selected. Load the reference track first.`);
      return { id, start, duration: value?.duration ?? 8 };
    });
    frozenPassages = normalized;
    return normalized;
  }
  function selectedPassage() { return passages().find(passage => passage.id === $('reviewPassage').value); }
  function selectShot(index) {
    const normalized = ((index % evidenceFrameCount) + evidenceFrameCount) % evidenceFrameCount;
    return { index: normalized, mode: modes[Math.floor(normalized / (passageIds.length * views.length))],
      passage: passages()[Math.floor(normalized / views.length) % passageIds.length], view: views[normalized % views.length] };
  }
  async function renderSelection(time = trackTime()) {
    await stop();
    await api().setMode($('reviewMode').value);
    await api().setView($('reviewView').value);
    await api().renderAt(time);
    setTrackTime(time);
  }
  function pixelStats() {
    const canvas = document.querySelector('#stage canvas');
    if (!canvas) throw new Error('No stage canvas exists.');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) throw new Error('The stage has no accessible WebGL context.');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const gpuError = gl.getError();
    if (gpuError !== gl.NO_ERROR) throw new Error(`Reading the stage failed with WebGL error ${gpuError}.`);
    let hash = 2166136261, lit = 0, clipped = 0, sum = 0, max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const peak = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (peak > 10) lit++;
      if (pixels[i] >= 254 && pixels[i + 1] >= 254 && pixels[i + 2] >= 254) clipped++;
      sum += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      max = Math.max(max, peak);
      // Include every RGB channel; alpha is constant for this opaque surface.
      hash = Math.imul(hash ^ pixels[i], 16777619);
      hash = Math.imul(hash ^ pixels[i + 1], 16777619);
      hash = Math.imul(hash ^ pixels[i + 2], 16777619);
    }
    const count = pixels.length / 4;
    return { hash: (hash >>> 0).toString(16).padStart(8, '0'), width: canvas.width, height: canvas.height, pixels: count,
      litFraction: lit / count, clippedWhiteFraction: clipped / count, meanLuminance: sum / count, maximumChannel: max,
      gpuError, renderer: gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() };
  }
  async function showShot(index) {
    const shot = selectShot(index);
    shotIndex = shot.index;
    $('reviewMode').value = shot.mode;
    $('reviewPassage').value = shot.passage.id;
    $('reviewView').value = shot.view;
    // All critics use the centre frame of each frozen eight-second passage.
    const time = shot.passage.start + shot.passage.duration / 2;
    await renderSelection(time);
    document.body.classList.add('clean');
    toolbar.hidden = false;
    const data = { number: shot.index + 1, mode: shot.mode, passage: shot.passage, view: shot.view, time, quality: pixelStats(), state: state() };
    evidence[shot.index] = data;
    $('reviewShotCaption').textContent = `${shot.index + 1}/${evidenceFrameCount} · ${modeNames[shot.mode]} · ${shot.passage.id} · ${shot.view} · ${time.toFixed(3)} s`;
    report(data);
  }
  async function playPassage() {
    const passage = selectedPassage();
    await renderSelection(passage.start);
    await api().play();
    const started = performance.now();
    let frames = 0, previous = started, maxGap = 0;
    function countFrames(now) {
      if (!playStopTimer) return;
      frames++;
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
      requestAnimationFrame(countFrames);
    }
    playStopTimer = setTimeout(async () => {
      clearPassagePlayback();
      await api().pause();
      setTrackTime(state().position);
      const elapsed = (performance.now() - started) / 1000;
      report({ passage, mode: state().mode, elapsedSeconds: elapsed, browserAnimationFrames: frames,
        browserFramesPerSecond: frames / elapsed, maximumAnimationFrameGapMs: maxGap,
        note: 'Browser animation cadence measures responsiveness; renderer timing is reported in scene telemetry.', state: state() });
    }, passage.duration * 1000);
    requestAnimationFrame(countFrames);
    report({ playing: true, passage, mode: state().mode, settings: state().settings });
  }
  function download(url, name) {
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
  }
  function memoryWritable() {
    const chunks = [];
    let cursor = 0, total = 0, closed = false, aborted = false;
    return {
      writable: {
        async write(value) {
          const raw = value.data ?? value;
          const data = raw instanceof Blob ? new Uint8Array(await raw.arrayBuffer()) :
            raw instanceof ArrayBuffer ? new Uint8Array(raw).slice() : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice();
          const position = value.position ?? cursor;
          chunks.push({ position, data }); cursor = position + data.byteLength; total = Math.max(total, cursor);
        },
        async close() { closed = true; },
        async abort() { aborted = true; chunks.length = 0; },
      },
      result() {
        const bytes = new Uint8Array(aborted ? 0 : total);
        if (!aborted) for (const chunk of chunks) bytes.set(chunk.data, chunk.position);
        return { bytes, closed, aborted };
      },
    };
  }
  function restoration(before, after) {
    const canvasDimensions = value => [value?.canvasWidth ?? value?.width, value?.canvasHeight ?? value?.height];
    return { positionRestored: Math.abs(after.position - before.position) < 1 / 120,
      modeRestored: after.mode === before.mode,
      settingsRestored: JSON.stringify(after.settings) === JSON.stringify(before.settings),
      cameraRestored: JSON.stringify(after.scene?.camera) === JSON.stringify(before.scene?.camera),
      viewportRestored: JSON.stringify(canvasDimensions(after.viewport)) === JSON.stringify(canvasDimensions(before.viewport)),
      unlocked: !after.busy && !after.exporting, remainedPaused: !after.playing };
  }
  async function cancellationCheck() {
    await stop();
    const before = state();
    const sink = memoryWritable();
    const timer = setTimeout(() => {
      if (typeof api().cancelExport === 'function') api().cancelExport();
      else $('exportCancelBtn')?.click();
    }, 250);
    let result;
    try { result = await api().exportClip({ start: before.position, duration: 10, writable: sink.writable }); }
    finally { clearTimeout(timer); }
    const saved = sink.result();
    const checks = { cancelled: result?.reason === 'cancelled' || result?.cancelled === true,
      partialFileAborted: saved.aborted && !saved.closed, ...restoration(before, state()) };
    return { passed: Object.values(checks).every(Boolean), checks, result };
  }
  async function determinismCheck() {
    await stop();
    const before = state();
    const samples = [];
    try {
      await api().setView('front');
      for (const mode of modes) {
        await api().setMode(mode);
        for (const passage of passages()) {
          const time = passage.start + 4;
          await api().renderAt(time); const first = pixelStats();
          await api().renderAt(time); const repeat = pixelStats();
          await api().renderAt(Math.max(0, time - 1.25));
          await api().renderAt(time); const seek = pixelStats();
          samples.push({ mode, passage: passage.id, time, first: first.hash, repeat: repeat.hash, afterSeek: seek.hash,
            passed: first.hash === repeat.hash && first.hash === seek.hash, litFraction: first.litFraction });
        }
      }
    } finally {
      await api().setMode(before.mode);
      await api().setSettings(before.settings);
      await api().setView(before.scene?.view || before.view || before.settings?.view || $('reviewView').value);
      await api().renderAt(before.position);
    }
    return { passed: samples.length === modes.length * passageIds.length && samples.every(sample => sample.passed), samples };
  }
  async function resizeCheck() {
    const before = state();
    const samples = [];
    try {
      for (const [width, height, ratio] of [[1920, 1080, 2], [1280, 720, 1]]) {
        await api().setViewport(width, height, ratio);
        await api().renderAt(before.position);
        const quality = pixelStats();
        samples.push({ requested: { width, height, pixelRatio: ratio }, quality,
          passed: quality.width >= 3840 && quality.height >= 2160 && Math.abs(quality.width / quality.height - 16 / 9) < .002 });
      }
    } finally { await api().restorePreview(); await api().renderAt(before.position); }
    return { passed: samples.every(sample => sample.passed), samples };
  }
  async function recordingCheck() {
    if (typeof api().recordClip !== 'function') return { passed: false, unavailable: 'recordClip is not exposed.' };
    await stop();
    const before = state(), sink = memoryWritable();
    await api().recordClip({ duration: 1, writable: sink.writable });
    const saved = sink.result();
    const checks = { wroteVideo: saved.bytes.length > 1000, closed: saved.closed, stopped: !state().recording,
      ...restoration(before, state()) };
    return { passed: Object.values(checks).every(Boolean), bytes: saved.bytes.length, checks };
  }
  async function recordingFailureCheck() {
    if (typeof api().recordClip !== 'function') return { passed: false, unavailable: 'recordClip is not exposed.' };
    await stop();
    const before = state();
    const expectedMessage = 'Expected review recording write failure';
    let writeAttempts = 0, abortCalls = 0, closeCalls = 0, caught;
    try {
      await api().recordClip({ duration: 1, writable: {
        async write() { writeAttempts++; throw new Error(expectedMessage); },
        async close() { closeCalls++; },
        async abort() { abortCalls++; },
      } });
    } catch (error) { caught = error; }
    const after = state();
    const checks = { writeAttempted: writeAttempts > 0, expectedErrorCaught: caught?.message === expectedMessage,
      sinkAborted: abortCalls === 1, sinkNotClosed: closeCalls === 0, stopped: !after.recording,
      ...restoration(before, after) };
    return { passed: Object.values(checks).every(Boolean), checks, writeAttempts, abortCalls, closeCalls,
      expectedError: expectedMessage, caughtError: caught?.message ?? null, state: after };
  }
  async function loadCancellationCheck() {
    if (typeof api().cancelLoad !== 'function') return { passed: false, unavailable: 'cancelLoad is not exposed.' };
    await stop();
    const before = state();
    const started = performance.now();
    let settled = false, cancelledWhileLoading = false, statusAtCancel = '', observationTimedOut = false;
    // Capture a rejected operation immediately to avoid an unhandled rejection
    // while the independent polling loop waits for the worker's analysis phase.
    const operation = api().loadReference({ autoplay: false }).then(
      result => { settled = true; return { result }; },
      error => { settled = true; return { error: error.message }; },
    );
    while (!settled) {
      const current = state();
      const status = $('statusText')?.textContent || '';
      // 'loading' also includes decode. The production status confirms the
      // analysis worker has started, so this never cancels just the fetch.
      if (current.busy === 'loading' && status.startsWith('Preparing first second')) {
        cancelledWhileLoading = true; statusAtCancel = status; api().cancelLoad(); break;
      }
      if (performance.now() - started > 30000) {
        observationTimedOut = true; api().cancelLoad(); break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const cancelled = await operation;
    const afterCancel = state();
    frozenPassages = undefined;
    const cancellationChecks = { cancelledDuringAnalysis: cancelledWhileLoading, operationReturnedFalse: cancelled.result === false,
      noOperationError: !cancelled.error, unlocked: !afterCancel.busy && !afterCancel.recording && !afterCancel.exporting,
      noAnalysisFrames: afterCancel.analysis.frames === 0 && !afterCancel.analysis.loaded,
      paused: !afterCancel.playing,
      noNewErrors: JSON.stringify(afterCancel.errors) === JSON.stringify(before.errors) };
    // Recover by actually loading again, rather than merely checking that the
    // load button has become enabled. This intentionally leaves the reference.
    let reloaded, reloadError;
    try { reloaded = await api().loadReference({ autoplay: false }); }
    catch (error) { reloadError = error.message; }
    const afterReload = state();
    const recoveryChecks = { loadSucceeded: reloaded === true, noOperationError: !reloadError,
      analysisReady: afterReload.analysis.frames > 0 && afterReload.analysis.loaded,
      unlocked: !afterReload.busy, pausedAtStart: !afterReload.playing && afterReload.position === 0,
      noNewErrors: JSON.stringify(afterReload.errors) === JSON.stringify(before.errors) };
    if (recoveryChecks.analysisReady) passages();
    setTrackTime(afterReload.position);
    return { passed: Object.values(cancellationChecks).every(Boolean) && Object.values(recoveryChecks).every(Boolean),
      cancellationChecks, recoveryChecks, statusAtCancel, observationTimedOut, cancellationResult: cancelled,
      reloadError: reloadError ?? null, cancelledState: afterCancel, reloadedState: afterReload,
      note: 'The current track was unloaded; the reference has been reloaded paused at zero.' };
  }
  function nativeFrame(video) {
    video.pause();
    const frame = document.createElement('canvas');
    frame.width = video.videoWidth; frame.height = video.videoHeight;
    frame.getContext('2d').drawImage(video, 0, 0);
    const overlay = document.body.appendChild(document.createElement('button'));
    overlay.setAttribute('aria-label', 'Close native encoded frame');
    overlay.style.cssText = `position:fixed;left:0;top:0;z-index:20000;padding:0;margin:0;border:0;background:#000;width:${frame.width}px;height:${frame.height}px;cursor:zoom-out`;
    frame.style.cssText = `display:block;width:${frame.width}px;height:${frame.height}px;max-width:none`;
    overlay.appendChild(frame);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', key, true); };
    const key = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); } };
    overlay.onclick = close;
    document.addEventListener('keydown', key, true);
  }
  function nativeDetail() {
    const source = document.querySelector('#stage canvas');
    const crop = document.createElement('canvas');
    crop.width = Math.min(960, source.width); crop.height = Math.min(540, source.height);
    const x = Math.floor((source.width - crop.width) / 2), y = Math.floor((source.height - crop.height) / 2);
    crop.getContext('2d').drawImage(source, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const overlay = document.body.appendChild(document.createElement('button'));
    overlay.setAttribute('aria-label', 'Close native LED detail crop');
    overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:20000;padding:0;margin:0;border:0;background:#000;cursor:zoom-out';
    crop.style.cssText = `display:block;width:${crop.width}px;height:${crop.height}px;max-width:none;flex-shrink:0`;
    overlay.appendChild(crop);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', key, true); };
    const key = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); } };
    overlay.onclick = close;
    document.addEventListener('keydown', key, true);
    report({ nativeDetail: { x, y, width: crop.width, height: crop.height, scale: 'one source pixel per CSS pixel' }, state: state() });
  }
  async function compareEncodedFrame(video) {
    const sample = document.createElement('canvas');
    sample.width = video.videoWidth; sample.height = video.videoHeight;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0);
    const encoded = context.getImageData(0, 0, sample.width, sample.height).data;
    const time = lastVideoStart + video.currentTime;
    await api().renderAt(time);
    context.drawImage(document.querySelector('#stage canvas'), 0, 0, sample.width, sample.height);
    const preview = context.getImageData(0, 0, sample.width, sample.height).data;
    let difference = 0;
    for (let i = 0; i < encoded.length; i += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(encoded[i + channel] - preview[i + channel]);
    return { exactTrackTime: time, meanAbsoluteRGBDifference: difference / (encoded.length / 4 * 3),
      note: '0–255 RGB comparison; H.264 is lossy and exported frames use 4K supersampling.' };
  }
  async function exportClip() {
    await stop();
    const before = state(), sink = memoryWritable();
    const start = trackTime(), duration = Math.min(30, Math.max(.5, Number($('reviewClipDuration').value) || 2));
    let peakWidth = 0, peakHeight = 0;
    const timer = setInterval(() => { const canvas = document.querySelector('#stage canvas'); peakWidth = Math.max(peakWidth, canvas.width); peakHeight = Math.max(peakHeight, canvas.height); }, 40);
    const began = performance.now();
    let result;
    try { result = await api().exportClip({ start, duration, writable: sink.writable }); }
    finally { clearInterval(timer); }
    const saved = sink.result();
    if (!saved.closed || saved.bytes.length < 1000) throw new Error(`The encoder did not produce a complete clip: ${JSON.stringify(result)}`);
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(new Blob([saved.bytes], { type: 'video/mp4' }));
    lastVideoStart = start;
    output.innerHTML = `<button id="reviewClose">Close encoded preview</button><button id="reviewHalfFrame">Encoded frame at 0.5 seconds</button><button id="reviewOneFrame">Encoded frame at 1 second</button><button id="reviewNativeFrame">View encoded frame at 100%</button><button id="reviewCompareFrame">Compare encoded and preview frame</button><a id="reviewDownload" download="led-grid-${before.mode}-review.mp4">Download encoded clip</a><video id="reviewVideo" controls playsinline></video><pre id="encodedInfo"></pre>`;
    output.hidden = false;
    const video = $('reviewVideo');
    video.src = videoURL;
    $('reviewDownload').href = videoURL;
    $('reviewClose').onclick = () => { video.pause(); output.hidden = true; };
    $('reviewHalfFrame').onclick = () => { video.pause(); video.currentTime = Math.min(.5, video.duration - 1 / 60); };
    $('reviewOneFrame').onclick = () => { video.pause(); video.currentTime = Math.min(1, video.duration - 1 / 60); };
    $('reviewNativeFrame').onclick = () => nativeFrame(video);
    const checks = { completed: true, internal4K: peakWidth >= 3840 && peakHeight >= 2160, ...restoration(before, state()) };
    const info = { passed: Object.values(checks).every(Boolean), checks, start, requestedDuration: duration, bytes: saved.bytes.length,
      renderWidth: peakWidth, renderHeight: peakHeight, elapsedSeconds: (performance.now() - began) / 1000, exportedState: before };
    const update = () => { $('encodedInfo').textContent = JSON.stringify({ ...info, width: video.videoWidth, height: video.videoHeight, duration: video.duration, encodedTime: video.currentTime }, null, 2); };
    video.onloadedmetadata = () => { video.currentTime = Math.min(.5, video.duration - 1 / 60); update(); };
    video.onseeked = update;
    $('reviewCompareFrame').onclick = async () => {
      video.pause();
      try { info.comparison = await compareEncodedFrame(video); update(); }
      catch (error) { info.comparison = { error: error.message }; update(); }
    };
    report(info);
    return info;
  }
  $('reviewReferenceBtn').onclick = () => run(async () => {
    await stop();
    const started = performance.now();
    await api().loadReference({ autoplay: false });
    const loadMilliseconds = performance.now() - started;
    frozenPassages = undefined;
    report({ loadMilliseconds, passages: passages(), state: state() });
  });
  $('reviewRenderBtn').onclick = () => run(async () => {
    const started = performance.now();
    await renderSelection();
    const seekMilliseconds = performance.now() - started;
    report({ seekMilliseconds, quality: pixelStats(), state: state() });
  });
  $('reviewPassageBtn').onclick = () => run(async () => { await renderSelection(selectedPassage().start + 4); report({ passage: selectedPassage(), quality: pixelStats(), state: state() }); });
  $('reviewPlayPassageBtn').onclick = () => run(playPassage);
  $('reviewMotionBtn').onclick = () => run(async () => { const current = state().settings; await api().setSettings({ motion: !current.motion }); await api().renderAt(state().position); report(state()); });
  $('reviewChecksBtn').onclick = () => run(async () => { await stop(); await api().renderAt(state().position); report({ quality: pixelStats(), state: state(), frame: api().reviewFrame ? await api().reviewFrame(state().position) : undefined }); });
  $('reviewSuiteBtn').onclick = () => run(async () => {
    await stop();
    const results = { determinism: await determinismCheck(), resize: await resizeCheck(), exportCancellation: await cancellationCheck() };
    report({ browserTechnicalSuitePassed: Object.values(results).every(result => result.passed), ...results,
      fixtureCoverage: 'Audio fixture checks are executed by the numerical test suite, separately from this browser review.', state: state() });
  });
  $('reviewCancelBtn').onclick = () => run(async () => report(await cancellationCheck()));
  $('reviewRecordBtn').onclick = () => run(async () => report(await recordingCheck()));
  $('reviewRecordFailureBtn').onclick = () => run(async () => report(await recordingFailureCheck()));
  $('reviewLoadCancelBtn').onclick = () => run(async () => report(await loadCancellationCheck()));
  $('reviewClipBtn').onclick = () => run(exportClip);
  $('reviewCaptureBtn').onclick = () => run(async () => {
    await stop(); await api().renderAt(trackTime());
    const result = await api().capturePNG();
    const url = result instanceof Blob ? URL.createObjectURL(result) : result;
    download(url, `led-grid-${state().mode}-${trackTime().toFixed(3)}.png`);
    if (result instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 30000);
    report({ savedNativeFrame: true, quality: pixelStats(), time: trackTime() });
  });
  $('reviewNativeDetailBtn').onclick = () => run(async () => { await stop(); await api().renderAt(trackTime()); nativeDetail(); });
  $('reviewSequenceBtn').onclick = () => run(() => showShot(0));
  $('reviewPreviousShot').onclick = () => run(() => showShot(shotIndex - 1));
  $('reviewNextShot').onclick = () => run(() => showShot(shotIndex + 1));
  $('reviewCleanPlay').onclick = () => run(playPassage);
  $('reviewCleanPause').onclick = () => run(async () => { await stop(); await api().renderAt(state().position); report({ quality: pixelStats(), state: state() }); });
  $('reviewHideToolbar').onclick = () => { toolbar.hidden = true; };
  $('reviewShowControls').onclick = () => { document.body.classList.remove('clean'); toolbar.hidden = true; };
  $('reviewManifestBtn').onclick = () => run(async () => {
    const manifest = { createdAt: new Date().toISOString(), referencePassages: passages(), capturedFrames: evidence.filter(Boolean),
      expectedFrames: evidenceFrameCount, instructions: 'These are frame metadata, not critic screenshots. A separate critic must capture and evaluate every mode, passage and camera view. Scores are not generated by the builder.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    download(url, 'led-grid-review-manifest.json'); setTimeout(() => URL.revokeObjectURL(url), 30000);
    report({ downloadedManifest: true, frames: manifest.capturedFrames.length });
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.key.toLowerCase() !== 'h' || !document.body.classList.contains('clean') || event.metaKey || event.ctrlKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toolbar.hidden = !toolbar.hidden;
  }, true);
  if ($('seekSeconds')) {
    $('seekSeconds').addEventListener('input', () => { $('reviewTime').value = $('seekSeconds').value; });
  }
  // This surface is read-only to the critic. Actions are the visible buttons.
  window.ledGridReviewEvidence = () => ({ passages: frozenPassages, frames: evidence.filter(Boolean), shotIndex });
  report(`Load the reference track, then render an exact frame or start the ${evidenceFrameCount}-frame evidence sequence.`);
}

// Explicit opt-in local review tools. They exercise the same renderer, analysis
// and encoder as the public controls, including an actual short MP4 export.
export function installSpectralReview({ getApi, slug, runFixtureChecks, runMixControlChecks, inspectCanvas, reservedBottomQuarter = true }) {
  if (!new URLSearchParams(location.search).has('review')) return;
  const tools = document.getElementById('reviewTools');
  tools.hidden = false;
  tools.innerHTML = `<div class="section-title">Review tools</div>
    <button id="reviewRenderBtn" class="action glass">Review: exact frame</button>
    <button id="reviewClipBtn" class="action glass">Review: export 2 seconds</button>
    <button id="reviewChecksBtn" class="action glass">Review: inspect quality</button>
    <button id="reviewFixturesBtn" class="action glass">Review: audio fixtures</button>
    <button id="reviewMixControlsBtn" class="action glass">Review: control checks</button>
    <button id="reviewCancelBtn" class="action glass">Review: export cancellation</button>
    <button id="reviewRecordBtn" class="action glass">Review: recording</button>
    <button id="reviewStabilityBtn" class="action glass">Review: 30-second export stability</button>
    <pre id="reviewStatus" style="white-space:pre-wrap;font-size:10px;color:var(--atlas-silver)"></pre>`;
  const output = document.getElementById('reviewOutput');
  const status = document.getElementById('reviewStatus');
  let videoURL = null;
  const state = () => getApi().getState();
  function report(value) { status.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  async function run(action) {
    const buttons = tools.querySelectorAll('button');
    buttons.forEach(button => button.disabled = true);
    report('Working…');
    try { await action(); } catch (error) { report(`Review failed: ${error.message}`); console.error(error); }
    finally { buttons.forEach(button => button.disabled = false); }
  }
  document.getElementById('reviewRenderBtn').onclick = () => run(async () => {
    await getApi().renderAt(Number(document.getElementById('seekSeconds').value) || 0);
    report(state());
  });
  document.getElementById('reviewChecksBtn').onclick = () => run(async () => {
    if (inspectCanvas) { report(await inspectCanvas(getApi())); return; }
    const canvas = document.querySelector('#stage canvas');
    const gl = canvas.getContext('webgl2');
    const count = Math.floor(canvas.height * .25);
    const pixels = new Uint8Array(canvas.width * count * 4);
    gl.readPixels(0, 0, canvas.width, count, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonBlack = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) nonBlack++;
    report({ ...state(), bottomQuarterNonBlackPixels: nonBlack, gpuError: gl.getError() });
  });
  document.getElementById('reviewFixturesBtn').onclick = () => run(async () => report(await runFixtureChecks(getApi())));
  document.getElementById('reviewMixControlsBtn').onclick = () => run(async () => report(await runMixControlChecks(getApi())));
  document.getElementById('reviewRecordBtn').onclick = () => run(async () => {
    await getApi().pause();
    const before = state();
    const chunks = [];
    let closed = false;
    await getApi().recordClip({ duration: 1, writable: {
      async write(chunk) { chunks.push(chunk); },
      async close() { closed = true; },
    } });
    const blob = new Blob(chunks);
    const after = state();
    const checks = { wroteVideo: blob.size > 1000, closed, stopped: !after.recording,
      positionRestored: after.position === before.position,
      viewportRestored: after.viewport.canvasWidth === before.viewport.canvasWidth && after.viewport.canvasHeight === before.viewport.canvasHeight,
      unlocked: !after.busy, remainedPaused: !after.playing, cameraRestored: JSON.stringify(after.camera) === JSON.stringify(before.camera) };
    report({ recordingPassed: Object.values(checks).every(Boolean), bytes: blob.size, checks });
  });
  document.getElementById('reviewCancelBtn').onclick = () => run(async () => {
    await getApi().pause();
    const before = state();
    let aborted = false, closed = false;
    const writable = { async write() {}, async close() { closed = true; }, async abort() { aborted = true; } };
    const timer = setTimeout(() => document.getElementById('exportCancelBtn').click(), 350);
    let result;
    try { result = await getApi().exportClip({ start: before.position, duration: 10, writable }); }
    finally { clearTimeout(timer); }
    const after = state();
    const checks = { cancelled: result?.reason === 'cancelled', partialFileAborted: aborted && !closed,
      positionRestored: after.position === before.position, viewportRestored: after.viewport.canvasWidth === before.viewport.canvasWidth && after.viewport.canvasHeight === before.viewport.canvasHeight,
      unlocked: !after.busy && !after.exporting, remainedPaused: !after.playing, cameraRestored: JSON.stringify(after.camera) === JSON.stringify(before.camera) };
    report({ exportCancellationPassed: Object.values(checks).every(Boolean), checks });
  });
  document.getElementById('reviewStabilityBtn').onclick = () => run(async () => {
    await getApi().pause();
    const before = state();
    let bytes = 0, closed = false, internalWidth = 0, internalHeight = 0;
    const timer = setInterval(() => {
      const canvas = document.querySelector('#stage canvas');
      internalWidth = Math.max(internalWidth, canvas.width);
      internalHeight = Math.max(internalHeight, canvas.height);
    }, 50);
    const started = performance.now();
    try {
      await getApi().exportClip({ start: 80, duration: 30, writable: {
        async write(value) { bytes += (value.data || value).byteLength || (value.data || value).size || 0; },
        async close() { closed = true; },
        async abort() { closed = false; },
      } });
    } finally { clearInterval(timer); }
    const after = state();
    const seconds = (performance.now() - started) / 1000;
    const checks = { completed: closed && bytes > 1000, internal4K: internalWidth === 3840 && internalHeight === 2160,
      positionRestored: after.position === before.position, unlocked: !after.busy && !after.exporting,
      viewportRestored: after.viewport.canvasWidth === before.viewport.canvasWidth && after.viewport.canvasHeight === before.viewport.canvasHeight };
    report({ exportStabilityPassed: Object.values(checks).every(Boolean), checks, bytes, frames: 1800,
      elapsedSeconds: +seconds.toFixed(2), framesPerSecond: +(1800 / seconds).toFixed(2), internalWidth, internalHeight, state: after });
  });
  document.getElementById('reviewClipBtn').onclick = () => run(async () => {
    const chunks = [];
    let cursor = 0, total = 0, saved = false;
    const writable = {
      async write(value) {
        const bytes = value.data || value;
        const data = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength).slice();
        const position = value.position ?? cursor;
        chunks.push({ position, data }); cursor = position + data.length; total = Math.max(total, cursor);
      },
      async close() { saved = true; },
      async abort() { chunks.length = 0; },
    };
    const start = Number(document.getElementById('seekSeconds').value) || 0;
    await getApi().exportClip({ start, duration: 2, writable });
    if (!saved) throw new Error('The encoder did not complete the clip.');
    const bytes = new Uint8Array(total);
    for (const chunk of chunks) bytes.set(chunk.data, chunk.position);
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    output.innerHTML = `<button id="reviewClose" class="action glass">Close encoded preview</button>
      <button id="reviewHalfFrame" class="action glass">Frame at 0.5 seconds</button>
      <button id="reviewOneFrame" class="action glass">Frame at 1 second</button>
      <button id="reviewNativeFrame" class="action glass">View encoded frame at 100%</button>
      <a id="reviewDownload" download="${slug}-review.mp4">Download encoded clip</a>
      <video id="reviewVideo" controls playsinline></video><pre id="encodedInfo"></pre>`;
    output.hidden = false;
    const video = document.getElementById('reviewVideo');
    video.src = videoURL;
    document.getElementById('reviewDownload').href = videoURL;
    document.getElementById('reviewClose').onclick = () => { video.pause(); output.hidden = true; };
    document.getElementById('reviewHalfFrame').onclick = () => { video.pause(); video.currentTime = .5; };
    document.getElementById('reviewOneFrame').onclick = () => { video.pause(); video.currentTime = 1; };
    document.getElementById('reviewNativeFrame').onclick = () => {
      video.pause();
      const native = document.createElement('button');
      native.setAttribute('aria-label', 'Close native encoded frame');
      native.style.cssText = `position:fixed;left:0;top:0;z-index:20000;padding:0;border:0;background:#000;width:${video.videoWidth}px;height:${video.videoHeight}px;cursor:zoom-out`;
      const frame = document.createElement('canvas');
      frame.width = video.videoWidth; frame.height = video.videoHeight;
      frame.style.cssText = `display:block;width:${frame.width}px;height:${frame.height}px`;
      frame.getContext('2d').drawImage(video, 0, 0);
      native.appendChild(frame);
      const close = () => { native.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = event => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); } };
      native.onclick = close;
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(native);
    };
    video.onloadedmetadata = () => { video.currentTime = .5; };
    video.onseeked = async () => {
      const sample = document.createElement('canvas');
      sample.width = video.videoWidth; sample.height = video.videoHeight;
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0);
      const data = ctx.getImageData(0, Math.floor(sample.height * .75), sample.width, Math.floor(sample.height * .25)).data;
      let max = 0;
      for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
      const absoluteTrackTime = start + video.currentTime;
      await getApi().renderAt(absoluteTrackTime);
      const encoded = ctx.getImageData(0, 0, sample.width, Math.floor(sample.height * (reservedBottomQuarter ? .75 : 1))).data;
      ctx.drawImage(document.querySelector('#stage canvas'), 0, 0, sample.width, sample.height);
      const preview = ctx.getImageData(0, 0, sample.width, Math.floor(sample.height * (reservedBottomQuarter ? .75 : 1))).data;
      let difference = 0;
      for (let i = 0; i < encoded.length; i += 4) {
        difference += Math.abs(encoded[i] - preview[i]) + Math.abs(encoded[i + 1] - preview[i + 1]) + Math.abs(encoded[i + 2] - preview[i + 2]);
      }
      document.getElementById('encodedInfo').textContent = JSON.stringify({ width: video.videoWidth, height: video.videoHeight, duration: video.duration, bytes: total, absoluteTrackTime, ...(reservedBottomQuarter ? { bottomQuarterMaxRGB: max } : {}),
        previewComparison: { matchingTrackTime: state().position, meanAbsoluteRGBDifference: +(difference / (encoded.length / 4 * 3)).toFixed(3), range: '0–255; export uses 4K supersampling and lossy H.264' } }, null, 2);
    };
    report(`Encoded ${total.toLocaleString()} bytes of actual MP4 video.`);
  });
}

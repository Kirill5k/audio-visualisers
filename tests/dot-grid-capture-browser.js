const iframe = document.querySelector('#app');
const output = document.querySelector('#results');
const run = document.querySelector('#run');
const artifacts = document.querySelector('#artifacts');
const loomMode = new URLSearchParams(location.search).get('mode') === 'loom';
const captureName = loomMode ? 'dot-grid-loom' : 'dot-grid';
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, doc;
const reports = [];
function check(name, condition, details) {
  reports.push({ name, passed: Boolean(condition), details });
  output.textContent = JSON.stringify(reports, null, 2);
  if (!condition) throw new Error(name);
}
function memoryFile({ holdClose = false } = {}) {
  const writes = []; let cursor = 0, length = 0, closed = false, aborted = false;
  let reportClosing, finishClosing;
  const closeStarted = new Promise(resolve => { reportClosing = resolve; });
  const closeGate = new Promise(resolve => { finishClosing = resolve; });
  return {
    async write(chunk) {
      const position = chunk?.type === 'write' ? chunk.position : cursor;
      const data = chunk?.type === 'write' ? chunk.data : chunk;
      const bytes = typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
      writes.push({ position, bytes: bytes.slice() }); cursor = position + bytes.length; length = Math.max(length, cursor);
    },
    async close() { reportClosing(); if (holdClose) await closeGate; closed = true; }, async abort() { aborted = true; },
    closeStarted, releaseClose() { finishClosing(); },
    get closed() { return closed; }, get aborted() { return aborted; },
    blob(type = 'video/mp4') { const result = new Uint8Array(length); for (const write of writes) result.set(write.bytes, write.position); return new Blob([result], { type }); },
  };
}
function wavFile(buffer, startSeconds, duration) {
  const channels = Math.min(buffer.numberOfChannels, 2), rate = buffer.sampleRate;
  const frames = Math.min(Math.round(duration * rate), buffer.length);
  const start = Math.min(Math.round(startSeconds * rate), buffer.length - frames);
  const data = new ArrayBuffer(44 + frames * channels * 2), view = new DataView(data);
  const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, data.byteLength - 44, true);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels; channel++) view.setInt16(44 + (i * channels + channel) * 2, Math.max(-1, Math.min(1, buffer.getChannelData(channel)[start + i])) * 32767, true);
  return new File([data], 'reference-excerpt.wav', { type: 'audio/wav' });
}
async function metadata(blob, label) {
  const url = URL.createObjectURL(blob);
  const isMp4 = blob.type.includes('mp4');
  const link = document.createElement('a'); link.href = url; link.download = label + (isMp4 ? '.mp4' : '.webm'); link.textContent = `Download ${label} (${(blob.size / 1048576).toFixed(2)} MB)`; artifacts.append(link);
  const video = document.createElement('video'); video.controls = true; video.muted = true; video.preload = 'auto'; video.src = url; artifacts.append(video);
  await Promise.race([
    new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Video metadata could not be decoded')); }),
    tick(10000).then(() => { throw new Error('Video metadata decode timed out'); }),
  ]);
  const details = { width: video.videoWidth, height: video.videoHeight, duration: video.duration, bytes: blob.size };
  check(label + ' has 1080p video', details.width === 1920 && details.height === 1080, details);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  if (isMp4) check(label + ' has audio and video tracks', text.includes('soun') && text.includes('vide'), { audio: text.includes('soun'), video: text.includes('vide') });
  // Decode the captured media itself, so monitor mute cannot hide an empty audio track.
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
    const pcm = decoded.getChannelData(0); let sum = 0;
    for (const value of pcm) sum += value * value;
    const rms = Math.sqrt(sum / pcm.length);
    check(label + ' contains non-silent audio while monitor muted', rms > .001, { rms, audioDuration: decoded.duration });
    details.audioDuration = decoded.duration;
    // Streaming WebM recordings may omit container duration; the decoded audio
    // duration still provides a real-media bound without assuming MP4 support.
    if (!Number.isFinite(details.duration)) details.duration = decoded.duration;
  } finally { await context.close(); }
  return details;
}
async function videoTiming(blob) {
  const buffer = await blob.arrayBuffer(), view = new DataView(buffer);
  const boxes = (start, end) => {
    const result = [];
    for (let offset = start; offset + 8 <= end;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4));
      if (length < 8 || offset + length > end) break;
      result.push({ type, start: offset + 8, end: offset + length });
      offset += length;
    }
    return result;
  };
  const child = (parent, type) => parent && boxes(parent.start, parent.end).find(box => box.type === type);
  const root = { start: 0, end: buffer.byteLength }, movie = child(root, 'moov');
  for (const track of movie ? boxes(movie.start, movie.end).filter(box => box.type === 'trak') : []) {
    const media = child(track, 'mdia'), handler = child(media, 'hdlr');
    if (!handler || String.fromCharCode(...new Uint8Array(buffer, handler.start + 8, 4)) !== 'vide') continue;
    const header = child(media, 'mdhd'), table = child(child(child(media, 'minf'), 'stbl'), 'stts');
    if (!header || !table) continue;
    const timescale = view.getUint32(header.start + (view.getUint8(header.start) === 1 ? 20 : 12));
    let samples = 0, ticks = 0;
    const entries = view.getUint32(table.start + 4);
    for (let index = 0; index < entries; index++) {
      const count = view.getUint32(table.start + 8 + index * 8), delta = view.getUint32(table.start + 12 + index * 8);
      samples += count; ticks += count * delta;
    }
    return { samples, fps: samples * timescale / ticks };
  }
  throw new Error('Exported MP4 has no video sample timing table');
}
function snapshot() {
  return { camera: app.scene.getCameraState(), settings: structuredClone(app.settings), time: app.audio.getPlaybackPosition(), playing: app.audio.isPlaying, width: app.scene.canvas.width, height: app.scene.canvas.height, pixels: app.scene.canvas.toDataURL() };
}
function restored(before, after) {
  return JSON.stringify(before.camera) === JSON.stringify(after.camera) && JSON.stringify(before.settings) === JSON.stringify(after.settings)
    && Math.abs(before.time - after.time) < .025 && before.playing === after.playing && before.width === after.width && before.height === after.height && before.pixels === after.pixels;
}
async function runChecks() {
  run.disabled = true; reports.length = 0; artifacts.replaceChildren(); output.textContent = 'Preparing reference excerpt…';
  const context = new AudioContext();
  let clip;
  try {
    const response = await fetch('../reference.mp3');
    if (!response.ok) throw new Error('reference.mp3 is required for this browser check');
    clip = wavFile(await context.decodeAudioData(await response.arrayBuffer()), 12, 2);
  } finally { await context.close(); }
  await app.load(clip, { autoplay: false });
  if (loomMode) await app.setSetting('scrollingSpectrum', true);
  app.audio.setMuted(true);
  const first = app.scene.canvas.toDataURL();
  doc.querySelector('#playPauseBtn').click(); await tick(800); doc.querySelector('#playPauseBtn').click(); await tick(50);
  check('reference audio changes the dot grid', first !== app.scene.canvas.toDataURL());
  check('play/pause preserves position', !app.audio.isPlaying && app.audio.getPlaybackPosition() > .4, { seconds: app.audio.getPlaybackPosition() });
  const pauseBefore = snapshot(); await tick(140);
  check('paused playback freezes visual time and pixels', restored(pauseBefore, snapshot()));
  await app.seek(.5);
  check('seek resets to requested audio position', Math.abs(app.audio.getPlaybackPosition() - .5) < .01);
  const stopped = app.waitForRecordingStop(); const recording = memoryFile({ holdClose: true });
  await app.toggleRecord({ writable: recording });
  check('recording locks configuration and captures audio', app.recorder.isRecording && doc.querySelector('#resetBtn').disabled);
  check('recording begins from the current playback position', app.audio.getPlaybackPosition() >= .5 && app.audio.getPlaybackPosition() < 1, { seconds: app.audio.getPlaybackPosition() });
  await tick(850); const stopping = app.toggleRecord();
  try {
    await Promise.race([recording.closeStarted, tick(10000).then(() => { throw new Error('Recording did not reach file finalization'); })]);
    check('recording keeps controls locked through asynchronous file finalization', app.locked && doc.querySelector('#resetBtn').disabled && doc.querySelector('#recordBtn').disabled);
  } finally { recording.releaseClose(); }
  await stopping; const recordError = await stopped;
  check('recording completes and unlocks configuration', !recordError && recording.closed && !app.locked);
  await app.audio.pause();
  const recordingInfo = await metadata(recording.blob(app.recorder.getCodec().mime), `${captureName}-recording-check`);
  check('manual recording has a bounded non-zero duration', recordingInfo.duration > .4 && recordingInfo.duration < 1.8, recordingInfo);

  await app.load(clip, { autoplay: false });
  await app.seek(1.2);
  const naturalFile = memoryFile(), naturalStop = app.waitForRecordingStop();
  await app.toggleRecord({ writable: naturalFile });
  const naturalError = await Promise.race([naturalStop, tick(10000).then(() => { throw new Error('Recording did not stop at track end'); })]);
  check('recording automatically finalizes at track end', !naturalError && naturalFile.closed && !app.locked && !app.recorder.isRecording);

  await app.load(clip, { autoplay: false });
  const failureViewport = { width: app.scene.canvas.width, height: app.scene.canvas.height };
  let abortedRecording = false;
  const recordingFailure = app.waitForRecordingStop();
  await app.toggleRecord({ writable: {
    async write() { throw new Error('Intentional recording storage failure'); },
    async close() {}, async abort() { abortedRecording = true; },
  } });
  const writeError = await Promise.race([recordingFailure, tick(10000).then(() => { throw new Error('Recording write failure did not finalize'); })]);
  check('recording write failure aborts its file and restores the viewport and controls', Boolean(writeError) && abortedRecording && !app.locked && !app.recorder.isRecording && app.scene.canvas.width === failureViewport.width && app.scene.canvas.height === failureViewport.height);
  await app.audio.pause();

  await app.load(clip, { autoplay: false });
  const before = snapshot(), exportFile = memoryFile();
  const exported = await app.exportVideo({ writable: exportFile });
  check('full-track export completes', exported.ok && exportFile.closed && !app.locked, exported);
  check('export preserves exact paused preview state', restored(before, snapshot()));
  const info = await metadata(exportFile.blob(), `${captureName}-export-check`);
  const exportText = new TextDecoder('latin1').decode(await exportFile.blob().arrayBuffer());
  check('MP4 export contains H.264 video and AAC audio', exportText.includes('avc1') && exportText.includes('mp4a'));
  check('full-track export duration matches audio', Math.abs(info.duration - 2) < .08, info);
  const timing = await videoTiming(exportFile.blob());
  check('export encodes all 120 frames at 60 fps', timing.samples === 120 && Math.abs(timing.fps - 60) < .01, timing);

  const cancelBefore = snapshot(), cancelledFile = memoryFile();
  const pending = app.exportVideo({ writable: cancelledFile });
  const cancelTimer = setTimeout(() => doc.querySelector('#exportCancelBtn').click(), 60);
  const cancelled = await pending; clearTimeout(cancelTimer);
  check('cancellation stops export and aborts destination', cancelled.reason === 'cancelled' && cancelledFile.aborted, cancelled);
  check('cancellation preserves exact paused preview state', restored(cancelBefore, snapshot()) && !app.locked);

  const failingFile = { write: async () => { throw new Error('Intentional storage failure'); }, close: async () => {}, abort: async () => {} };
  const failureBefore = snapshot(), failed = await app.exportVideo({ writable: failingFile });
  check('storage failure restores the preview and unlocks controls', failed.reason === 'error' && restored(failureBefore, snapshot()) && !app.locked, failed);
  output.className = 'pass'; output.dataset.passed = 'true';
  window.dotGridCaptureResults = { passed: true, checks: [...reports] };
  document.body.dataset.result = 'passed';
  output.textContent = JSON.stringify(window.dotGridCaptureResults, null, 2);
}
run.addEventListener('click', () => runChecks().catch(error => {
  output.className = 'fail'; output.dataset.passed = 'false';
  window.dotGridCaptureResults = { passed: false, error: error.stack, checks: [...reports] };
  document.body.dataset.result = 'failed';
  output.textContent = JSON.stringify(window.dotGridCaptureResults, null, 2);
}).finally(() => { run.disabled = false; }));
const started = performance.now();
if (loomMode) {
  document.title = 'Dot Grid scrolling spectrum capture checks';
  document.querySelector('h1').textContent = 'Dot Grid scrolling spectrum capture checks';
}
const ready = setInterval(() => {
  app = iframe.contentWindow.__dotGridTest;
  if (app) { clearInterval(ready); doc = iframe.contentDocument; run.disabled = false; output.textContent = 'Ready. Run the checks to generate and inspect actual capture files.'; }
  else if (performance.now() - started > 30000 || iframe.contentDocument?.querySelector('#fatal')?.textContent) {
    clearInterval(ready); output.dataset.passed = 'false'; document.body.dataset.result = 'failed';
    output.textContent = iframe.contentDocument?.querySelector('#fatal')?.textContent || 'Dot Grid did not initialize in 30 seconds';
  }
}, 100);

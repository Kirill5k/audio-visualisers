const iframe = document.querySelector('#app');
const output = document.querySelector('#results');
const run = document.querySelector('#run');
const artifacts = document.querySelector('#artifacts');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
let app, doc;
const reports = [];
function check(name, condition, details) {
  reports.push({ name, passed: Boolean(condition), details });
  output.textContent = JSON.stringify(reports, null, 2);
  if (!condition) throw new Error(name);
}
function memoryFile() {
  const writes = []; let cursor = 0, length = 0, closed = false, aborted = false;
  return {
    async write(chunk) {
      const position = chunk?.type === 'write' ? chunk.position : cursor;
      const data = chunk?.type === 'write' ? chunk.data : chunk;
      const bytes = typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
      writes.push({ position, bytes: bytes.slice() }); cursor = position + bytes.length; length = Math.max(length, cursor);
    },
    async close() { closed = true; }, async abort() { aborted = true; },
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
  const link = document.createElement('a'); link.href = url; link.download = label + '.mp4'; link.textContent = `Download ${label} (${(blob.size / 1048576).toFixed(2)} MB)`; artifacts.append(link);
  const video = document.createElement('video'); video.controls = true; video.muted = true; video.preload = 'auto'; video.src = url; artifacts.append(video);
  await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Video metadata could not be decoded')); });
  const details = { width: video.videoWidth, height: video.videoHeight, duration: video.duration, bytes: blob.size };
  check(label + ' has 1080p video', details.width === 1920 && details.height === 1080, details);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  check(label + ' has audio and video tracks', text.includes('soun') && text.includes('vide'), { audio: text.includes('soun'), video: text.includes('vide') });
  // The browser decodes the AAC track from the actual exported/recorded MP4.
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
    const pcm = decoded.getChannelData(0); let sum = 0;
    for (const value of pcm) sum += value * value;
    const rms = Math.sqrt(sum / pcm.length);
    check(label + ' contains non-silent audio while monitor muted', rms > .001, { rms, audioDuration: decoded.duration });
  } finally { await context.close(); }
  return details;
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
  app.audio.setMuted(true);
  const first = app.scene.canvas.toDataURL();
  doc.querySelector('#playPauseBtn').click(); await tick(800); doc.querySelector('#playPauseBtn').click(); await tick(50);
  check('reference audio changes the mesh', first !== app.scene.canvas.toDataURL());
  check('play/pause preserves position', !app.audio.isPlaying && app.audio.getPlaybackPosition() > .4, { seconds: app.audio.getPlaybackPosition() });
  const seek = doc.querySelector('#seek'); seek.value = '250'; seek.dispatchEvent(new Event('input', { bubbles: true }));
  check('seek resets to requested audio position', Math.abs(app.audio.getPlaybackPosition() - .5) < .01);
  const stopped = app.waitForRecordingStop(); const recording = memoryFile();
  await app.toggleRecord({ writable: recording });
  check('recording locks configuration and captures audio', app.recorder.isRecording && doc.querySelector('#resetBtn').disabled);
  await tick(850); await app.toggleRecord(); const recordError = await stopped;
  check('recording completes and unlocks configuration', !recordError && recording.closed && !app.locked);
  await app.audio.pause();
  await metadata(recording.blob(app.recorder.getCodec().mime), 'mesh-grid-recording-check');

  await app.load(clip, { autoplay: false });
  const before = snapshot(), exportFile = memoryFile();
  const exported = await app.exportVideo({ writable: exportFile });
  check('full-track export completes', exported.ok && exportFile.closed && !app.locked, exported);
  check('export preserves exact paused preview state', restored(before, snapshot()));
  const info = await metadata(exportFile.blob(), 'mesh-grid-export-check');
  check('full-track export duration matches audio', Math.abs(info.duration - 2) < .08, info);

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
  output.textContent = JSON.stringify({ passed: true, checks: reports }, null, 2);
}
run.addEventListener('click', () => runChecks().catch(error => { output.className = 'fail'; output.dataset.passed = 'false'; output.textContent = JSON.stringify({ passed: false, error: error.stack, checks: reports }, null, 2); }).finally(() => { run.disabled = false; }));
const ready = setInterval(() => { app = iframe.contentWindow.meshGrid; if (app) { clearInterval(ready); doc = iframe.contentDocument; run.disabled = false; output.textContent = 'Ready. Run the checks to generate and inspect actual MP4 files.'; } }, 100);

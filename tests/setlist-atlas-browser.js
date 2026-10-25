import { SETLIST_COLOR_PRESETS, SETLIST_DEFAULTS } from '../js/setlist/setlist-settings.js';

const iframe = document.querySelector('#app');
const output = document.querySelector('#results');
const summary = document.querySelector('#summary');
const artifacts = document.querySelector('#artifacts');
const buttons = [document.querySelector('#runUI'), document.querySelector('#runExport')];
const tick = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const TRACKS = '00:00 First Artist - Opening Signal\n00:06 Second Artist - New Frequency\n00:12 Third Artist - Last Light';
const results = window.setlistAtlasBrowserResults = { ui: null, export: null };
let app, doc, win, referenceFile, currentSuite, reports = [], busy = false;
const urls = [];
const runtimeErrors = [];

function check(name, passed, details) {
  reports.push({ name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) });
  summary.textContent = `${currentSuite}: ${reports.filter(report => report.passed).length} passed · running…`;
  output.textContent = JSON.stringify(reports, null, 2);
  if (!passed) throw new Error(name);
}

async function until(predicate, message, timeout = 30000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error(message);
    await tick(25);
  }
}

function control(id, value, event = 'input') {
  const element = doc.getElementById(id);
  if (!element) throw new Error(`Missing control: ${id}`);
  if (element.disabled) throw new Error(`Control is disabled: ${id}`);
  if (element.type === 'checkbox') element.checked = value;
  else element.value = String(value);
  element.dispatchEvent(new win.Event(event, { bubbles: true }));
}

function resetPresentation() {
  doc.querySelector('#resetColorsBtn').click();
  for (const key of ['markerSize', 'titleSize', 'artistSize', 'titleWeight', 'artistWeight', 'transitionDuration', 'headers', 'labels']) control(key, SETLIST_DEFAULTS[key]);
  control('alignment', 'left', 'change');
}

async function reference() {
  if (!referenceFile) {
    const response = await fetch('../reference.mp3');
    if (!response.ok) throw new Error('The project reference.mp3 is required.');
    referenceFile = new win.File([await response.blob()], 'reference.mp3', { type: 'audio/mpeg' });
  }
  return referenceFile;
}

const canvas = () => doc.querySelector('#stage canvas');
const pixels = () => canvas().toDataURL();
function snapshot() {
  const state = app.getState();
  return { position: state.position, playing: state.playing, muted: state.muted,
    viewport: state.viewport, settings: state.settings, currentTrack: state.currentTrack, pixels: pixels() };
}
function restored(before, after) {
  return Math.abs(before.position - after.position) < 1 / 60
    && before.playing === after.playing && before.muted === after.muted
    && JSON.stringify(before.viewport) === JSON.stringify(after.viewport)
    && JSON.stringify(before.settings) === JSON.stringify(after.settings)
    && JSON.stringify(before.currentTrack) === JSON.stringify(after.currentTrack)
    && before.pixels === after.pixels;
}

async function runUI() {
  await app.pause(); app.unload();
  resetPresentation();
  control('setlistInput', TRACKS);
  check('setlist pasted before the first load is accepted', app.getState().setlist.entries.length === 3 && doc.querySelector('#setlistStatus').textContent.includes('ready for an audio file'));
  await app.loadFile(await reference());
  check('first audio load preserves the preloaded setlist', app.getState().setlist.entries.length === 3 && doc.querySelector('#setlistInput').value === TRACKS);
  if (!app.getState().muted) doc.querySelector('#muteBtn').click();
  await app.renderAt(4);
  check('shared player uses overview analysis without FFTs', app.getState().quality.fftSize === 0 && app.getState().quality.frequencyBins === 0 && app.getState().quality.rtaFftSize === 0);
  check('no recording control is shown', !doc.querySelector('#recordBtn'));
  check('bundled Inter loaded with black background', app.getState().scene.fontLoaded && app.getState().scene.labelFont === 'Inter' && app.getState().scene.background === '#000000');

  const bounds = app.getState().scene.overviewBounds;
  check('three overviews share drawable edges and progress positions', bounds.length === 3 && bounds.every(bound => bound.left === bounds[0].left && bound.right === bounds[0].right && bound.width === bounds[0].width && bound.progressX === bounds[0].progressX), bounds);
  const state = app.getState();
  check('every marker uses the same resolved horizontal bounds', state.scene.markers.length === 3 && state.scene.markers.every(marker => Math.abs(marker.x - (bounds[0].left + marker.time / state.duration * bounds[0].width)) < 1e-8), state.scene.markers);

  for (const [id, preset] of Object.entries(SETLIST_COLOR_PRESETS)) {
    control('colorPreset', id, 'change'); await app.renderAt(4);
    check(`${preset.label} preset updates all five colours`, Object.entries(preset.colors).every(([key, value]) => app.getState().settings[key].toLowerCase() === value.toLowerCase()));
  }
  for (const [key, value] of Object.entries({ colorElapsed:'#112233', colorRemaining:'#667788', colorLabels:'#aabbcc', colorTitle:'#fedcba', colorArtist:'#cdefab' })) control(key, value);
  await app.renderAt(4);
  check('manual edits select Custom and update all canvas colour roles', doc.querySelector('#colorPreset').value === 'custom' && JSON.stringify(app.getState().scene.colors) === JSON.stringify({ elapsed:'#112233', remaining:'#667788', labels:'#AABBCC', title:'#FEDCBA', artist:'#CDEFAB' }), app.getState().scene.colors);
  doc.querySelector('#resetColorsBtn').click();
  check('Reset colours restores Original', doc.querySelector('#colorPreset').value === 'original' && app.getState().settings.colorElapsed === SETLIST_DEFAULTS.colorElapsed);

  for (const [key, value] of [['markerSize',24], ['titleSize',96], ['artistSize',64], ['transitionDuration',1]]) control(key, value);
  for (const alignment of ['left', 'center', 'right']) {
    control('alignment', alignment, 'change'); await app.renderAt(4);
    const text = app.getState().scene.text;
    check(`${alignment} text alignment is applied`, text.alignment === alignment && text.titleSize === 96 && text.artistSize === 64 && app.getState().scene.markerSize === 24, text);
    await app.renderAt(5.65);
    const erasing = app.getState().scene.text;
    check(`${alignment} animation keeps the completed text anchor fixed`, text.titleX === erasing.titleX && text.artistX === erasing.artistX && text.title !== erasing.title);
  }
  resetPresentation();
  control('titleWeight', 100); control('artistWeight', 900); await app.renderAt(3);
  const lightTitle = pixels();
  check('title and artist weights can be changed independently', app.getState().scene.text.titleWeight === 100 && app.getState().scene.text.artistWeight === 900);
  control('titleWeight', 900); control('artistWeight', 100); await app.renderAt(3);
  check('font weight changes repaint the captured typography', app.getState().scene.text.titleWeight === 900 && app.getState().scene.text.artistWeight === 100 && pixels() !== lightTitle);
  control('setlistInput', `00:00 Artist - ${'Long track title 🌌 '.repeat(30)}`);
  control('titleSize', 96); await app.renderAt(4);
  check('long bold titles ellipsize within the overview width', app.getState().scene.text.fullTitle.endsWith('…') && app.getState().scene.text.fullTitle.length < app.getState().currentTrack.title.length);
  control('setlistInput', TRACKS); resetPresentation();
  await app.renderAt(4.5);
  check('outgoing title erases before a boundary', app.getState().scene.transition.phase === 'erase' && app.getState().currentTrack.index === 0, app.getState().scene.transition);
  const erasePixels = pixels();
  await app.renderAt(7.5);
  check('incoming title reveals after the boundary', app.getState().scene.transition.phase === 'reveal' && app.getState().currentTrack.index === 1, app.getState().scene.transition);
  const revealPixels = pixels();
  await app.renderAt(6);
  check('the exact boundary changes the active track during the blank interval', app.getState().currentTrack.index === 1 && app.getState().scene.text.title === '' && app.getState().scene.transition.phase === 'empty');
  check('accessible announcement changes to the active title and artist', doc.querySelector('#currentTrackAnnouncement').textContent === 'New Frequency — Second Artist');
  await app.renderAt(4.5); check('backward seeks reproduce erase pixels exactly', pixels() === erasePixels);
  await app.renderAt(7.5); check('forward seeks reproduce reveal pixels exactly', pixels() === revealPixels);
  const uploads = app.getState().scene.layers.map(layer => layer.uploads);
  await app.renderAt(7.5);
  check('repeated identical rendering reuses all text textures', JSON.stringify(uploads) === JSON.stringify(app.getState().scene.layers.map(layer => layer.uploads)));

  for (const key of ['headers', 'labels']) control(key, false);
  await app.renderAt(4);
  check('headings and time labels can be hidden independently of track text', !app.getState().scene.headers && !app.getState().scene.labels && app.getState().scene.text.title.length > 0);
  control('headers', true); await app.renderAt(4);
  check('headings toggle does not enable time labels', app.getState().scene.headers && !app.getState().scene.labels);
  control('labels', true);
  control('setlistInput', '00:04 Björk — Jóga 🌌\n00:06 Artist - <img src=x>');
  control('transitionDuration', 1);
  await app.renderAt(2);
  check('no title is shown before the first track start', app.getState().currentTrack.index === -1 && app.getState().scene.text.title === '');
  await app.renderAt(5);
  check('Unicode artist and title survive parsing and display', app.getState().currentTrack.artist === 'Björk' && app.getState().scene.text.fullTitle === 'Jóga 🌌');
  await app.renderAt(7);
  check('setlist titles remain plain text', doc.querySelector('#currentTrackAnnouncement').textContent.includes('<img src=x>') && doc.querySelector('#currentTrackAnnouncement').childElementCount === 0);
  control('setlistInput', `00:00 ${'Long Artist 🌌 '.repeat(30)} - ${'Long Track 🌌 '.repeat(30)}`);
  await app.renderAt(4);
  check('long titles and artists ellipsize to one line', app.getState().scene.text.fullTitle.endsWith('…') && app.getState().scene.text.fullArtist.endsWith('…'));
  control('setlistInput', '00:00 Artist - First\ninvalid row\n00:00 Duplicate\n9999:00 Out of range');
  check('invalid, duplicate and out-of-range rows are reported', app.getState().setlist.entries.length === 1 && app.getState().setlist.errors.length === 2 && app.getState().setlist.outOfRange.length === 1 && doc.querySelector('#setlistStatus').textContent.includes('3 rows ignored'));
  control('setlistInput', TRACKS); resetPresentation();
  await app.renderAt(app.getState().duration);
  check('final title is retained at playback completion', app.getState().finished && app.getState().currentTrack.title === 'Last Light');
  await app.renderAt(4);
  await app.play(); await tick(350); await app.pause();
  check('playback advances and pause preserves position', !app.getState().playing && app.getState().position > 4.2 && app.getState().position < 5.5, { position: app.getState().position });
  const paused = snapshot(); await tick(100);
  check('pause freezes progress, title and pixels', restored(paused, snapshot()));
  doc.querySelector('#cleanBtn').click();
  check('clean view hides playback controls', doc.body.classList.contains('clean') && win.getComputedStyle(doc.querySelector('#actions')).visibility === 'hidden');
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
  check('Escape restores controls and settings', !doc.body.classList.contains('clean') && !doc.querySelector('#panel').classList.contains('hidden'));

  iframe.style.width = '390px'; iframe.style.height = '844px';
  await tick(150); await app.renderAt(4);
  const mobile = app.getState();
  check('portrait preview preserves a 16:9 composition without horizontal overflow', Math.abs(mobile.viewport.width / mobile.viewport.height - 16 / 9) < .01 && doc.documentElement.scrollWidth <= win.innerWidth, mobile.viewport);
  iframe.style.width = '960px'; iframe.style.height = '540px'; await tick(150);
  await app.loadFile(await reference());
  check('replacing audio clears its previous setlist', app.getState().setlist.entries.length === 0 && doc.querySelector('#setlistInput').value === '');
  control('setlistInput', TRACKS); await app.renderAt(4); app.unload(); await tick(40);
  check('unloading clears markers, title and setlist', !app.getState().ready && app.getState().setlist.entries.length === 0 && app.getState().scene.markerCount === 0 && app.getState().currentTrack.index === -1);
  check('no uncaught browser errors occurred', runtimeErrors.length === 0 && !app.getState().error, runtimeErrors);
}

function memoryFile() {
  const writes = []; let cursor = 0, length = 0, closed = false, aborted = false;
  return {
    async write(chunk) {
      const position = chunk?.type === 'write' ? chunk.position ?? cursor : cursor;
      const data = chunk?.type === 'write' ? chunk.data : chunk;
      const bytes = typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer())
        : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
      writes.push({ position, bytes: bytes.slice() }); cursor = position + bytes.length; length = Math.max(length, cursor);
    },
    async close() { closed = true; }, async abort() { aborted = true; },
    get closed() { return closed; }, get aborted() { return aborted; },
    blob() { const bytes = new Uint8Array(length); for (const write of writes) bytes.set(write.bytes, write.position); return new Blob([bytes], { type:'video/mp4' }); },
  };
}

async function sampleTiming(blob) {
  const buffer = await blob.arrayBuffer(), view = new DataView(buffer);
  const boxes = (start, end) => {
    const list = [];
    for (let offset = start; offset + 8 <= end;) {
      const length = view.getUint32(offset);
      if (length < 8 || offset + length > end) break;
      const type = String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4));
      list.push({ type, start:offset + 8, end:offset + length }); offset += length;
    }
    return list;
  };
  const child = (parent, type) => parent && boxes(parent.start, parent.end).find(box => box.type === type);
  const movie = child({ start:0, end:buffer.byteLength }, 'moov');
  for (const track of movie ? boxes(movie.start, movie.end).filter(box => box.type === 'trak') : []) {
    const media = child(track, 'mdia'), handler = child(media, 'hdlr');
    if (!handler || String.fromCharCode(...new Uint8Array(buffer, handler.start + 8, 4)) !== 'vide') continue;
    const header = child(media, 'mdhd'), table = child(child(child(media, 'minf'), 'stbl'), 'stts');
    if (!header || !table) continue;
    const timescale = view.getUint32(header.start + (view.getUint8(header.start) === 1 ? 20 : 12));
    const entries = view.getUint32(table.start + 4);
    let samples = 0, ticks = 0;
    for (let index = 0; index < entries; index++) {
      const count = view.getUint32(table.start + 8 + index * 8), delta = view.getUint32(table.start + 12 + index * 8);
      samples += count; ticks += count * delta;
    }
    return { samples, fps:samples * timescale / ticks, duration:ticks / timescale };
  }
  throw new Error('MP4 has no video sample timing table.');
}

async function videoFrame(video, seconds) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Video frame decode timed out.')); }, 10000);
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); };
    const done = () => { cleanup(); resolve(); };
    video.addEventListener('seeked', done); video.currentTime = seconds;
  });
  const crop = document.createElement('canvas'); crop.width = 960; crop.height = 135;
  const context = crop.getContext('2d', { willReadFrequently:true });
  context.drawImage(video, 0, video.videoHeight * .75, video.videoWidth, video.videoHeight * .25, 0, 0, crop.width, crop.height);
  const data = context.getImageData(0, 0, crop.width, crop.height).data;
  let hash = 2166136261, lit = 0;
  for (let index = 0; index < data.length; index += 4) {
    const brightness = data[index] + data[index + 1] + data[index + 2];
    hash = Math.imul(hash ^ brightness, 16777619);
    if (brightness > 80) lit++;
  }
  return { hash:hash >>> 0, lit };
}

async function inspectVideo(blob) {
  const url = URL.createObjectURL(blob); urls.push(url);
  const link = document.createElement('a'); link.href = url; link.download = 'setlist-atlas-export-check.mp4';
  link.textContent = `Download verified excerpt (${(blob.size / 1048576).toFixed(2)} MB)`; artifacts.append(link);
  const video = document.createElement('video'); video.controls = true; video.muted = true; video.preload = 'auto';
  artifacts.append(video);
  const metadata = new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Exported MP4 metadata could not be decoded.'));
  });
  video.src = url;
  await Promise.race([metadata, tick(15000).then(() => { throw new Error('Video metadata timed out.'); })]);
  // HTMLMediaElement reports the longest track, including AAC encoder padding.
  // The video sample table below separately verifies its exact six-second clock.
  check('exported MP4 has 1920 × 1080 video and bounded AAC padding', video.videoWidth === 1920 && video.videoHeight === 1080 && Math.abs(video.duration - 6) < .12, { width:video.videoWidth, height:video.videoHeight, duration:video.duration, bytes:blob.size });
  const buffer = await blob.arrayBuffer(), text = new TextDecoder('latin1').decode(buffer);
  check('MP4 contains H.264 video and AAC audio tracks', ['vide','soun','avc1','mp4a'].every(value => text.includes(value)));
  const timing = await sampleTiming(blob);
  check('MP4 sample table contains exactly six seconds and 360 frames at 60 fps', timing.samples === 360 && Math.abs(timing.fps - 60) < .01 && Math.abs(timing.duration - 6) < .001, timing);
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    const channel = decoded.getChannelData(0); let energy = 0;
    for (const sample of channel) energy += sample * sample;
    const rms = Math.sqrt(energy / channel.length);
    check('audio remains non-silent while preview is muted and stays synchronized', rms > .001 && Math.abs(decoded.duration - video.duration) < .1, { rms, audioDuration:decoded.duration, videoDuration:video.duration });
  } finally { await audioContext.close(); }
  const before = await videoFrame(video, .12), blank = await videoFrame(video, 3), after = await videoFrame(video, 5.8);
  check('decoded video captures changing titles with a blank boundary', before.hash !== after.hash && before.lit > 20 && after.lit > 20 && blank.lit < Math.min(before.lit, after.lit) * .1, { before, blank, after });
  video.currentTime = 0;
}

async function runExport() {
  check('browser supports offline WebCodecs MP4 export', Boolean(win.VideoEncoder && win.AudioEncoder && win.offlineExport));
  await app.pause(); await app.loadFile(await reference());
  resetPresentation(); control('setlistInput', '00:00 First Artist - Opening Signal\n00:06 Second Artist - New Frequency');
  control('titleWeight', 800); control('artistWeight', 300);
  if (!app.getState().muted) doc.querySelector('#muteBtn').click();
  await app.renderAt(4.25);
  const before = snapshot(), file = memoryFile();
  const result = await app.exportClip({ start:3, duration:6, writable:file });
  await tick(100);
  check('reference excerpt export completes and closes its destination', result.ok && file.closed && !file.aborted && !app.getState().busy && !app.getState().exporting, result);
  check('export restores exact preview time, settings, viewport and pixels', restored(before, snapshot()));
  await inspectVideo(file.blob());

  const cancelledFile = memoryFile(), cancelBefore = snapshot();
  const pending = app.exportClip({ start:3, duration:6, writable:cancelledFile });
  await until(() => app.getState().exporting, 'Cancellation export never started.');
  check('export locks configuration controls', doc.querySelector('#markerSize').disabled && doc.querySelector('#setlistInput').disabled && doc.querySelector('#exportBtn').disabled);
  doc.querySelector('#exportCancelBtn').click();
  const cancelled = await pending; await tick(100);
  check('cancellation stops rendering and aborts its destination', cancelled.reason === 'cancelled' && cancelledFile.aborted && !cancelledFile.closed, cancelled);
  check('cancellation restores the exact preview and unlocks controls', restored(cancelBefore, snapshot()) && !app.getState().busy && !doc.querySelector('#markerSize').disabled);
  check('export produced no uncaught browser errors', runtimeErrors.length === 0 && !app.getState().error, runtimeErrors);
}

async function runSuite(name, action) {
  if (busy) return;
  busy = true; currentSuite = name; reports = []; runtimeErrors.length = 0;
  buttons.forEach(button => { button.disabled = true; });
  output.className = ''; document.body.dataset.result = 'running';
  if (name === 'export') { artifacts.replaceChildren(); urls.splice(0).forEach(url => URL.revokeObjectURL(url)); }
  try {
    await action();
    results[name] = { passed:true, checks:[...reports] };
    output.className = 'pass'; document.body.dataset.result = 'passed';
    summary.textContent = `${name}: ${reports.length} checks passed.`;
  } catch (error) {
    results[name] = { passed:false, error:error.stack || String(error), checks:[...reports] };
    output.className = 'fail'; document.body.dataset.result = 'failed';
    summary.textContent = `${name}: failed — ${error.message}`;
  } finally {
    iframe.style.width = '960px'; iframe.style.height = '540px';
    output.dataset.passed = String(results[name].passed);
    output.textContent = JSON.stringify(results, null, 2);
    busy = false; buttons.forEach(button => { button.disabled = false; });
  }
}

buttons[0].addEventListener('click', () => runSuite('ui', runUI));
buttons[1].addEventListener('click', () => runSuite('export', runExport));
await until(() => {
  const fatal = iframe.contentDocument?.querySelector('#fatal')?.textContent;
  if (fatal) throw new Error(fatal);
  return Boolean(iframe.contentWindow?.setlistAtlas);
}, 'Setlist Atlas did not initialize within 30 seconds.').then(() => {
  win = iframe.contentWindow; doc = iframe.contentDocument; app = win.setlistAtlas;
  win.addEventListener('error', event => runtimeErrors.push(event.message));
  win.addEventListener('unhandledrejection', event => runtimeErrors.push(String(event.reason?.message || event.reason)));
  buttons.forEach(button => { button.disabled = false; });
  summary.textContent = 'Ready. Run UI checks or export checks.';
  output.textContent = 'The checks run only when you choose a button.';
}).catch(error => {
  document.body.dataset.result = 'failed'; output.className = 'fail';
  summary.textContent = 'Visualiser failed to initialize.'; output.textContent = error.stack;
});

import { createMeshGridAnalysis } from '../js/mesh-grid/mesh-grid-analysis.js';

const iframe = document.querySelector('#app');
const run = document.querySelector('#run');
const summary = document.querySelector('#summary');
const output = document.querySelector('#results');
const reports = [];
const tick = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let app, doc, win;

function check(name, passed, details) {
  reports.push({ name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) });
  output.textContent = JSON.stringify(reports, null, 2);
  summary.textContent = `${reports.filter(report => report.passed).length} passed · ${reports.filter(report => !report.passed).length} failed · running…`;
}
async function until(predicate, message, timeout = 30000) {
  const started = performance.now();
  while (!predicate()) {
    const fatal = iframe.contentDocument?.querySelector('#fatal')?.textContent;
    if (fatal) throw new Error(fatal);
    if (performance.now() - started > timeout) throw new Error(message);
    await tick(50);
  }
}
function element(selector) {
  const target = doc.querySelector(selector);
  if (!target) throw new Error(`Missing control: ${selector}`);
  return target;
}
function reveal(target) {
  const ancestors = [];
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') ancestors.unshift(parent);
  }
  for (const details of ancestors) if (!details.open) details.querySelector(':scope > summary').click();
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function click(selector) {
  const target = element(selector); reveal(target);
  if (target.disabled) throw new Error(`Control disabled: ${selector}`);
  target.click();
}
function edit(selector, value) {
  const target = element(selector); reveal(target);
  if (target.disabled) throw new Error(`Control disabled: ${selector}`);
  target.value = String(value);
  target.dispatchEvent(new win.Event('input', { bubbles: true }));
}
const modulation = () => app.settings.controlModulations?.spread;
const manualNumber = () => element('#control-spread').closest('.config-row').querySelector('.number-value');
const pairMatches = (selector, value) => {
  const target = element(selector);
  return Number(target.value) === value && Number(target.closest('.config-row').querySelector('.number-value').value) === value;
};
const liveText = () => element('#spreadLiveValue').textContent.trim();
const liveValue = () => Number(liveText());
const spreadParameters = value => Object.fromEntries(['min', 'max', 'amount', 'attackMs', 'releaseMs'].map(key => [key, value[key]]));
async function pause() {
  if (app.audio.isPlaying) click('#playPauseBtn');
  await until(() => !app.audio.isPlaying, 'Playback did not pause');
}

async function runChecks() {
  reports.length = 0; iframe.style.width = '960px'; iframe.style.height = '720px';
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await pause(); click('#variants button:nth-child(3)');
  if (!app.audio.isMuted) click('#muteBtn');
  await tick(100);
  check('variant 3 starts with manual Spread 7.5 and audio reaction off', app.settings.spread === 7.5 && !element('#spreadAudioReactive').checked && !modulation()?.enabled);
  check('manual range and number fields are initially editable', !element('#control-spread').disabled && !manualNumber().disabled && pairMatches('#control-spread', 7.5));

  click('#spreadAudioReactive');
  const defaults = structuredClone(modulation());
  check('checkbox creates the bass-amplitude Spread defaults', defaults.enabled && defaults.mode === 'audio' && defaults.source === 'amplitude' && defaults.freqStart === 0 && defaults.freqEnd === .1 && defaults.anchor === 'range' && defaults.attackMs === 120 && defaults.releaseMs === 650 && defaults.min === 6 && defaults.max === 9, defaults);
  check('audio reaction locks both manual fields without replacing their stored value', element('#control-spread').disabled && manualNumber().disabled && app.settings.spread === 7.5);
  check('live Spread value is finite and formatted with at most two decimals', Number.isFinite(liveValue()) && /^-?\d+(?:\.\d{1,2})?$/.test(liveText()), { text: liveText() });
  for (const [query, selector] of [['audio source', '#control-spread-audio-source'], ['frequency range', '#control-spread-audio-range']]) {
    edit('#controlSearch', query);
    check(`search for ${query} preserves its containing Spread control`, !element('#control-spread').closest('.config-row').hidden && element(selector).getClientRects().length > 0);
  }
  edit('#controlSearch', '');

  edit('#control-spread-audio-max', 8);
  edit('#control-spread-audio-min', 10);
  check('crossed inline bounds clamp and display the applied endpoint in both fields', modulation().min === 8 && modulation().max === 8 && pairMatches('#control-spread-audio-min', 8) && pairMatches('#control-spread-audio-max', 8), spreadParameters(modulation()));
  for (const [key, value] of Object.entries({ min: 6.5, max: 8.5, amount: 1.5, attackMs: 180, releaseMs: 900 })) edit(`#control-spread-audio-${key}`, value);
  const edited = spreadParameters(modulation());
  check('inline settings update the single Spread modulation record', JSON.stringify(edited) === JSON.stringify({ min: 6.5, max: 8.5, amount: 1.5, attackMs: 180, releaseMs: 900 }), edited);
  check('inline endpoint edits appear in the advanced modulation editor', pairMatches('#control-mod-spread-min', 6.5) && pairMatches('#control-mod-spread-max', 8.5));
  click('#spreadAudioReactive');
  check('disabling restores editable manual Spread and retains reaction parameters', modulation().enabled === false && !element('#control-spread').disabled && !manualNumber().disabled && pairMatches('#control-spread', 7.5) && JSON.stringify(spreadParameters(modulation())) === JSON.stringify(edited));
  click('#spreadAudioReactive');
  check('re-enabling retains the edited reaction parameters', modulation().enabled && JSON.stringify(spreadParameters(modulation())) === JSON.stringify(edited));

  click('#control-mod-spread-enabled');
  check('advanced Enabled off synchronizes the checkbox and manual fields', !element('#spreadAudioReactive').checked && !element('#control-spread').disabled && !manualNumber().disabled);
  click('#control-mod-spread-enabled');
  check('advanced Enabled on synchronizes the checkbox', element('#spreadAudioReactive').checked && element('#control-spread').disabled);
  edit('#control-mod-spread-mode', 'oscillate');
  check('an enabled non-audio mode clears the checkbox but keeps manual Spread locked', !element('#spreadAudioReactive').checked && modulation().mode === 'oscillate' && element('#control-spread').disabled && manualNumber().disabled);
  edit('#control-mod-spread-mode', 'audio');
  check('switching the advanced mode back to Audio restores the checkbox', element('#spreadAudioReactive').checked);
  edit('#control-mod-spread-max', 9.5);
  check('advanced endpoint edits synchronize the inline fields', modulation().max === 9.5 && pairMatches('#control-spread-audio-max', 9.5));
  click('[data-target="spread"] .remove-modulation');
  check('advanced removal clears reaction and restores the original manual value', !modulation() && !element('#spreadAudioReactive').checked && !element('#control-spread').disabled && !manualNumber().disabled && pairMatches('#control-spread', 7.5));
  click('#spreadAudioReactive'); click('#resetBtn');
  check('reset variant clears Spread modulation and restores its manual default', !modulation()?.enabled && !element('#spreadAudioReactive').checked && pairMatches('#control-spread', 7.5));
  click('#spreadAudioReactive');
  check('after reset, enabling uses fresh default bounds and smoothing', modulation().min === 6 && modulation().max === 9 && modulation().attackMs === 120 && modulation().releaseMs === 650);

  click('#referenceBtn');
  await until(() => app.audio.hasAudio && app.audio.isPlaying && !app.locked, 'Reference audio did not load and start', 45000);
  check('reference playback is active and monitoring is muted', app.audio.fileName === 'reference.mp3' && app.audio.isMuted && app.audio.isPlaying);
  const excerptStart = Math.min(12, app.audio.duration * .2);
  edit('#seek', excerptStart / app.audio.duration * 1000);
  const samples = [];
  for (let index = 0; index < 24; index++) { await tick(90); samples.push(liveValue()); }
  const minimum = Math.min(...samples), maximum = Math.max(...samples);
  check('real audio moves live Spread inside the configured bounds', samples.every(Number.isFinite) && minimum >= 6 && maximum <= 9 && maximum - minimum >= .01, { minimum, maximum, samples });
  await pause(); await tick(50);
  const frozen = liveText(); await tick(450);
  check('pausing freezes the live Spread readout', !app.audio.isPlaying && liveText() === frozen, { before: frozen, after: liveText() });
  click('#replayBtn');
  await until(() => app.audio.isPlaying, 'Replay did not restart playback');
  check('Replay restarts the track from the beginning', app.audio.getPlaybackPosition() < .25);
  await tick(120); await pause();

  const mobile = /Android|iPhone|iPad|iPod/.test(win.navigator.userAgent) || win.navigator.platform === 'MacIntel' && win.navigator.maxTouchPoints > 1;
  const browserBias = /Chrome|Chromium|Edg\//.test(win.navigator.userAgent) && !mobile ? 10 : 0;
  const settings = structuredClone(app.settings);
  const pass = () => {
    const analysis = createMeshGridAnalysis(app.audio.buffer, settings, { browserBias });
    try { return Array.from({ length: 121 }, (_, index) => analysis.frameAt(index / 60, 1 / 60).settings.spread); }
    finally { analysis.dispose(); }
  };
  const first = pass(), second = pass();
  check('replayed reference analysis reproduces the same Spread envelope', first.every((value, index) => Number.isFinite(value) && value === second[index] && value >= 6 && value <= 9), { frames: first.length });

  let recordingClosed = false;
  const destination = { async write() {}, async close() { recordingClosed = true; }, async abort() {} };
  const stopped = app.waitForRecordingStop();
  await app.toggleRecord({ writable: destination });
  check('recording locks the checkbox and inline reaction settings', app.recorder.isRecording && element('#spreadAudioReactive').disabled && [...element('#spreadAudioControls').querySelectorAll('input, select')].every(input => input.disabled));
  await tick(250); await app.toggleRecord();
  const recordingError = await stopped;
  check('recording completion restores reaction controls but keeps manual Spread locked', !recordingError && recordingClosed && !app.locked && !element('#spreadAudioReactive').disabled && element('#control-spread').disabled);
  await pause();

  iframe.style.width = '390px'; iframe.style.height = '844px'; await tick(300);
  reveal(element('#spreadAudioReactive'));
  const checkbox = element('#spreadAudioReactive').getBoundingClientRect();
  const valueRect = element('#spreadLiveValue').getBoundingClientRect();
  check('checkbox and live value fit the narrow preview without document overflow', win.innerWidth === 390 && win.innerHeight === 844 && checkbox.left >= 0 && checkbox.right <= 390 && valueRect.left >= 0 && valueRect.right <= 390 && doc.documentElement.scrollWidth <= 391, { viewport: [win.innerWidth, win.innerHeight], documentWidth: doc.documentElement.scrollWidth, checkbox: [checkbox.left, checkbox.right], liveValue: [valueRect.left, valueRect.right] });
  reveal(element('#spreadAudioControls'));
  const controlRects = [...element('#spreadAudioControls').querySelectorAll('input, select')].filter(input => input.getClientRects().length).map(input => ({ id: input.id, left: input.getBoundingClientRect().left, right: input.getBoundingClientRect().right }));
  check('inline settings stay inside the narrow panel', controlRects.length >= 5 && controlRects.every(rect => rect.left >= 0 && rect.right <= 390), controlRects);
  click('#spreadAudioReactive');
  check('disabling after audio playback still restores manual Spread 7.5', !element('#control-spread').disabled && !manualNumber().disabled && pairMatches('#control-spread', 7.5) && app.settings.spread === 7.5);
  check('Spread interactions leave no fatal error', !element('#fatal').textContent);
}

run.addEventListener('click', () => {
  run.disabled = true;
  runChecks().catch(error => check('Spread checks completed', false, error.stack || String(error))).finally(async () => {
    if (app?.recorder.isRecording) app.toggleRecord();
    if (app?.audio.isPlaying && !app.locked) await app.audio.pause();
    const passed = reports.length > 0 && reports.every(report => report.passed);
    window.particleDanceSpreadResults = { passed, checks: reports.length, results: [...reports] };
    output.textContent = JSON.stringify(window.particleDanceSpreadResults, null, 2);
    summary.textContent = `${reports.filter(report => report.passed).length} passed · ${reports.filter(report => !report.passed).length} failed`;
    document.body.dataset.result = passed ? 'passed' : 'failed'; run.disabled = false;
  });
});

until(() => iframe.contentWindow?.particleDance && iframe.contentDocument?.querySelector('#spreadAudioReactive'), 'Spread controls did not become available').then(() => {
  win = iframe.contentWindow; doc = iframe.contentDocument; app = win.particleDance;
  run.disabled = false; summary.textContent = 'Ready. Run checks to exercise Spread with muted reference audio.';
}).catch(error => { summary.textContent = error.message; output.textContent = error.stack; });

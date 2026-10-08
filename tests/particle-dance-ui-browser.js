import { EFFECT_DEFAULTS, EFFECT_ORDER } from '../js/particle-dance/particle-dance-effect-settings.js';

const run = document.querySelector('#run');
const summary = document.querySelector('#summary');
const output = document.querySelector('#results');
const reports = [];
const frames = [document.querySelector('#mobile'), document.querySelector('#desktop')];
const tick = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const dimensions = element => {
  const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
  return { x, y, width, height, right, bottom };
};

function check(viewport, name, passed, details) {
  reports.push({ viewport, name, passed: Boolean(passed), ...(details === undefined ? {} : { details }) });
  output.textContent = JSON.stringify(reports, null, 2);
  summary.textContent = `${reports.filter(report => report.passed).length} passed · ${reports.filter(report => !report.passed).length} failed · running…`;
}

async function ready(frame) {
  const started = performance.now();
  while (!frame.contentWindow?.particleDance || frame.contentDocument?.body.dataset.ready !== 'true') {
    const fatal = frame.contentDocument?.querySelector('#fatal')?.textContent;
    if (fatal) throw new Error(fatal);
    if (performance.now() - started > 25000) throw new Error(`${frame.id} preview did not start within 25 seconds`);
    await tick(100);
  }
}

async function runViewport(frame, width, height) {
  await ready(frame);
  const win = frame.contentWindow, doc = frame.contentDocument, app = win.particleDance;
  const label = `${frame.id} ${width}×${height}`;
  const element = selector => {
    const found = doc.querySelector(selector);
    if (!found) throw new Error(`Missing control ${selector}`);
    return found;
  };
  const click = selector => {
    const target = element(selector);
    const ancestors = [];
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') ancestors.unshift(parent);
    }
    for (const details of ancestors) if (!details.open) details.querySelector(':scope > summary').click();
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (target.disabled) throw new Error(`Control is disabled: ${selector}`);
    target.click();
  };
  const inside = rect => rect.x >= -1 && rect.y >= -1 && rect.right <= width + 1 && rect.bottom <= height + 1;
  const escape = () => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

  escape(); click('#resetBtn');
  await tick(280);
  check(label, 'iframe has the requested viewport', win.innerWidth === width && win.innerHeight === height, { width: win.innerWidth, height: win.innerHeight });
  for (const selector of ['#stage', '#stage canvas']) {
    const rect = dimensions(element(selector));
    check(label, `${selector} covers the full viewport`, Math.abs(rect.x) <= 1 && Math.abs(rect.y) <= 1 && Math.abs(rect.width - width) <= 1 && Math.abs(rect.height - height) <= 1, rect);
  }
  const pageSize = { width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight, bodyWidth: doc.body.scrollWidth, bodyHeight: doc.body.scrollHeight };
  check(label, 'page has no horizontal or vertical document overflow', pageSize.width <= width + 1 && pageSize.bodyWidth <= width + 1 && pageSize.height <= height + 1 && pageSize.bodyHeight <= height + 1, pageSize);
  const actions = [...doc.querySelectorAll('#actions button')].map(button => ({ id: button.id, label: button.getAttribute('aria-label'), ...dimensions(button) }));
  check(label, 'all eight action buttons are inside the viewport', actions.length === 8 && actions.every(inside), actions);
  check(label, 'icon-only actions retain accessible names', actions.every(button => Boolean(button.label?.trim())));
  check(label, 'open settings and toggle stay inside the viewport', inside(dimensions(element('#panel'))) && inside(dimensions(element('#panelToggle'))));

  click('#panelToggle'); await tick(280);
  check(label, 'settings toggle closes and removes hidden controls from keyboard navigation', element('#panel').classList.contains('hidden') && element('#panel').inert && element('#panelToggle').getAttribute('aria-expanded') === 'false');
  check(label, 'closed settings toggle stays inside the viewport', inside(dimensions(element('#panelToggle'))));
  click('#panelToggle'); await tick(280);
  check(label, 'settings toggle reopens the panel', !element('#panel').classList.contains('hidden') && !element('#panel').inert && element('#panelToggle').getAttribute('aria-expanded') === 'true');
  click('#cleanBtn');
  check(label, 'clean view hides the settings, transport and timeline', ['#panel', '#panelToggle', '#actions', '#timeline', '#readout'].every(selector => win.getComputedStyle(element(selector)).visibility === 'hidden'));
  escape(); await tick(280);
  check(label, 'Escape restores controls and opens settings', !doc.body.classList.contains('clean') && !element('#panel').inert && win.getComputedStyle(element('#actions')).visibility === 'visible');
  check(label, 'all six variants and 32 effects are available', doc.querySelectorAll('#variants button').length === 6 && doc.querySelectorAll('[data-effect]').length === 32);

  click('#disableEffectsBtn');
  if (!element('#control-enablePostProcessing').checked) click('#control-enablePostProcessing');
  check(label, 'Disable all effects clears the active chain', app.activeEffects.length === 0 && EFFECT_ORDER.every(id => app.settings[`${id}_enabled`] === false));
  click('#control-bloom_enabled'); click('#control-rgbShift_enabled');
  check(label, 'effect checkboxes enable the selected effects', app.activeEffects.length === 2 && app.activeEffects.includes('bloom') && app.activeEffects.includes('rgbShift'));
  const orderBefore = [...doc.querySelectorAll('[data-effect]')].map(folder => folder.dataset.effect);
  const positionBefore = orderBefore.indexOf('rgbShift');
  click('[data-effect="rgbShift"] button[aria-label="↑ Earlier RGB Shift"]');
  const orderAfter = [...doc.querySelectorAll('[data-effect]')].map(folder => folder.dataset.effect);
  check(label, 'Earlier moves an effect one slot in the UI and render order', orderAfter.indexOf('rgbShift') === positionBefore - 1 && JSON.stringify(app.settings.effectOrder) === JSON.stringify(orderAfter), { before: positionBefore, after: orderAfter.indexOf('rgbShift'), active: app.activeEffects });
  click('[data-effect="rgbShift"] button[aria-label="↓ Later RGB Shift"]');
  check(label, 'Later restores the previous effect order', JSON.stringify(app.settings.effectOrder) === JSON.stringify(orderBefore));

  const gamma = element('#control-gammaCorrection_gamma');
  gamma.value = '2.6'; gamma.dispatchEvent(new win.Event('input', { bubbles: true }));
  check(label, 'an effect slider edits its parameter', app.settings.gammaCorrection_gamma === 2.6);
  click('#resetEffectsBtn');
  check(label, 'Reset all effects restores values and source order', Object.entries(EFFECT_DEFAULTS).every(([key, value]) => app.settings[key] === value) && JSON.stringify(app.settings.effectOrder) === JSON.stringify(EFFECT_ORDER));

  const search = element('#controlSearch');
  search.value = 'bloom'; search.dispatchEvent(new win.Event('input', { bubbles: true }));
  const bloom = element('[data-effect="bloom"]');
  check(label, 'search reveals the matching effect and hides unrelated controls', !bloom.hidden && bloom.open && !element('#control-bloom_enabled').closest('.config-row').hidden && element('#control-particleSize').closest('.config-row').hidden);
  search.value = ''; search.dispatchEvent(new win.Event('input', { bubbles: true }));
  check(label, 'clearing search restores every effect section', [...doc.querySelectorAll('[data-effect]')].every(folder => !folder.hidden));
  click('#resetBtn');
  check(label, 'no fatal error after UI interaction', !element('#fatal').textContent);
}

run.addEventListener('click', async () => {
  run.disabled = true; reports.length = 0;
  for (const [index, frame] of frames.entries()) {
    try { await runViewport(frame, index === 0 ? 390 : 1280, index === 0 ? 844 : 800); }
    catch (error) { check(frame.id, 'UI checks completed', false, error.stack || String(error)); }
  }
  const passed = reports.every(report => report.passed);
  window.particleDanceUiResults = { passed, checks: reports.length, results: [...reports] };
  output.textContent = JSON.stringify(window.particleDanceUiResults, null, 2);
  summary.textContent = `${reports.filter(report => report.passed).length} passed · ${reports.filter(report => !report.passed).length} failed`;
  document.body.dataset.result = passed ? 'passed' : 'failed';
  run.disabled = false;
});

Promise.all(frames.map(ready)).then(() => {
  run.disabled = false; summary.textContent = 'Both previews are ready. Run checks to exercise the real controls.';
}).catch(error => { summary.textContent = error.message; output.textContent = error.stack; });

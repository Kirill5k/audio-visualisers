import { createSpectralPlayer } from '../terrain/spectral-player.js';
import { parseSetlist } from '../atlas/signal-atlas-setlist.js';
import { PULSE_COLOR_PRESETS as COLOR_PRESETS, matchingPulsePreset as matchingPreset } from '../pulse/pulse-settings.js';
import { createPhosphorAnalysis } from './phosphor-analysis.js';
import { createPhosphorAtlasScene } from './phosphor-scene.js';
import { PHOSPHOR_FFT_SIZE } from './phosphor-analysis-core.js';

const $ = id => document.getElementById(id);
const COLORS = COLOR_PRESETS.atlas.colors;
const SCOPE_DEFAULTS = Object.freeze({ scopeWindow: 46, scopeTraces: 10, scopeAutoGain: true, scopeGain: 1, scopeThickness: 1.7, scopeGlow: .16 });
const settings = {
  ...COLORS, ...SCOPE_DEFAULTS,
  sparkSeconds: 10, alerts: true, gridOpacity: .24,
  sectionOrder: 'telemetry-scope',
  labels: true, headers: true, sectionNumbers: true, markerSize: 10, setlist: [],
};

window.phosphorAtlas = await createSpectralPlayer({
  name: 'Phosphor Atlas', slug: 'phosphor-atlas', settings,
  createScene: createPhosphorAtlasScene,
  analysisFactory: () => createPhosphorAnalysis(),
  // The longest sparkline plus the two-second alert lookback, so changing the window never rebuilds history.
  historySeconds: 30, historyPaddingFrames: 150,
  previewAspect: 16 / 9,
  controls: [...Object.keys(SCOPE_DEFAULTS), 'sparkSeconds', 'alerts', 'gridOpacity', 'labels', 'headers', 'sectionNumbers', 'markerSize'],
  quality: () => ({ fftSize: PHOSPHOR_FFT_SIZE, frequencyBins: PHOSPHOR_FFT_SIZE / 2, rtaFftSize: 0,
    scopeWindowMs: settings.scopeWindow, sparklineSeconds: settings.sparkSeconds, reservedTextFraction: .25 }),
  extend(player) {
    const { audio, bind } = player;
    let setlistResult = parseSetlist('');

    function syncScopeControls() {
      $('scopeGain').disabled = player.locked || settings.scopeAutoGain;
      $('scopeGainRow').classList.toggle('inactive', settings.scopeAutoGain);
    }

    function applyColors(colors) {
      for (const [key, value] of Object.entries(colors)) { settings[key] = value; $(key).value = value; }
      $('colorPreset').value = matchingPreset(settings);
      document.body.style.setProperty('--accent', settings.colorLow);
      player.invalidate();
    }

    function updateSetlist({ clear = false } = {}) {
      const input = $('setlistInput');
      if (clear) input.value = '';
      setlistResult = parseSetlist(input.value, { duration: audio.hasAudio ? audio.duration : Infinity });
      settings.setlist = setlistResult.entries;
      const count = settings.setlist.length;
      const ignored = setlistResult.errors.length + setlistResult.outOfRange.length;
      const lines = [];
      if (!input.value.trim()) lines.push('Paste a setlist to mark track starts.');
      else {
        lines.push(`${count} track ${count === 1 ? 'marker' : 'markers'}${audio.hasAudio ? '' : ' ready for an audio file'}.${ignored ? ` ${ignored} ${ignored === 1 ? 'row' : 'rows'} ignored.` : ''}`);
        for (const error of setlistResult.errors.slice(0, 3)) lines.push(`Line ${error.line}: ${error.message}`);
        if (setlistResult.errors.length > 3) lines.push(`${setlistResult.errors.length - 3} more invalid rows.`);
        if (setlistResult.outOfRange.length) lines.push('Starts at or beyond the audio duration are ignored.');
      }
      $('setlistStatus').textContent = lines.join('\n');
      player.invalidate();
    }

    bind('sectionOrder', 'change', event => {
      if (player.locked) return;
      settings.sectionOrder = event.target.value;
      player.invalidate();
    });
    bind('scopeAutoGain', 'change', syncScopeControls);
    bind('resetScopeBtn', 'click', () => {
      if (player.locked) return;
      for (const [key, value] of Object.entries(SCOPE_DEFAULTS)) {
        settings[key] = value;
        if (typeof value === 'boolean') $(key).checked = value;
        else { $(key).value = String(value); if ($(key + 'Value')) $(key + 'Value').textContent = String(value); }
      }
      syncScopeControls();
      player.invalidate();
    });
    bind('setlistInput', 'input', () => { if (!player.locked) updateSetlist(); });
    bind('colorPreset', 'change', event => {
      if (!player.locked && COLOR_PRESETS[event.target.value]) applyColors(COLOR_PRESETS[event.target.value].colors);
    });
    for (const key of Object.keys(COLORS)) bind(key, 'input', event => {
      if (!player.locked) applyColors({ [key]: event.target.value });
    });
    bind('resetColorsBtn', 'click', () => {
      if (player.locked) return;
      applyColors(COLORS);
    });

    return {
      initialize: syncScopeControls,
      onButtonsUpdated: () => { if ($('scopeGain')) syncScopeControls(); },
      onTrackLoaded: ({ replacingTrack }) => updateSetlist({ clear: replacingTrack }),
      onReset: updateSetlist,
      getState: () => ({ setlist: {
        entries: setlistResult.entries.map(entry => ({ ...entry })),
        errors: setlistResult.errors.map(entry => ({ ...entry })),
        outOfRange: setlistResult.outOfRange.map(entry => ({ ...entry })),
      } }),
    };
  },
});

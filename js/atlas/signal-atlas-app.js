import { createSpectralPlayer } from '../terrain/spectral-player.js';
import { createSignalAtlasScene } from './signal-atlas-scene.js';
import { parseSetlist } from './signal-atlas-setlist.js';
import { validateRange, clampRange, RTA_PRESETS } from './signal-atlas-instrument-math.js';
import { ATLAS_COLOR_DEFAULTS, ATLAS_COLOR_PRESETS, matchingAtlasColorPreset } from './signal-atlas-palette.js';

const $ = id => document.getElementById(id);
const settings = {
  ...ATLAS_COLOR_DEFAULTS,
  gain: 1.3,
  gridOpacity: .3,
  labels: true,
  headers: true,
  rtaMin: 20,
  rtaMax: 20000,
  rtaBoost: 6,
  setlist: [],
};

window.signalAtlas = await createSpectralPlayer({
  name: 'Signal Atlas', slug: 'signal-atlas', settings,
  createScene: createSignalAtlasScene, historySeconds: 24,
  // Atlas uses the detailed spectrum and stereo instruments, but no motion flux.
  motionAnalysis: false,
  controls: ['gain', 'gridOpacity', 'labels', 'headers'],
  extend(player) {
    const { audio, scene, bind } = player;
    let setlistResult = parseSetlist('');
    let hoverPosition = null;

    function applyColors(colors) {
      for (const key of Object.keys(ATLAS_COLOR_DEFAULTS)) {
        settings[key] = colors[key];
        $(key).value = colors[key];
      }
      $('colorPreset').value = matchingAtlasColorPreset(settings);
      player.invalidate();
    }

    function updateSetlist({ clear = false } = {}) {
      const input = $('setlistInput');
      if (clear && input) input.value = '';
      setlistResult = parseSetlist(input?.value || '', { duration: audio.hasAudio ? audio.duration : Infinity });
      settings.setlist = setlistResult.entries;
      const count = settings.setlist.length;
      const ignored = setlistResult.errors.length + setlistResult.outOfRange.length;
      const lines = [];
      if (!(input?.value || '').trim()) lines.push('Paste a setlist to mark track starts.');
      else {
        lines.push(`${count} track ${count === 1 ? 'marker' : 'markers'}${audio.hasAudio ? '' : ' ready for an audio file'}.${ignored ? ` ${ignored} ${ignored === 1 ? 'row' : 'rows'} ignored.` : ''}`);
        for (const error of setlistResult.errors.slice(0, 3)) lines.push(`Line ${error.line}: ${error.message}`);
        if (setlistResult.errors.length > 3) lines.push(`${setlistResult.errors.length - 3} more invalid rows.`);
        if (setlistResult.outOfRange.length) lines.push('Starts at or beyond the audio duration are ignored.');
      }
      if ($('setlistStatus')) $('setlistStatus').textContent = lines.join('\n');
      player.invalidate();
    }

    function formatFrequency(hz) {
      return hz >= 1000 ? `${Number((hz / 1000).toFixed(2))} kHz` : `${Number(hz.toFixed(1))} Hz`;
    }

    function setAnalyzerRange(min, max) {
      const range = validateRange(min, max, player.analysis.sampleRate || 48000);
      settings.rtaMin = range.min;
      settings.rtaMax = range.max;
      $('rtaMin').value = String(range.min);
      $('rtaMax').value = String(range.max);
      for (const id of ['rtaMin', 'rtaMax']) $(id).removeAttribute('aria-invalid');
      $('rtaStatus').dataset.invalid = 'false';
      $('rtaStatus').textContent = `${formatFrequency(range.min)}–${formatFrequency(range.max)} · boost affects the curves only.`;
      const preset = Object.entries(RTA_PRESETS).find(([, value]) => value.min === range.min && Math.min(value.max, (player.analysis.sampleRate || 48000) / 2) === range.max);
      $('rtaPreset').value = preset?.[0] || 'custom';
      player.invalidate();
    }

    function syncAnalyzerRange() {
      const sampleRate = player.analysis.sampleRate || 48000;
      const range = clampRange(settings.rtaMin, settings.rtaMax, sampleRate);
      setAnalyzerRange(range.min, range.max);
      for (const id of ['rtaMin', 'rtaMax']) $(id).max = String(sampleRate / 2);
      for (const option of $('rtaPreset').options) {
        if (option.value !== 'custom') option.disabled = RTA_PRESETS[option.value].min >= sampleRate / 2;
      }
    }

    function editAnalyzerRange() {
      if (player.locked) return;
      try { setAnalyzerRange($('rtaMin').value, $('rtaMax').value); }
      catch (error) {
        for (const id of ['rtaMin', 'rtaMax']) $(id).setAttribute('aria-invalid', 'true');
        $('rtaStatus').dataset.invalid = 'true';
        $('rtaStatus').textContent = error.message;
      }
    }

    function hideSpectrumHover() {
      hoverPosition = null;
      $('spectrumHover').hidden = true;
    }

    function updateSpectrumHover() {
      const overlay = $('spectrumHover');
      if (!hoverPosition || player.locked || document.body.classList.contains('clean')) {
        overlay.hidden = true;
        return;
      }
      const hit = scene.hitTest(hoverPosition.x, hoverPosition.y);
      if (!hit) { overlay.hidden = true; return; }
      const bounds = scene.canvas.getBoundingClientRect();
      const rect = scene.getInfo().instruments.rects.analyzer;
      overlay.style.left = `${bounds.left + rect.x * bounds.width}px`;
      overlay.style.top = `${bounds.top + rect.y * bounds.height}px`;
      overlay.style.width = `${rect.w * bounds.width}px`;
      overlay.style.height = `${rect.h * bounds.height}px`;
      const localX = (hoverPosition.x - rect.x) * bounds.width;
      overlay.querySelector('.spectrum-crosshair').style.left = `${localX}px`;
      const tooltip = overlay.querySelector('.spectrum-tooltip');
      const db = value => Number.isFinite(value) ? value.toFixed(1) : '−∞';
      tooltip.textContent = `${formatFrequency(hit.frequency)}\nL ${db(hit.leftDb)} dBFS   R ${db(hit.rightDb)} dBFS\nSmoothed · before display boost`;
      overlay.hidden = false;
      tooltip.style.left = `${Math.max(0, Math.min(rect.w * bounds.width - tooltip.offsetWidth, localX + 12))}px`;
    }

    scene.canvas.addEventListener('pointermove', event => {
      const bounds = scene.canvas.getBoundingClientRect();
      hoverPosition = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
      updateSpectrumHover();
    });
    scene.canvas.addEventListener('pointerleave', hideSpectrumHover);

    bind('rtaMin', 'input', editAnalyzerRange);
    bind('rtaMax', 'input', editAnalyzerRange);
    bind('rtaPreset', 'change', event => {
      if (player.locked) return;
      const preset = RTA_PRESETS[event.target.value];
      if (preset) setAnalyzerRange(preset.min, preset.max);
    });
    bind('rtaBoost', 'input', event => {
      if (player.locked) return;
      const value = Number(event.target.value);
      if ([0, 6, 12, 18].includes(value)) { settings.rtaBoost = value; player.invalidate(); }
    });
    bind('setlistInput', 'input', () => {
      if (!player.locked) updateSetlist();
    });
    bind('resetColorsBtn', 'click', () => {
      if (player.locked) return;
      applyColors(ATLAS_COLOR_DEFAULTS);
    });
    bind('colorPreset', 'change', event => {
      if (player.locked) return;
      const preset = ATLAS_COLOR_PRESETS[event.target.value];
      if (preset) applyColors(preset.colors);
    });
    for (const key of Object.keys(ATLAS_COLOR_DEFAULTS)) {
      bind(key, 'input', event => {
        if (player.locked) return;
        settings[key] = event.target.value;
        $('colorPreset').value = matchingAtlasColorPreset(settings);
        player.invalidate();
      });
    }

    return {
      initialize: syncAnalyzerRange,
      onTrackLoaded: ({ replacingTrack }) => { syncAnalyzerRange(); updateSetlist({ clear: replacingTrack }); },
      onReset: updateSetlist,
      hideHover: hideSpectrumHover,
      onRender: updateSpectrumHover,
      getState: () => ({
        setlist: {
          entries: setlistResult.entries.map(entry => ({ ...entry })),
          errors: setlistResult.errors.map(error => ({ ...error })),
          outOfRange: setlistResult.outOfRange.map(entry => ({ ...entry })),
        },
      }),
    };
  },
});

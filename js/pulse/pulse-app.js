import { createSpectralPlayer } from '../terrain/spectral-player.js';
import { createPulseAnalysis } from './pulse-analysis.js';
import { createPulseAtlasScene } from './pulse-scene.js';
import { parseSetlist } from '../atlas/signal-atlas-setlist.js';
import { PULSE_DEFAULT_BANDS, PULSE_FFT_SIZE, PULSE_SMOOTHING, validatePulseAnalysisOptions } from './pulse-analysis-core.js';
import { PULSE_COLOR_PRESETS, PULSE_TRACE_DEFAULTS, PULSE_CHARTS, matchingPulsePreset } from './pulse-settings.js';

const $ = id => document.getElementById(id);
const COLORS = PULSE_COLOR_PRESETS.atlas.colors;
const settings = {
  ...COLORS, ...PULSE_TRACE_DEFAULTS,
  bands: PULSE_DEFAULT_BANDS.map(band => ({ ...band })), fftSize: PULSE_FFT_SIZE, smoothing: PULSE_SMOOTHING,
  historySeconds: 15, energyGain: 1, gridOpacity: .24,
  leftChart: 'rhythm-lanes', rightChart: 'energy-ribbons',
  labels: true, headers: true, sectionNumbers: true, markerSize: 10, setlist: [],
};

window.pulseAtlas = await createSpectralPlayer({
  name: 'Pulse Atlas', slug: 'pulse-atlas', settings,
  createScene: createPulseAtlasScene,
  analysisFactory: () => createPulseAnalysis({ bands: settings.bands, fftSize: settings.fftSize, smoothing: settings.smoothing }),
  // Retain the largest selectable window, so both chart windows can change
  // immediately without interrupting playback or rebuilding their histories.
  historySeconds: 60, historyPaddingFrames: 60,
  previewAspect: 16 / 9,
  controls: [...Object.keys(PULSE_TRACE_DEFAULTS), 'historySeconds', 'energyGain', 'gridOpacity', 'labels', 'headers', 'sectionNumbers', 'markerSize'],
  quality: () => ({ fftSize: settings.fftSize, frequencyBins: settings.fftSize / 2, rtaFftSize: 0,
    bandCount: 3, rhythmHistorySeconds: settings.historySeconds, energyHistorySeconds: settings.historySeconds, reservedTextFraction: .25 }),
  extend(player) {
    const { audio, bind } = player;
    let setlistResult = parseSetlist('');
    const bandNames = ['kick', 'snare', 'hats'];
    const analysisIds = [...bandNames.flatMap(name => [name + 'Min', name + 'Max']), 'fftSize', 'smoothing'];

    function syncAnalysisControls() {
      const info = player.analysis.getInfo();
      if (info.loaded) settings.bands = info.bands.map(band => ({ ...band }));
      settings.bands.forEach((band, index) => {
        $(bandNames[index] + 'Min').value = String(band.min);
        $(bandNames[index] + 'Max').value = String(band.max);
      });
      const maximum = Math.min(22000, (player.analysis.sampleRate || 48000) / 2);
      for (const name of bandNames) {
        $(name + 'Min').max = String(maximum - 1);
        $(name + 'Max').max = String(maximum);
      }
      $('fftSize').value = String(settings.fftSize);
      $('smoothing').value = String(settings.smoothing);
      $('smoothingValue').textContent = settings.smoothing.toFixed(2);
      for (const id of analysisIds) $(id).removeAttribute('aria-invalid');
      $('bandStatus').dataset.invalid = 'false';
      $('bandStatus').textContent = 'Applied to rhythm lanes and energy ribbons · Low, Mid and High ranges.';
      player.invalidate();
    }

    async function applyAnalysisSettings(draft) {
      if (player.locked) return;
      let next;
      try {
        next = validatePulseAnalysisOptions(draft, player.analysis.sampleRate || 48000);
      } catch (error) {
        for (const id of analysisIds) $(id).setAttribute('aria-invalid', 'true');
        $('bandStatus').dataset.invalid = 'true';
        $('bandStatus').textContent = error.message;
        return;
      }
      const previous = { bands: settings.bands, fftSize: settings.fftSize, smoothing: settings.smoothing };
      const changed = JSON.stringify(previous) !== JSON.stringify(next);
      Object.assign(settings, next);
      $('bandStatus').dataset.invalid = 'false';
      $('bandStatus').textContent = audio.hasAudio && changed ? 'Updating audio analysis…' : 'Frequency bands applied.';
      try {
        if (audio.hasAudio && changed) await player.reanalyze();
        syncAnalysisControls();
      } catch (error) {
        Object.assign(settings, previous);
        syncAnalysisControls();
        $('bandStatus').dataset.invalid = 'true';
        $('bandStatus').textContent = `Previous settings retained: ${error.message}`;
        throw error;
      }
    }

    function readAnalysisDraft() {
      return {
        bands: bandNames.map(name => ({ min: Number($(name + 'Min').value), max: Number($(name + 'Max').value) })),
        fftSize: Number($('fftSize').value), smoothing: Number($('smoothing').value),
      };
    }

    function applyColors(colors) {
      for (const [key, value] of Object.entries(colors)) { settings[key] = value; $(key).value = value; }
      $('colorPreset').value = matchingPulsePreset(settings);
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

    for (const key of ['leftChart', 'rightChart']) bind(key, 'change', event => {
      if (player.locked || !Object.hasOwn(PULSE_CHARTS, event.target.value)) return;
      const other = key === 'leftChart' ? 'rightChart' : 'leftChart';
      if (settings[other] === event.target.value) settings[other] = settings[key];
      settings[key] = event.target.value;
      $('leftChart').value = settings.leftChart;
      $('rightChart').value = settings.rightChart;
      $('chartStatus').textContent = `${PULSE_CHARTS[settings.leftChart]} · ${PULSE_CHARTS[settings.rightChart]}`;
      player.invalidate();
    });
    bind('setlistInput', 'input', () => { if (!player.locked) updateSetlist(); });
    bind('applyBandsBtn', 'click', () => applyAnalysisSettings(readAnalysisDraft()));
    bind('resetBandsBtn', 'click', () => applyAnalysisSettings({ bands: PULSE_DEFAULT_BANDS, fftSize: PULSE_FFT_SIZE, smoothing: PULSE_SMOOTHING }));
    for (const id of analysisIds) {
      bind(id, 'input', () => {
        if (player.locked) return;
        $('smoothingValue').textContent = Number($('smoothing').value).toFixed(2);
        $('bandStatus').dataset.invalid = 'false';
        $('bandStatus').textContent = 'Changes ready · choose Apply bands to update the analysis.';
      });
      bind(id, 'keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        return applyAnalysisSettings(readAnalysisDraft());
      });
    }
    bind('resetTraceBtn', 'click', () => {
      if (player.locked) return;
      for (const [key, value] of Object.entries(PULSE_TRACE_DEFAULTS)) {
        settings[key] = value; $(key).value = String(value); $(key + 'Value').textContent = String(value);
      }
      player.invalidate();
    });
    bind('colorPreset', 'change', event => {
      if (!player.locked && PULSE_COLOR_PRESETS[event.target.value]) applyColors(PULSE_COLOR_PRESETS[event.target.value].colors);
    });
    for (const key of Object.keys(COLORS)) bind(key, 'input', event => {
      if (!player.locked) applyColors({ [key]: event.target.value });
    });
    bind('resetColorsBtn', 'click', () => {
      if (player.locked) return;
      applyColors(COLORS);
    });

    return {
      onTrackLoaded: ({ replacingTrack }) => { syncAnalysisControls(); updateSetlist({ clear: replacingTrack }); },
      onReset: updateSetlist,
      getState: () => ({ setlist: {
        entries: setlistResult.entries.map(entry => ({ ...entry })),
        errors: setlistResult.errors.map(entry => ({ ...entry })),
        outOfRange: setlistResult.outOfRange.map(entry => ({ ...entry })),
      } }),
    };
  },
});

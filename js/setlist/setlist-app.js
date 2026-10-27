import { createSpectralPlayer } from '../terrain/spectral-player.js';
import { parseSetlist } from '../atlas/signal-atlas-setlist.js';
import { createSetlistAnalysis } from './setlist-analysis.js';
import { createSetlistAtlasScene } from './setlist-scene.js';
import { SETLIST_COLOR_PRESETS, SETLIST_DEFAULTS, matchingSetlistPreset, resolveSetlistColors } from './setlist-settings.js';

const $ = id => document.getElementById(id);
const settings = { ...SETLIST_DEFAULTS, setlist: [] };
const COLOR_KEYS = Object.keys(SETLIST_COLOR_PRESETS.original.colors);

window.setlistAtlas = await createSpectralPlayer({
  name: 'Setlist Atlas', slug: 'setlist-atlas', settings,
  createScene: createSetlistAtlasScene,
  analysisFactory: createSetlistAnalysis,
  historySeconds: 1,
  previewAspect: 16 / 9,
  motionAnalysis: false,
  controls: ['markerSize', 'progressHeight', 'titleSize', 'titleWeight', 'artistSize', 'artistWeight', 'transitionDuration', 'headers', 'labels'],
  quality: { fftSize: 0, frequencyBins: 0, rtaFftSize: 0, analysisFps: 60, overviewCount: 3 },
  extend(player) {
    const { audio, bind } = player;
    let setlistResult = parseSetlist('');
    let announcementKey = '';

    function updateAnnouncement() {
      const current = player.scene.getCurrentTrack();
      const key = JSON.stringify([current.index, current.title, current.artist]);
      if (key === announcementKey) return;
      announcementKey = key;
      $('currentTrackAnnouncement').textContent = current.index < 0 ? ''
        : current.artist ? `${current.title} — ${current.artist}` : current.title;
    }

    function applyColors(colors) {
      Object.assign(settings, colors);
      const resolved = resolveSetlistColors(settings);
      const values = { colorElapsed: resolved.elapsed, colorRemaining: resolved.remaining,
        colorLabels: resolved.labels, colorTitle: resolved.title, colorArtist: resolved.artist };
      for (const [key, value] of Object.entries(values)) {
        settings[key] = value;
        $(key).value = value.toLowerCase();
      }
      $('colorPreset').value = matchingSetlistPreset(settings);
      document.body.style.setProperty('--accent', resolved.elapsed);
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

    bind('setlistInput', 'input', () => { if (!player.locked) updateSetlist(); });
    bind('alignment', 'change', event => {
      if (player.locked || !['left', 'center', 'right'].includes(event.target.value)) return;
      settings.alignment = event.target.value;
      player.invalidate();
    });
    bind('colorPreset', 'change', event => {
      const preset = SETLIST_COLOR_PRESETS[event.target.value];
      if (!player.locked && preset) applyColors(preset.colors);
    });
    for (const key of COLOR_KEYS) bind(key, 'input', event => {
      if (!player.locked) {
        applyColors({ [key]: event.target.value });
        $('colorPreset').value = 'custom';
      }
    });
    bind('resetColorsBtn', 'click', () => {
      if (!player.locked) applyColors(SETLIST_COLOR_PRESETS.original.colors);
    });

    return {
      initialize() { applyColors(SETLIST_COLOR_PRESETS.original.colors); updateSetlist(); },
      onTrackLoaded: ({ replacingTrack }) => updateSetlist({ clear: replacingTrack }),
      onReset: updateSetlist,
      onRender: updateAnnouncement,
      getState: () => ({
        currentTrack: player.scene.getCurrentTrack(),
        setlist: {
          entries: setlistResult.entries.map(entry => ({ ...entry })),
          errors: setlistResult.errors.map(entry => ({ ...entry })),
          outOfRange: setlistResult.outOfRange.map(entry => ({ ...entry })),
        },
      }),
    };
  },
});

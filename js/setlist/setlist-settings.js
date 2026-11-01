import { ATLAS_COLOR_PRESETS } from '../atlas/signal-atlas-palette.js';

/** Signal Atlas palette roles, with white elapsed and artist defaults for Original. */
export const SETLIST_COLOR_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(ATLAS_COLOR_PRESETS).map(([key, preset]) => [key, Object.freeze({
    label: preset.label,
    colors: Object.freeze({
      colorElapsed: key === 'original' ? '#FFFFFF' : preset.colors.colorAccent,
      colorRemaining: preset.colors.colorPrimary,
      colorLabels: preset.colors.colorText,
      colorTitle: preset.colors.colorText,
      colorArtist: key === 'original' ? '#FFFFFF' : preset.colors.colorAccent,
    }),
  })]),
));

export const SETLIST_DEFAULTS = Object.freeze({
  ...SETLIST_COLOR_PRESETS.original.colors,
  markerSize: 10,
  progressHeight: 4,
  titleSize: 40,
  titleWeight: 450,
  artistSize: 40,
  artistWeight: 450,
  alignment: 'left',
  transitionDuration: 6,
  headers: true,
  labels: true,
  setlist: Object.freeze([]),
});

const COLOR_ROLES = Object.freeze({
  elapsed: 'colorElapsed', remaining: 'colorRemaining', labels: 'colorLabels',
  title: 'colorTitle', artist: 'colorArtist',
});

export function resolveSetlistColors(settings = {}) {
  return Object.fromEntries(Object.entries(COLOR_ROLES).map(([role, key]) => {
    const value = settings?.[key];
    return [role, typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
      ? value.toUpperCase() : SETLIST_DEFAULTS[key]];
  }));
}

export function matchingSetlistPreset(settings = {}) {
  const colors = resolveSetlistColors(settings);
  return Object.entries(SETLIST_COLOR_PRESETS).find(([, preset]) =>
    Object.entries(COLOR_ROLES).every(([role, key]) => colors[role] === preset.colors[key].toUpperCase()))?.[0] || 'custom';
}

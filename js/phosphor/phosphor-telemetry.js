import { PHOSPHOR_FLOOR_DB, PHOSPHOR_BAND_FLOOR_DB } from './phosphor-analysis-core.js';

export const TELEMETRY_READOUT_FRAMES = 6;
export const TELEMETRY_SPARK_POINTS = 120;
export const TELEMETRY_ALERT_DECAY = .45;
export const TELEMETRY_ALERT_LOOKBACK = 120;
export const BAND_NAMES = Object.freeze(['LOW', 'MID', 'HIGH']);
const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

const audible = value => value > PHOSPHOR_FLOOR_DB ? value : NaN;
const minus = value => value < 0 ? `−${Math.abs(value).toFixed(1)}` : value.toFixed(1);

export function camelot(tonic, isMinor) {
  const relativeMajor = isMinor ? (tonic + 3) % 12 : tonic;
  return { number: ((relativeMajor * 7) % 12 + 7) % 12 + 1, letter: isMinor ? 'A' : 'B' };
}

/** Key index 0–11 is major, 12–23 minor, as stored by the analysis. */
export function keyLabel(index) {
  if (!(index >= 0 && index < 24)) return '—';
  const isMinor = index >= 12, tonic = index % 12, code = camelot(tonic, isMinor);
  return `${(isMinor ? MINOR_NAMES : MAJOR_NAMES)[tonic]}${isMinor ? 'm' : ''} · ${code.number}${code.letter}`;
}

const bandLevel = band => row => row.rmsDb > PHOSPHOR_FLOOR_DB && row.bands[band] > PHOSPHOR_BAND_FLOOR_DB ? row.bands[band] : NaN;

/**
 * Twelve tiles in reading order. `value` feeds both the readout and the sparkline; `display`
 * overrides the readout text; `reduce: 'max'` keeps short spikes visible between sparkline samples.
 */
export const TELEMETRY_CHANNELS = Object.freeze([
  { id: 'loudness', label: 'LOUDNESS · MOMENTARY', unit: 'LUFS', color: 'low', range: [-30, 0], value: row => audible(row.loudness), alert: value => value > -8 },
  { id: 'rms', label: 'RMS', unit: 'dBFS', color: 'text', range: [-36, 0], value: row => audible(row.rmsDb) },
  { id: 'peak', label: 'PEAK', unit: 'dBFS · ≥ −0.3', color: 'mid', range: [-24, 0], value: row => audible(row.peakDb), alert: value => value >= -.3, reduce: 'max' },
  { id: 'crest', label: 'CREST FACTOR', unit: 'dB', color: 'high', range: [0, 20], value: row => audible(row.peakDb) - audible(row.rmsDb) },
  { id: 'centroid', label: 'SPECTRAL CENTROID', unit: 'Hz', color: 'low', range: [200, 6000], log: true, value: row => row.centroid,
    format: value => Math.round(value).toLocaleString('en-US') },
  { id: 'flux', label: 'ONSET FLUX', unit: '%', color: 'mid', range: [0, 100], value: row => Math.min(1, row.novelty) * 100,
    format: value => `${Math.round(value)}`, reduce: 'max' },
  { id: 'attacks', label: 'ATTACK RATE', unit: 'PER SECOND', color: 'high', range: [0, 12], value: row => row.attackRate },
  { id: 'tempo', label: 'TEMPO', unit: 'BPM · LOCAL', color: 'low', range: ({ bpm }) => Number.isFinite(bpm) ? [bpm - 3, bpm + 3] : [90, 150], value: row => row.tempo },
  { id: 'key', label: 'KEY', unit: 'CONFIDENCE', color: 'mid', range: [0, 1], value: row => row.keyScore, display: row => keyLabel(row.key), text: true },
  { id: 'correlation', label: 'PHASE CORRELATION', unit: 'ALERT < 0', color: 'low', range: [-1, 1], value: row => row.correlation, alert: value => value < 0,
    format: value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}` },
  { id: 'side', label: 'SIDE SHARE · MID BAND', unit: '%', color: 'high', range: [0, 100], value: row => row.sideShare * 100, format: value => `${Math.round(value)}` },
  { id: 'mix', label: 'BAND MIX', unit: 'LOW · MID · HIGH', color: 'text', range: [-30, 3], text: true,
    series: [bandLevel(0), bandLevel(1), bandLevel(2)],
    value: row => Math.max(...[0, 1, 2].map(band => bandLevel(band)(row)).filter(Number.isFinite), -Infinity),
    display: row => {
      const levels = [0, 1, 2].map(band => bandLevel(band)(row));
      if (!levels.some(Number.isFinite)) return '—';
      return BAND_NAMES[levels.indexOf(Math.max(...levels.filter(Number.isFinite)))];
    } },
]);

export function telemetryRange(channel, context = {}) {
  return typeof channel.range === 'function' ? channel.range(context) : channel.range;
}

/** Position of a value within the tile's range, 0–1. */
export function telemetryNorm(channel, value, context) {
  const [low, high] = telemetryRange(channel, context);
  const fraction = channel.log ? Math.log(value / low) / Math.log(high / low) : (value - low) / (high - low);
  return Math.max(0, Math.min(1, fraction));
}

/** Readout text for a row. Undefined values read as an em dash. */
export function telemetryReadout(channel, row) {
  if (!row) return '—';
  if (channel.display) return channel.display(row);
  const value = channel.value(row);
  if (!Number.isFinite(value)) return '—';
  return channel.format ? channel.format(value) : minus(value);
}

/** Readouts refresh at 10 Hz on absolute frames, so paused, played and exported frames agree. */
export function readoutFrame(frame) {
  return frame - ((frame % TELEMETRY_READOUT_FRAMES) + TELEMETRY_READOUT_FRAMES) % TELEMETRY_READOUT_FRAMES;
}

/**
 * Sparkline samples on an absolute frame grid covering `seconds` before `frame`, plus the head at
 * `frame` itself. The grid does not move with playback position, so lines scroll without shimmer.
 * Returns [{ frame, value }] oldest first; values may be NaN where the metric is undefined.
 */
export function sparklineSamples(valueAt, frame, seconds, { points = TELEMETRY_SPARK_POINTS, reduce = 'last', fps = 60 } = {}) {
  const span = Math.max(1, Math.round(seconds * fps)), step = Math.max(1, Math.round(span / points));
  const bucket = (from, to) => {
    if (reduce !== 'max') return valueAt(to);
    let best = NaN;
    for (let f = from; f <= to; f++) {
      const value = valueAt(f);
      if (Number.isFinite(value) && !(value <= best)) best = value;
    }
    return best;
  };
  const samples = [];
  const first = Math.ceil((frame - span) / step) * step;
  for (let g = first; g <= frame; g += step) samples.push({ frame: g, value: bucket(g - step + 1, g) });
  if (!samples.length || samples.at(-1).frame !== frame) {
    const last = samples.length ? samples.at(-1).frame : frame - 1;
    samples.push({ frame, value: bucket(last + 1, frame) });
  }
  return samples;
}

/** Seconds since the channel last crossed its alert threshold, within a two-second lookback. */
export function alertAge(channel, valueAt, frame, { fps = 60, lookback = TELEMETRY_ALERT_LOOKBACK } = {}) {
  if (!channel.alert) return Infinity;
  for (let f = frame; f > frame - lookback; f--) {
    const value = valueAt(f);
    if (Number.isFinite(value) && channel.alert(value)) return (frame - f) / fps;
  }
  return Infinity;
}

export function alertFlash(age) {
  return Number.isFinite(age) ? Math.exp(-age / TELEMETRY_ALERT_DECAY) : 0;
}

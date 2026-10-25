const BLANK_HALF_SECONDS = 0.25;
const SCRAMBLE_RATE = 12;
const SCRAMBLE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function hashText(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  return hash >>> 0;
}

function transitionSeed(entry, time) {
  const identity = entry ? `${entry.time}:${entry.title}` : '';
  return (hashText(identity) ^ Math.imul(Math.floor(time * SCRAMBLE_RATE), 2654435761)) >>> 0;
}

/** Separate the first spaced dash; retain all remaining punctuation as plain text. */
export function splitTrackTitle(text) {
  const value = String(text ?? '').trim();
  const separator = /\s+[-–—]\s+/u.exec(value);
  if (!separator) return { artist: '', title: value };
  return {
    artist: value.slice(0, separator.index).trim(),
    title: value.slice(separator.index + separator[0].length).trim(),
  };
}

/** Entries are the sorted, valid entries returned by parseSetlist. */
export function activeTrackIndex(entries, time) {
  if (Number.isNaN(time)) return -1;
  let lower = 0;
  let upper = entries.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (entries[middle].time <= time) lower = middle + 1;
    else upper = middle;
  }
  return lower - 1;
}

/**
 * Sample the title animation using audio time alone, including during seeks/export.
 * Progress is phase completion: erase goes full -> empty, reveal empty -> full.
 * The half-second blank stays centred on each boundary. Neighbouring phases stop
 * at their shared midpoint; overlapping blank intervals remain blank.
 */
export function sampleTrackTransition(entries, time, { duration = 6 } = {}) {
  const activeIndex = activeTrackIndex(entries, time);
  const active = entries[activeIndex];
  const next = entries[activeIndex + 1];
  const seed = transitionSeed(active, Number.isFinite(time) ? time : 0);
  const sample = (phase, progress, displayIndex = activeIndex) => ({
    activeIndex,
    displayIndex,
    phase,
    progress: clamp(progress, 0, 1),
    seed,
  });
  if (!active) return sample('empty', 0, -1);

  // The first entry has no outgoing title, and nothing appears before its start.
  if (time < active.time + BLANK_HALF_SECONDS
      || (next && time >= next.time - BLANK_HALF_SECONDS)) {
    return sample('empty', 0, -1);
  }

  const halfDuration = clamp(Number.isFinite(duration) ? duration : 6, 1, 10) / 2;
  const halfInterval = next ? (next.time - active.time) / 2 : Infinity;
  const halfPhase = Math.min(halfDuration, halfInterval);
  const revealStart = active.time + BLANK_HALF_SECONDS;
  const revealEnd = active.time + halfPhase;
  if (time < revealEnd) {
    return sample('reveal', (time - revealStart) / (revealEnd - revealStart));
  }

  if (next) {
    const eraseStart = next.time - halfPhase;
    const eraseEnd = next.time - BLANK_HALF_SECONDS;
    if (time >= eraseStart) {
      return sample('erase', (time - eraseStart) / (eraseEnd - eraseStart));
    }
  }
  return sample('hold', 1);
}

/** Return a grapheme-safe prefix with one deterministic scrambled edge character. */
export function animatedTrackText(text, transition) {
  const value = String(text ?? '');
  if (!value || transition.phase === 'empty') return '';
  if (transition.phase === 'hold') return value;
  const progress = clamp(Number.isFinite(transition.progress) ? transition.progress : 0, 0, 1);
  const visible = transition.phase === 'erase' ? 1 - progress : progress;
  if (visible <= 0) return '';
  if (visible >= 1) return value;

  const graphemes = Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
  const count = Math.ceil(graphemes.length * visible);
  const prefix = graphemes.slice(0, count);
  let edge = prefix.length - 1;
  while (edge >= 0 && /^\s+$/u.test(prefix[edge])) edge -= 1;
  if (edge >= 0) {
    const seed = (transition.seed ^ hashText(value) ^ Math.imul(edge + 1, 2246822519)) >>> 0;
    prefix[edge] = SCRAMBLE_CHARACTERS[seed % SCRAMBLE_CHARACTERS.length];
  }
  return prefix.join('');
}

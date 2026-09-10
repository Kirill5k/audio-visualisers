/** Shared formatting for the DOM controls and captured canvas labels. */
export function formatTrackTime(value, { forceHours = false, padMinutes = true } = {}) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, '0');
  if (forceHours || hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder}`;
  }
  return `${String(minutes).padStart(padMinutes ? 2 : 1, '0')}:${remainder}`;
}

/** Parse plaintext track starts. Titles remain text, never HTML. */
export function parseSetlist(text, { duration = Infinity } = {}) {
  const entries = [];
  const errors = [];
  const outOfRange = [];
  const times = new Set();
  const limit = Number.isFinite(duration) ? Math.max(0, duration) : Infinity;
  String(text ?? '').split(/\r?\n/u).forEach((raw, index) => {
    const line = index + 1;
    const row = raw.trim();
    if (!row) return;
    const match = /^(\d+):(\d{2})(?::(\d{2}))?\s+(.+)$/u.exec(row);
    if (!match) {
      errors.push({ line, message: 'Use MM:SS or HH:MM:SS followed by a track title.' });
      return;
    }
    const first = Number(match[1]);
    const middle = Number(match[2]);
    const hasHours = match[3] !== undefined;
    const seconds = hasHours ? Number(match[3]) : middle;
    if (seconds > 59 || (hasHours && middle > 59)) {
      errors.push({ line, message: hasHours ? 'Minutes and seconds must be between 00 and 59.' : 'Seconds must be between 00 and 59.' });
      return;
    }
    const time = hasHours ? first * 3600 + middle * 60 + seconds : first * 60 + seconds;
    if (!Number.isSafeInteger(time)) {
      errors.push({ line, message: 'This timestamp is too large.' });
      return;
    }
    if (times.has(time)) {
      errors.push({ line, message: 'Duplicate timestamp; the first track at this time is used.' });
      return;
    }
    times.add(time);
    const entry = { time, title: match[4].trim(), line };
    if (time >= limit) outOfRange.push(entry);
    else entries.push(entry);
  });
  entries.sort((a, b) => a.time - b.time);
  return { entries, errors, outOfRange };
}

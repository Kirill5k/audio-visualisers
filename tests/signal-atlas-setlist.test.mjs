import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTrackTime, parseSetlist } from '../js/atlas/signal-atlas-setlist.js';

test('track clocks retain seconds and expand to hours without a 24-hour wrap', () => {
  assert.equal(formatTrackTime(0), '00:00');
  assert.equal(formatTrackTime(3599.99), '59:59');
  assert.equal(formatTrackTime(3600), '01:00:00');
  assert.equal(formatTrackTime(3723), '01:02:03');
  assert.equal(formatTrackTime(100 * 3600 + 2 * 60 + 3), '100:02:03');
  assert.equal(formatTrackTime(2, { forceHours: true }), '00:00:02');
  assert.equal(formatTrackTime(62, { padMinutes: false }), '1:02');
  assert.equal(formatTrackTime(-4), '00:00');
  assert.equal(formatTrackTime(NaN), '00:00');
  assert.equal(formatTrackTime(Infinity), '00:00');
});

test('the supplied setlist preserves Unicode titles and ignores blank lines', () => {
  const result = parseSetlist(`
00:00 Grooved Terrain - Ice Volcano 
04:02 Lost Astronaut - There's Something About You

08:04 AIKON, PÔNGO - Lost In You
11:51 M.ono - Ataraa
`);
  assert.deepEqual(result.entries.map(({ time, title }) => ({ time, title })), [
    { time: 0, title: 'Grooved Terrain - Ice Volcano' },
    { time: 242, title: "Lost Astronaut - There's Something About You" },
    { time: 484, title: 'AIKON, PÔNGO - Lost In You' },
    { time: 711, title: 'M.ono - Ataraa' },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.outOfRange, []);
});

test('hours and total-minute timestamps sort by time and retain original line numbers', () => {
  const result = parseSetlist('100:02:03 Final track\r\n75:02 Long mix\r\n01:04:05 New hour\r\n4:02 Early track');
  assert.deepEqual(result.entries.map(({ time, line }) => ({ time, line })), [
    { time: 242, line: 4 }, { time: 3845, line: 3 },
    { time: 4502, line: 2 }, { time: 360123, line: 1 },
  ]);
  assert.equal(result.errors.length, 0);
});

test('malformed times and duplicate starts are ignored with useful line feedback', () => {
  const result = parseSetlist('00:60 Invalid seconds\n01:60:00 Invalid minutes\n4:2 Short seconds\n02:00\n-1:00 Negative\n00:10 First\n00:10 Duplicate\n9007199254740991:59 Overflow');
  assert.deepEqual(result.entries, [{ time: 10, title: 'First', line: 6 }]);
  assert.deepEqual(result.errors.map(error => error.line), [1, 2, 3, 4, 5, 7, 8]);
  assert.match(result.errors[5].message, /Duplicate/);
});

test('timestamps at the end or beyond duration cannot start a new track', () => {
  const result = parseSetlist('00:00 Start\n00:59 Last minute\n01:00 At end\n02:00 Beyond', { duration: 60 });
  assert.deepEqual(result.entries.map(entry => entry.time), [0, 59]);
  assert.deepEqual(result.outOfRange.map(entry => entry.time), [60, 120]);
  assert.equal(result.errors.length, 0);
  assert.equal(parseSetlist('00:00 Empty audio', { duration: 0 }).entries.length, 0);
  assert.equal(parseSetlist('01:00 Fractional end', { duration: 60.2 }).entries.length, 1);
});

test('titles are retained as plaintext and the first duplicate wins across timestamp styles', () => {
  const result = parseSetlist('60:00 <img src=x onerror=alert(1)>\n01:00:00 Replacement');
  assert.equal(result.entries[0].title, '<img src=x onerror=alert(1)>');
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(parseSetlist('\r\n \n'), { entries: [], errors: [], outOfRange: [] });
});

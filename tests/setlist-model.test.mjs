import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSetlist } from '../js/atlas/signal-atlas-setlist.js';
import {
  activeTrackIndex,
  animatedTrackText,
  sampleTrackTransition,
  splitTrackTitle,
} from '../js/setlist/setlist-model.js';

const entries = parseSetlist('00:05 AIKON, PÔNGO - Lost In You\n00:20 Björk – Jóga\n01:00 Finale').entries;

test('artist/title presentation separates only the first spaced hyphen, en dash or em dash', () => {
  for (const separator of [' - ', ' – ', ' — ', '\t—  ']) {
    assert.deepEqual(splitTrackTitle(`  Artist${separator}Title - Remix  `), {
      artist: 'Artist', title: 'Title - Remix',
    });
  }
  assert.deepEqual(splitTrackTitle('AC-DC - Title-with-dashes'), { artist: 'AC-DC', title: 'Title-with-dashes' });
  assert.deepEqual(splitTrackTitle('No separator'), { artist: '', title: 'No separator' });
  assert.deepEqual(splitTrackTitle('Artist-Title'), { artist: '', title: 'Artist-Title' });
  assert.deepEqual(splitTrackTitle(null), { artist: '', title: '' });
});

test('presentation preserves Unicode, combining marks and HTML-looking text verbatim', () => {
  assert.deepEqual(splitTrackTitle('AIKON, PÔNGO — Jóga 👩🏽‍🚀'), {
    artist: 'AIKON, PÔNGO', title: 'Jóga 👩🏽‍🚀',
  });
  assert.deepEqual(splitTrackTitle('<script>x</script> - <b>Title</b>'), {
    artist: '<script>x</script>', title: '<b>Title</b>',
  });
});

test('active track changes exactly on a start and retains the last entry', () => {
  assert.equal(activeTrackIndex(entries, -1), -1);
  assert.equal(activeTrackIndex(entries, 4.999), -1);
  assert.equal(activeTrackIndex(entries, 5), 0);
  assert.equal(activeTrackIndex(entries, 19.999), 0);
  assert.equal(activeTrackIndex(entries, 20), 1);
  assert.equal(activeTrackIndex(entries, 60), 2);
  assert.equal(activeTrackIndex(entries, 999999), 2);
  assert.equal(activeTrackIndex(entries, Infinity), 2);
  assert.equal(activeTrackIndex(entries, NaN), -1);
  assert.equal(activeTrackIndex([], 10), -1);
});

test('six-second transition erases, clears for half a second, then reveals', () => {
  const cases = [
    [4.999, -1, 'empty', -1, 0],
    [5, 0, 'empty', -1, 0],
    [5.25, 0, 'reveal', 0, 0],
    [6.625, 0, 'reveal', 0, 0.5],
    [8, 0, 'hold', 0, 1],
    [17, 0, 'erase', 0, 0],
    [18.375, 0, 'erase', 0, 0.5],
    [19.75, 0, 'empty', -1, 0],
    [20, 1, 'empty', -1, 0],
    [20.25, 1, 'reveal', 1, 0],
    [21.625, 1, 'reveal', 1, 0.5],
    [23, 1, 'hold', 1, 1],
    [100, 2, 'hold', 2, 1],
  ];
  for (const [time, activeIndex, phase, displayIndex, progress] of cases) {
    const sample = sampleTrackTransition(entries, time);
    assert.deepEqual({ ...sample, seed: 0 }, { activeIndex, phase, displayIndex, progress, seed: 0 }, `time=${time}`);
    assert.ok(Number.isSafeInteger(sample.seed));
  }
});

test('empty setlists and invalid audio time render no text', () => {
  for (const [list, time] of [[[], 0], [entries, NaN], [entries, -Infinity]]) {
    const transition = sampleTrackTransition(list, time);
    assert.equal(transition.activeIndex, -1);
    assert.equal(transition.displayIndex, -1);
    assert.equal(transition.phase, 'empty');
    assert.equal(animatedTrackText('Nothing', transition), '');
  }
});

test('duration is clamped to 1–10 seconds with a six-second nonfinite fallback', () => {
  for (const [duration, expected] of [[-10, 1], [0, 1], [100, 10], [NaN, 6], [Infinity, 6]]) {
    for (const time of [17, 19, 19.9, 20.25, 20.4, 22, 24.9, 25]) {
      assert.deepEqual(sampleTrackTransition(entries, time, { duration }), sampleTrackTransition(entries, time, { duration: expected }));
    }
  }
});

test('close track starts share phase midpoints without incomplete text jumps', () => {
  const short = parseSetlist('00:00 First\n00:01 Second\n00:02 Third').entries;
  assert.equal(sampleTrackTransition(short, 0.25).phase, 'reveal');
  assert.equal(sampleTrackTransition(short, 0.375).progress, 0.5);
  assert.equal(sampleTrackTransition(short, 0.5).phase, 'erase');
  assert.equal(sampleTrackTransition(short, 0.5).progress, 0);
  assert.equal(animatedTrackText('First', sampleTrackTransition(short, 0.5)), 'First');
  assert.equal(sampleTrackTransition(short, 0.625).progress, 0.5);
  assert.equal(sampleTrackTransition(short, 0.75).phase, 'empty');
  assert.equal(sampleTrackTransition(short, 1.25).phase, 'reveal');
  assert.equal(sampleTrackTransition(short, 1.5).progress, 0);
  assert.equal(sampleTrackTransition(short, 2.25).phase, 'reveal');
  assert.equal(sampleTrackTransition(short, 5).phase, 'hold');

  const fractional = [{ time: 0, title: 'One' }, { time: 0.1, title: 'Two' }, { time: 0.2, title: 'Three' }];
  for (let time = 0; time < 0.45; time += 0.01) {
    assert.equal(sampleTrackTransition(fractional, time).phase, 'empty');
  }
  assert.equal(sampleTrackTransition(fractional, 0.45).phase, 'reveal');
});

test('text animation reveals prefixes and erases right to left with stable endpoints', () => {
  const base = { seed: 123, activeIndex: 0, displayIndex: 0 };
  const reveal = progress => animatedTrackText('ABCDEFGH', { ...base, phase: 'reveal', progress });
  const erase = progress => animatedTrackText('ABCDEFGH', { ...base, phase: 'erase', progress });
  assert.equal(reveal(0), '');
  assert.equal(reveal(1), 'ABCDEFGH');
  assert.equal(erase(0), 'ABCDEFGH');
  assert.equal(erase(1), '');
  assert.equal(reveal(0.5).length, 4);
  assert.equal(reveal(0.5).slice(0, -1), 'ABC');
  assert.equal(erase(0.5), reveal(0.5));
  assert.equal(animatedTrackText('ABCDEFGH', { ...base, phase: 'hold', progress: 0 }), 'ABCDEFGH');
  assert.equal(animatedTrackText('ABCDEFGH', { ...base, phase: 'empty', progress: 1 }), '');
});

test('text prefixes never split grapheme clusters and keep existing whitespace', () => {
  const transition = { phase: 'reveal', progress: 0.75, seed: 42 };
  const rendered = animatedTrackText('👩🏽‍🚀éXY', transition);
  assert.match(rendered, /^👩🏽‍🚀é[A-Z0-9]$/u);
  const whitespace = animatedTrackText('A  BC', { ...transition, progress: 0.6 });
  assert.match(whitespace, /^[A-Z0-9]  $/u);
  assert.equal(animatedTrackText('   ', { ...transition, progress: 0.5 }), '  ');
  assert.equal(animatedTrackText('', transition), '');
});

test('animation is reproducible across repeated sampling, pause and backward seeks', () => {
  const render = time => {
    const transition = sampleTrackTransition(entries, time);
    return { transition, text: animatedTrackText(entries[transition.displayIndex]?.title, transition) };
  };
  const initial = render(21.5);
  render(59.5);
  render(0);
  assert.deepEqual(render(21.5), initial);
  assert.deepEqual(render(21.5), initial);
  assert.equal(sampleTrackTransition(entries, 21.501).seed, sampleTrackTransition(entries, 21.502).seed);
  assert.notEqual(sampleTrackTransition(entries, 21.5).seed, sampleTrackTransition(entries, 21.6).seed);
  assert.notEqual(sampleTrackTransition([{ time: 20, title: 'Different' }], 21.5).seed, initial.transition.seed);
});

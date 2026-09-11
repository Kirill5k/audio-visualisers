import assert from 'node:assert/strict';
import test from 'node:test';
import { writeChoreography } from '../js/led-grid/led-choreography-pattern.js';

const settings = { gain: 1.3, persistence: 1 };
const sum = values => values.reduce((total, value, index) => total + (index % 4 === 0 ? value : 0), 0);
const lit = values => values.reduce((total, value, index) => total + (index % 4 === 0 && value > .085 ? 1 : 0), 0);
const fixture = (strength = .65) => ({ time: 12,
  bands: Float32Array.from({ length: 96 }, (_, index) => strength * (.25 + .75 * Math.sin(index * .17) ** 2)),
  features: { energy: strength, bass: strength * .9, mids: strength * .8, highs: strength * .6,
    width: .65, balance: -.2, onsets: [0, 0, 0] },
  events: [{ time: 11.5, band: 0, strength: strength * .55, balance: -.2 }],
});

test('Choreography: silence and muted gain cannot invent graphic motion', () => {
  for (const time of [0, .5, 6, 90, 900]) assert.equal(sum(writeChoreography({ time }, settings)), 0);
  assert.equal(sum(writeChoreography(fixture(), { ...settings, gain: 0 })), 0);
});

test('Choreography: exact-time output survives seeking, reuse and reordered events', () => {
  const frame = fixture();
  frame.events.push({ time: 10.9, band: 1, strength: .7 }, { time: 11.6, band: 0, strength: .8 });
  const expected = writeChoreography(frame, settings);
  const reusable = new Float32Array(96 * 54 * 4);
  for (const time of [100, 0, 2, 18, 4]) writeChoreography({ ...frame, time }, settings, reusable);
  assert.deepEqual(writeChoreography({ ...frame, events: frame.events.slice().reverse() }, settings, reusable), expected);
});

test('Choreography: future events are ignored and held envelopes do not free-run', () => {
  const frame = { ...fixture(), events: [] };
  const current = writeChoreography(frame, settings);
  assert.deepEqual(writeChoreography({ ...frame, time: 180 }, settings), current);
  assert.deepEqual(writeChoreography({ ...frame, events: [{ time: 12.001, band: 0, strength: 1 }] }, settings), current);
});

test('Choreography: every spectral interval contributes to visible geometry', () => {
  for (let band = 0; band < 96; band++) {
    const bands = new Float32Array(96); bands[band] = .85;
    assert.ok(sum(writeChoreography({ bands }, settings)) > 0, `Band ${band} was lost`);
  }
});

test('Choreography: all three transient bands produce prompt contrast', () => {
  const frame = { ...fixture(.45), events: [] };
  const steady = sum(writeChoreography(frame, settings));
  for (const band of [0, 1, 2]) {
    const hit = sum(writeChoreography({ ...frame,
      events: [{ time: frame.time, band, strength: .7 }] }, settings));
    assert.ok(hit > steady * 1.25, `Band ${band} should visibly answer an attack`);
  }
});

test('Choreography: quiet passages retain dark space and loud passages expand coverage', () => {
  const quiet = writeChoreography(fixture(.06), settings), dense = writeChoreography(fixture(.78), settings);
  assert.ok(sum(dense) > sum(quiet) * 8);
  assert.ok(lit(dense) > lit(quiet) * 2);
  assert.ok(lit(dense) < 96 * 54 * .50, 'Large negative spaces must survive dense music');
});

test('Choreography: strong highlights remain confined to a few musical corners', () => {
  const frame = fixture(.8);
  frame.events.push({ time: frame.time, band: 2, strength: 1 });
  const values = writeChoreography(frame, settings);
  const white = values.reduce((total, value, index) => total + (index % 4 === 3 && value > .2 ? 1 : 0), 0);
  assert.ok(white > 0 && white < 90, 'White should accent vertices, never bleach the whole symbol');
});

test('Choreography: bounded finite output covers every LED under extreme settings', () => {
  for (const gain of [0, 1.3, 5, Infinity, NaN]) for (const persistence of [.15, 1, 3]) {
    const values = writeChoreography({ ...fixture(1), features: { bass: Infinity, mids: NaN, highs: 2,
      energy: 1, width: 8, balance: -10, onsets: [1, Infinity, NaN] },
      events: [{ time: NaN, band: 0, strength: 1 }, { time: -1, band: 0, strength: 1 }] }, { gain, persistence });
    assert.equal(values.length, 96 * 54 * 4);
    for (let index = 0; index < values.length; index++) {
      assert.ok(Number.isFinite(values[index]));
      assert.ok(values[index] >= 0 && values[index] <= (index % 4 === 0 ? 5 : 1));
    }
  }
});

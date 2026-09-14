import assert from 'node:assert/strict';
import test from 'node:test';
import { createLEDPresentationClock } from '../js/led-grid/led-presentation-clock.js';

const quantum = (time, seconds) => Math.floor(time / seconds + 1e-8) * seconds;
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;

for (const hz of [60, 120]) for (const block of [128, 256, 1024]) {
  test(`Loom clock: ${hz} Hz scroll stays even with ${block}-sample audio updates`, () => {
    const clock = createLEDPresentationClock(), dt = 1 / hz, step = block / 48000;
    let previous = clock.sample(0, 0, 20), previousAudio = 0, repeated = 0;
    const displayErrors = [], audioErrors = [];
    for (let frame = 1; frame <= hz * 10; frame++) {
      const ideal = frame * dt, audio = quantum(ideal, step);
      const displayed = clock.sample(audio, ideal * 1000, 20);
      assert.ok(displayed >= previous, 'Stepped or repeated audio reads must not reverse scrolling');
      assert.ok(Math.abs(displayed - ideal) <= step + .001, 'The smoother must remain synchronized to audio');
      if (frame > hz) {
        displayErrors.push(Math.abs(displayed - previous - dt));
        audioErrors.push(Math.abs(audio - previousAudio - dt));
      }
      if (audio === previousAudio) repeated++;
      previous = displayed; previousAudio = audio;
    }
    assert.ok(mean(displayErrors) < mean(audioErrors) * .1, 'Audio quantum timing error should fall by at least 90%');
    if (block === 1024) assert.ok(repeated > 0, 'Exercise repeated audio readings without skipped visual frames');
  });
}

test('Loom clock: long playback follows slow audio-device drift without accumulating an offset', () => {
  for (const rate of [.999, 1.001]) {
    const clock = createLEDPresentationClock(), step = 256 / 48000;
    let largestLateError = 0;
    for (let frame = 0; frame <= 120 * 180; frame++) {
      const now = frame / 120, actual = 4 + now * rate;
      const displayed = clock.sample(quantum(actual, step), now * 1000, 240);
      if (now > 30) largestLateError = Math.max(largestLateError, Math.abs(displayed - actual));
    }
    assert.ok(largestLateError < .008, `Clock drift left a ${largestLateError}s offset`);
  }
});

test('Loom clock: real RAF variation advances by elapsed time, not a fixed assumed frame rate', () => {
  const clock = createLEDPresentationClock();
  let now = 0;
  clock.sample(10, now, 100);
  for (const dt of [.008, .009, .007, .016, .008, .024, .008, .009, .007]) {
    now += dt * 1000;
    assert.ok(Math.abs(clock.sample(10 + now / 1000, now, 100) - (10 + now / 1000)) < 1e-12);
  }
});

test('Loom clock: transport reset anchors arbitrary seeks and replay exactly', () => {
  const clock = createLEDPresentationClock();
  clock.sample(92, 1000, 300);
  clock.sample(92.005333, 1008.333333, 300);
  for (const target of [8, 264, 0, 91.2345]) {
    clock.reset();
    assert.equal(clock.sample(target, 2000, 300), target);
    assert.ok(Math.abs(clock.sample(target + .01, 2010, 300) - target - .01) < 1e-12);
  }
});

test('Loom clock: paused or suspended audio never acquires wall-clock motion', () => {
  const clock = createLEDPresentationClock();
  clock.sample(7, 0, 30);
  clock.sample(7.005333, 8.333333, 30);
  assert.equal(clock.sample(7.005333, 16.666667, 30, { running: false }), 7.005333);
  assert.equal(clock.sample(7.005333, 60000, 30, { running: false }), 7.005333);
  assert.equal(clock.sample(7.005333, 61000, 30), 7.005333);
});

test('Loom clock: returning from a hidden tab re-anchors rather than extrapolating stale time', () => {
  const clock = createLEDPresentationClock();
  clock.sample(10, 0, 100);
  assert.equal(clock.sample(15.001, 5000, 100), 15.001);
  assert.equal(clock.sample(15.1, 1, 100), 15.1, 'A replaced RAF time origin must also re-anchor');
});

test('Loom clock: unexpected large transport changes are not slowly chased', () => {
  const clock = createLEDPresentationClock();
  clock.sample(20, 0, 100);
  assert.equal(clock.sample(30, 16, 100), 30);
  assert.equal(clock.sample(3, 32, 100), 3);
});

test('Loom clock: endpoints and repeated RAF timestamps remain bounded', () => {
  const clock = createLEDPresentationClock();
  assert.equal(clock.sample(-2, 0, 1), 0);
  assert.equal(clock.sample(0, 0, 1), 0);
  clock.reset();
  clock.sample(.998, 0, 1);
  assert.equal(clock.sample(.998, 8, 1), 1);
  assert.equal(clock.sample(1.2, 16, 1), 1);
  assert.equal(clock.sample(.999, 16, .999), .999, 'A changed duration also bounds an unchanged RAF timestamp');
  clock.reset();
  assert.equal(clock.sample(20, 40, 0), 0);
});

test('Loom clock: invalid inputs are rejected instead of poisoning future animation', () => {
  const clock = createLEDPresentationClock();
  for (const args of [[NaN, 0, 2], [0, Infinity, 2], [0, 0, NaN], [0, 0, -1]]) {
    assert.throws(() => clock.sample(...args), RangeError);
  }
  assert.equal(clock.sample(1, 0, 2), 1);
});

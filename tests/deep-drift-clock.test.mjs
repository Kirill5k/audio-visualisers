import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepDriftClock } from '../js/starfield/deep-drift-clock.js';

for (const hz of [30, 60, 120, 144]) {
  test(`Deep Drift presents continuous motion at ${hz} Hz without repeating canonical steps`, () => {
    const clock = createDeepDriftClock();
    let previous = 0, canonical = -1, steps = 0, error = 0;
    for (let frame = 0; frame <= hz * 12; frame++) {
      const actual = frame / hz;
      const observed = Math.floor(actual / (256 / 48000) + 1e-8) * (256 / 48000);
      const presented = clock.sample(observed, actual * 1000, 30);
      assert.ok(presented >= previous);
      assert.ok(Math.abs(presented - actual) < .007);
      if (frame > hz) error += Math.abs(presented - previous - 1 / hz);
      while (canonical < Math.floor(observed * 60)) {canonical++; steps++;}
      assert.equal(steps, Math.floor(observed * 60) + 1);
      previous = presented;
    }
    assert.ok(error / (11 * hz) < .0003, 'Clock correction must not introduce visible stepping');
  });
}

test('transport changes, a hidden tab and suspended playback re-anchor', () => {
  const clock = createDeepDriftClock();
  clock.sample(20, 0, 120);
  assert.equal(clock.sample(40, 5000, 120), 40);
  assert.equal(clock.sample(40, 6000, 120, {running: false}), 40);
  assert.equal(clock.sample(40, 7000, 120), 40);
  clock.reset();
  assert.equal(clock.sample(4.375, 7010, 120), 4.375);
  clock.reset();
  assert.equal(clock.sample(0, 7020, 120), 0);
});

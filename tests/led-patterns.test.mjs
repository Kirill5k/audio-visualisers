import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLEDPattern, LED_COLUMNS, LED_ROWS, LED_COUNT } from '../js/led-grid/led-patterns.js';

const modes = ['loom', 'calligraphy', 'choreography'];
const settings = mode => ({ mode, gain: 1.3, persistence: 1 });
const frame = (level = .6) => {
  const data = {
  time: 4,
  bands: Float32Array.from({ length: LED_COLUMNS }, (_, i) => level * (.28 + .7 * Math.sin(i * .14) ** 2)),
  history: Float32Array.from({ length: LED_COUNT }, (_, i) => level * (.15 + .8 * Math.sin(i * .014) ** 2)),
  features: { bass: level, mids: level * .75, highs: level * .6, energy: level, width: .55, balance: -.15, onsets: new Float32Array(3) },
  events: [{ time: 3.4, band: 0, strength: level * .5, balance: -.2 }, { time: 3.8, band: 1, strength: level * .4 }, { time: 3.97, band: 2, strength: level * .5 }],
  };
  data.waveform = { frames: [0, 1/30, 2/30].map(age => ({
    age, time: data.time - age,
    left: Float32Array.from({ length: 193 }, (_, i) => level * Math.sin(i * .075)),
    right: Float32Array.from({ length: 193 }, (_, i) => level * Math.sin(i * .075 + .4)),
    rmsLeft: level * .707, rmsRight: level * .707, peakLeft: level, peakRight: level,
  })) };
  data.flowFrames = Array.from({ length: 20 }, (_, index) => ({
    time: (index + 1) / 5, bands: data.bands.slice(), features: { ...data.features },
  }));
  return data;
};
const energy = values => values.reduce((sum, value, index) => sum + (index % 4 === 0 ? value : 0), 0);

for (const mode of modes) {
  test(`${mode}: silence is exactly dark at every absolute time`, () => {
    for (const time of [0, .2, 6, 60, 3600]) {
      const result = evaluateLEDPattern({ time }, settings(mode));
      assert.equal(result.maxIntensity, 0);
      assert.equal(result.litCoverage, 0);
      assert.equal(energy(result.values), 0, 'No autonomous pattern may invent illumination');
    }
  });

  test(`${mode}: seek order and prior modes cannot affect an exact frame`, () => {
    const data = frame();
    const expected = evaluateLEDPattern(data, settings(mode)).values.slice();
    const reusable = new Float32Array(LED_COUNT * 4);
    for (const time of [180, .2, 12, 0, 3600]) {
      for (const other of modes) evaluateLEDPattern({ ...data, time }, settings(other), reusable);
    }
    assert.deepEqual(evaluateLEDPattern(data, settings(mode), reusable).values, expected);
  });

  test(`${mode}: fixed cell count and finite bounded illumination survive extremes`, () => {
    assert.equal(LED_COLUMNS, 96);
    assert.equal(LED_ROWS, 54);
    assert.equal(LED_COUNT, 5184);
    for (const gain of [0, 1.3, 5]) for (const persistence of [.15, 1, 3]) {
      const result = evaluateLEDPattern(frame(1), { mode, gain, persistence });
      assert.equal(result.values.length, 5184 * 4);
      for (let i = 0; i < result.values.length; i++) {
        assert.ok(Number.isFinite(result.values[i]));
        assert.ok(result.values[i] >= 0 && result.values[i] <= (i % 4 === 0 ? 5 : 1));
      }
      if (gain === 0) assert.equal(energy(result.values), 0);
    }
  });

  test(`${mode}: quiet passages preserve dynamic contrast`, () => {
    const quiet = evaluateLEDPattern(frame(.06), settings(mode));
    const loud = evaluateLEDPattern(frame(.75), settings(mode));
    assert.ok(loud.meanIntensity > quiet.meanIntensity * 4, 'Loudness must increase emitted energy without continuous normalization');
    assert.ok(loud.litCoverage > quiet.litCoverage, 'Activity should occupy more cells as the music builds');
  });
}

test('Loom: every frequency column can illuminate the oldest retained history row', () => {
  for (const column of [0, 24, 66, 95]) {
    const history = new Float32Array(LED_COUNT);
    history[(LED_ROWS - 1) * LED_COLUMNS + column] = 1;
    const result = evaluateLEDPattern({ history }, settings('loom'));
    assert.ok(result.values[((LED_ROWS - 1) * LED_COLUMNS + column) * 4] > 0);
    assert.equal(Array.from(result.values).filter((value, i) => i % 4 === 0 && value > 0).length, 1);
  }
});

test('Loom: live bands and onsets cannot add a separate contour to the history', () => {
  const data = frame(.6);
  const original = evaluateLEDPattern(data, settings('loom')).values.slice();
  data.bands.fill(1);
  data.features = { bass: 1, mids: 1, highs: 1, energy: 1, balance: 1, width: 1 };
  data.events = [{ time: data.time, band: 0, strength: 1 }, { time: data.time, band: 2, strength: 1 }];
  assert.deepEqual(evaluateLEDPattern(data, settings('loom')).values, original);
});

test('Loom: warm peaks move up with their history instead of remaining in a live region', () => {
  const history = new Float32Array(LED_COUNT);
  history[7 * LED_COLUMNS + 30] = .95;
  const first = evaluateLEDPattern({ history }, settings('loom')).values;
  assert.ok(first[(7 * LED_COLUMNS + 30) * 4 + 2] > .8);
  const shifted = new Float32Array(LED_COUNT);
  shifted.set(history.subarray(0, LED_COUNT - 5 * LED_COLUMNS), 5 * LED_COLUMNS);
  const next = evaluateLEDPattern({ history: shifted }, settings('loom')).values;
  assert.equal(next[(7 * LED_COLUMNS + 30) * 4], 0);
  assert.ok(next[(12 * LED_COLUMNS + 30) * 4] > 0);
  assert.ok(next[(12 * LED_COLUMNS + 30) * 4 + 2] > .8);
  assert.equal(Array.from(next).filter((v, i) => i % 4 === 0 && v > 0).length, 1);
});

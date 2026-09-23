import test from 'node:test';
import assert from 'node:assert/strict';
import { RESPONSE_PRESETS, DEFAULT_RESPONSE_SETTINGS, createDeepDriftResponseTimeline, saveResponseTransition, restoreResponseTransition } from '../js/starfield/deep-drift-response.js';

const scalarKeys = ['bass', 'mids', 'highs', 'energy', 'kick', 'breath', 'accent'];
const silent = () => ({ bass: 0, mids: 0, highs: 0, energy: 0, kick: 0, rms: 0,
  levels: new Float32Array(32), onsets: new Float32Array(32) });
const signal = (overrides = {}) => ({ ...silent(), rms: .1, ...overrides });
const timeline = (frames, source, settings = {}) => createDeepDriftResponseTimeline({ frameCount: frames,
  getFeatureFrame: frame => ({ features: source(frame), frame }), settings });
const snapshot = frame => ({ ...frame, levels: [...frame.levels], onsets: [...frame.onsets] });

test('capture freezes a partially completed preset fade across a long export', () => {
  const source = signal({ bass: .37, levels: new Float32Array(32).fill(.45) });
  const transition = { from: source, start: 1000 };
  const saved = saveResponseTransition(transition, 1180);
  source.levels.fill(0);
  const restored = restoreResponseTransition(saved, 90000);
  assert.equal(90000 - restored.start, 180, 'Export time must not advance the 450 ms fade');
  assert.ok(Math.abs(restored.from.levels[0] - .45) < 1e-7, 'Capture owns its response snapshot');
  restored.from.levels.fill(1);
  assert.ok(saved.from.levels[0] < .5, 'Restoring must not alias the saved snapshot');
  assert.equal(saveResponseTransition(null, 1000), null);
  assert.equal(restoreResponseTransition(null, 90000), null);
});

test('silence stays silent, including malformed numerical inputs', () => {
  const response = timeline(120, () => signal({ rms: 0, bass: 1, kick: 1,
    levels: new Float32Array(32).fill(1), onsets: new Float32Array(32).fill(1) }));
  for (const time of [0, .123, 1, 2]) {
    const frame = response.sample(time);
    for (const key of scalarKeys) assert.equal(frame[key], 0, key);
    assert.equal(frame.accentTrigger, 0);
    assert.ok(frame.levels.every(value => value === 0));
    assert.ok(frame.onsets.every(value => value === 0));
  }
  const invalid = timeline(10, () => signal({ bass: Infinity, mids: NaN, highs: -2 }), { gain: NaN });
  for (const key of scalarKeys) assert.ok(Number.isFinite(invalid.sample(.1)[key]));
});

test('gain and focused controls remain soft bounded, with no second gain application', () => {
  const source = () => signal({ bass: 1, mids: 1, highs: 1, energy: 1, kick: 1,
    levels: new Float32Array(32).fill(1), onsets: new Float32Array(32).fill(1) });
  const response = timeline(600, source, { gain: 3, bassMotion: 3, midFlow: 3, trebleShimmer: 3, pulse: 3 });
  for (let i = 0; i < 600; i++) {
    const frame = response.sample(i / 60);
    for (const key of [...scalarKeys, 'accentTrigger']) assert.ok(frame[key] >= 0 && frame[key] <= 1, key);
    assert.ok(frame.levels.every(value => value >= 0 && value <= 1));
    assert.ok(frame.onsets.every(value => value >= 0 && value <= 1));
  }
  const muted = timeline(120, source, { gain: 0 }).sample(1);
  for (const key of scalarKeys) assert.equal(muted[key], 0, key);
  const low = timeline(600, source, { gain: .5, bassMotion: 1 }).sample(9).bass;
  const high = timeline(600, source, { gain: 1, bassMotion: 1 }).sample(9).bass;
  assert.ok(high > low && high < low * 2, 'Soft saturation should reduce the incremental gain');
});

test('bass, mids and treble keep distinct frequency responses and focused amounts', () => {
  for (const [key, band, amount] of [['bass', 3, 'bassMotion'], ['mids', 17, 'midFlow'], ['highs', 28, 'trebleShimmer']]) {
    const source = () => { const levels = new Float32Array(32); levels[band] = 1; return signal({ [key]: 1, levels }); };
    const frame = timeline(300, source).sample(4);
    assert.ok(frame[key] > .5, key);
    for (const other of ['bass', 'mids', 'highs'].filter(other => other !== key)) assert.equal(frame[other], 0);
    assert.ok(frame.levels[band] > .5);
    assert.equal(timeline(300, source, { [amount]: 0 }).sample(4)[key], 0);
  }
});

test('shape opens more slowly than illumination and releases smoothly into silence', () => {
  const response = timeline(600, frame => frame >= 30 && frame < 120
    ? signal({ bass: 1, energy: 1, levels: new Float32Array(32).fill(1) }) : silent(), { gain: 1, bassMotion: 1 });
  assert.ok(response.sample(31 / 60).energy > response.sample(31 / 60).bass);
  const before = response.sample(119 / 60), after = response.sample(120 / 60);
  assert.ok(after.bass > before.bass * .95, 'Silence must not collapse the shape');
  assert.ok(after.energy > 0 && after.energy < before.energy);
  assert.ok(response.sample(4).bass > response.sample(4).energy, 'Shape should have a longer release than light');
  assert.ok(response.sample(9).bass < .001);
  const immediate = timeline(120, () => signal({ bass: 1 }), { smoothness: .5 }).sample(3 / 60).bass;
  const smooth = timeline(120, () => signal({ bass: 1 }), { smoothness: 2 }).sample(3 / 60).bass;
  assert.ok(smooth < immediate);
});

test('accents require stronger actual onsets and have a minimum 15-frame gap', () => {
  const response = timeline(120, frame => {
    const onsets = new Float32Array(32); if (frame % 3 === 0) onsets[18] = .8;
    return signal({ onsets, energy: .8 });
  });
  const events = [];
  for (let frame = 0; frame < 120; frame++) {
    const value = response.sample(frame / 60);
    if (value.accentTrigger > 0) { events.push(frame); assert.equal(value.accentBand, 18); }
    assert.equal(response.sample((frame + .25) / 60).accentTrigger, 0);
  }
  assert.ok(events.length >= 4);
  for (let i = 1; i < events.length; i++) assert.ok(events[i] - events[i - 1] >= 15);
  const sustained = timeline(120, () => signal({ onsets: new Float32Array(32).fill(.8) }));
  assert.equal(Array.from({ length: 120 }, (_, i) => sustained.sample(i / 60).accentTrigger).filter(Boolean).length, 1);
  const weak = timeline(120, () => signal({ onsets: new Float32Array(32).fill(.05), kick: 1, energy: 1 }));
  assert.equal(weak.sample(0).accentTrigger, 0, 'Loudness and a kick envelope cannot fabricate an onset');
});

test('continuous accent envelopes neither pre-flash nor snap on their trigger frame', () => {
  const response = timeline(90, frame => {
    const onsets = new Float32Array(32); if (frame === 30) onsets[2] = 1;
    return signal({ onsets });
  });
  assert.equal(response.sample(29.9 / 60).accent, 0);
  assert.equal(response.sample(.5).accent, 0);
  assert.ok(response.sample(.5).accentTrigger > 0);
  assert.ok(response.sample(.6).accent > 0);
  assert.ok(response.sample(1.4).accent < response.sample(.7).accent);
});

test('arbitrary sampling, replay and fractional frames are deterministic without consuming events', () => {
  const source = frame => { const levels = new Float32Array(32).fill((frame % 60) / 60);
    const onsets = new Float32Array(32); if (frame % 24 === 0) onsets[frame % 32] = .8;
    return signal({ bass: frame % 17 / 17, mids: frame % 23 / 23, highs: frame % 31 / 31, levels, onsets }); };
  const response = timeline(720, source), rebuilt = timeline(720, source);
  const expected = snapshot(response.sample(9.123));
  for (const time of [11, 0, 2, 9.123, 6, 1, 9.123]) response.sample(time);
  assert.deepEqual(snapshot(response.sample(9.123)), expected);
  assert.deepEqual(snapshot(rebuilt.sample(9.123)), expected);
  const left = response.sample(37 / 60), right = response.sample(38 / 60), middle = response.sample(37.5 / 60);
  for (const key of scalarKeys) assert.ok(Math.abs(middle[key] - (left[key] + right[key]) / 2) < 1e-7, key);
  const output = response.sample(1), levels = output.levels, onsets = output.onsets;
  assert.equal(response.sample(2, output), output);
  assert.equal(output.levels, levels); assert.equal(output.onsets, onsets);
});

test('three distinct presets default to Fluid without sharing mutable settings', () => {
  assert.deepEqual(Object.keys(RESPONSE_PRESETS), ['cinematic', 'fluid', 'energetic']);
  assert.deepEqual(DEFAULT_RESPONSE_SETTINGS, RESPONSE_PRESETS.fluid.values);
  assert.equal(new Set(Object.values(RESPONSE_PRESETS).map(preset => JSON.stringify(preset.values))).size, 3);
  for (const preset of Object.values(RESPONSE_PRESETS)) {
    assert.ok(preset.label);
    assert.ok(Object.isFrozen(preset.values));
  }
});

test('empty timelines sample silence, endpoints clamp and invalid times are rejected', () => {
  const empty = timeline(0, () => { throw new Error('Empty timelines must not read frames'); });
  assert.equal(empty.frameCount, 0);
  assert.equal(empty.sample(2).bass, 0);
  const response = timeline(120, () => signal({ bass: 1 }));
  assert.deepEqual(snapshot(response.sample(-2)), snapshot(response.sample(0)));
  assert.deepEqual(snapshot(response.sample(100)), snapshot(response.sample(119 / 60)));
  assert.throws(() => response.sample(NaN), RangeError);
  assert.throws(() => createDeepDriftResponseTimeline({ frameCount: -1, getFeatureFrame() {} }), RangeError);
});

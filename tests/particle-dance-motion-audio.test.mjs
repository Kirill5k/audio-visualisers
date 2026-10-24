import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticleMotionAudio } from '../js/particle-dance/particle-dance-motion-audio.js';

const dt = 1 / 60;
const blank = () => new Uint8Array(1024);
function band(low, high, level = 220, rate = 48000) {
  const data = blank();
  data.fill(level, Math.ceil(low * data.length / (rate / 2)), Math.ceil(high * data.length / (rate / 2)));
  return data;
}
function frame(analyser, data, step = dt, rate = 48000) {
  return analyser.update(data, step, { onsetSpectrum: data, sampleRate: rate });
}
function advance(analyser, data, seconds) {
  let result;
  for (let i = 0; i < Math.round(seconds / dt); i++) result = frame(analyser, data);
  return result;
}

test('raw FFT uses physical frequency bands at different sample rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const [key, low, high] of [['bass', 35, 220], ['mid', 250, 4000], ['high', 4000, 12000]]) {
      const analyser = createParticleMotionAudio();
      frame(analyser, blank(), dt, rate);
      for (let i = 0; i < 120; i++) frame(analyser, band(low, high, 220, rate), dt, rate);
      const actual = frame(analyser, band(low, high, 220, rate), dt, rate);
      assert.ok(actual[key] > .8, `${key} at ${rate} Hz`);
      for (const other of ['bass', 'mid', 'high'].filter(name => name !== key)) assert.ok(actual[other] < .001, other);
    }
  }
});

test('first frame and sustained tones do not repeatedly create transients', () => {
  const analyser = createParticleMotionAudio();
  const tone = band(35, 220);
  let result = frame(analyser, tone);
  assert.equal(result.kick, 0);
  assert.equal(result.percussion, 0);
  for (let i = 0; i < 300; i++) {
    result = frame(analyser, tone);
    assert.equal(result.kick, 0);
    assert.equal(result.percussion, 0);
    assert.equal(result.hat, 0);
    assert.equal(result.release, 0);
  }
});

test('bass, percussion and high bursts create distinct one-frame events', () => {
  for (const [key, low, high] of [['kick', 35, 220], ['percussion', 250, 4000], ['hat', 4000, 12000]]) {
    const analyser = createParticleMotionAudio();
    advance(analyser, blank(), 1);
    for (let pulse = 0; pulse < 5; pulse++) {
      const attack = { ...frame(analyser, band(low, high)) };
      assert.ok(attack[key] > .2, `${key} pulse ${pulse}`);
      if (key === 'hat') assert.equal(attack.kick, 0);
      if (key === 'kick') assert.equal(attack.hat, 0);
      const sustain = frame(analyser, band(low, high));
      assert.equal(sustain[key], 0);
      advance(analyser, blank(), .35);
    }
  }
});

test('small FFT noise does not create transients and silence decays all envelopes', () => {
  const analyser = createParticleMotionAudio();
  advance(analyser, new Uint8Array(1024).fill(200), 4);
  for (let i = 0; i < 300; i++) {
    const result = frame(analyser, new Uint8Array(1024).fill(i % 2 ? 3 : 0));
    for (const event of ['kick', 'percussion', 'hat', 'release']) assert.equal(result[event], 0);
  }
  const result = advance(analyser, blank(), 40);
  for (const value of Object.values(result)) assert.ok(value < .0001);
});

test('phrase follows several seconds of energy and release fires once at a drop arrival', () => {
  const analyser = createParticleMotionAudio();
  advance(analyser, blank(), 1);
  const loud = new Uint8Array(1024).fill(220);
  const drop = { ...frame(analyser, loud) };
  assert.ok(drop.release > .2);
  assert.ok(drop.phrase < .05, 'phrase should not jump on one beat');
  for (let i = 0; i < 120; i++) assert.equal(frame(analyser, loud).release, 0);
  assert.ok(frame(analyser, loud).phrase > .4);
  advance(analyser, blank(), 3);
  assert.ok(frame(analyser, loud).release > .2, 'a later quiet section can rearm the release');
});

test('paused updates are inert and reset replays exactly with one reused result object', () => {
  const analyser = createParticleMotionAudio();
  const zero = blank(), low = band(35, 220), high = band(4000, 12000);
  const inputs = Array.from({ length: 180 }, (_, i) => i % 35 === 1 ? low : i % 35 === 10 ? high : zero);
  const replay = () => inputs.map(data => ({ ...frame(analyser, data) }));
  const firstResult = frame(analyser, zero);
  const beforePause = { ...firstResult };
  assert.equal(frame(analyser, low, 0), firstResult);
  assert.deepEqual(firstResult, beforePause);
  analyser.reset();
  const first = replay();
  analyser.reset();
  assert.deepEqual(replay(), first);
  assert.equal(frame(analyser, zero), firstResult);
});

test('normalized display spectrum fallback retains band separation', () => {
  const analyser = createParticleMotionAudio();
  const spectrum = new Uint8Array(100);
  analyser.update(spectrum);
  spectrum.fill(240, 55);
  const result = analyser.update(spectrum);
  assert.ok(result.hat > .2);
  assert.equal(result.kick, 0);
  assert.equal(result.bass, 0);
});

test('cooldowns reject FFT chatter while allowing the next musical attack', () => {
  const analyser = createParticleMotionAudio(), silence = blank(), bass = band(35, 220);
  frame(analyser, silence);
  assert.ok(frame(analyser, bass).kick > 0);
  frame(analyser, silence);
  assert.equal(frame(analyser, bass).kick, 0, 'two frames apart is the same attack');
  advance(analyser, silence, .3);
  assert.ok(frame(analyser, bass).kick > 0);
});

test('FFT changes and long frame gaps prime onset history without fake beats', () => {
  const analyser = createParticleMotionAudio();
  advance(analyser, blank(), 1);
  const gap = frame(analyser, new Uint8Array(1024).fill(220), 2);
  for (const event of ['kick', 'percussion', 'hat', 'release']) assert.equal(gap[event], 0);
  const changed = analyser.update(new Uint8Array(128).fill(240));
  for (const event of ['kick', 'percussion', 'hat', 'release']) assert.equal(changed[event], 0);
});

test('raw FFT obeys gain, global intensity and a gate applied after gain', () => {
  for (const settings of [{ gain: 0 }, { globalIntensity: 0 }, { noiseGate: .9 }, { gain: .5, noiseGate: .5 }]) {
    const analyser = createParticleMotionAudio();
    for (let i = 0; i < 120; i++) {
      const data = new Uint8Array(1024).fill(i % 10 < 5 ? 200 : 0);
      const result = analyser.update(data, dt, { onsetSpectrum: data, settings });
      for (const value of Object.values(result)) assert.equal(value, 0, JSON.stringify(settings));
    }
  }
  const analyser = createParticleMotionAudio(), data = new Uint8Array(1024).fill(100);
  let result;
  for (let i = 0; i < 120; i++) result = analyser.update(data, dt, { onsetSpectrum: data, settings: { gain: 2, noiseGate: .6 } });
  assert.ok(result.bass > .75, 'gain precedes the gate');
});

test('editing raw audio controls re-primes attacks without jumping energy envelopes', () => {
  const analyser = createParticleMotionAudio(), data = new Uint8Array(1024).fill(220);
  const muted = { onsetSpectrum: data, settings: { globalIntensity: 0 } };
  for (let i = 0; i < 120; i++) analyser.update(data, dt, muted);
  const changed = { ...analyser.update(data, dt, { onsetSpectrum: data, settings: { globalIntensity: 1 } }) };
  for (const event of ['kick', 'percussion', 'hat', 'release']) assert.equal(changed[event], 0);
  assert.ok(changed.bass > 0 && changed.bass < .4, 'energy attacks keep smoothing');
  for (let i = 0; i < 60; i++) {
    const result = analyser.update(data, dt, { onsetSpectrum: data, settings: { globalIntensity: 1 } });
    for (const event of ['kick', 'percussion', 'hat', 'release']) assert.equal(result[event], 0);
  }
  const beforeMute = analyser.update(data, dt, { onsetSpectrum: data, settings: { globalIntensity: 1 } }).bass;
  const afterMute = analyser.update(data, dt, muted).bass;
  assert.ok(afterMute > 0 && afterMute < beforeMute, 'energy releases keep smoothing');
});

test('display fallback is already transformed and must not apply gain or gate twice', () => {
  const analyser = createParticleMotionAudio(), data = new Uint8Array(100).fill(220);
  let result;
  for (let i = 0; i < 120; i++) result = analyser.update(data, dt, { settings: { gain: 0, globalIntensity: 0, noiseGate: 1 } });
  assert.ok(result.bass > .8);
  assert.ok(result.mid > .8);
  assert.ok(result.high > .8);
});

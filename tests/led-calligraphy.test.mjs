import assert from 'node:assert/strict';
import test from 'node:test';
import { createLEDWaveformReader } from '../js/led-grid/led-waveform.js';
import { writeCalligraphy } from '../js/led-grid/led-calligraphy-pattern.js';

const sampleRate = 48000;
const pcm = (amplitude, hz = 90, seconds = 1) => Float32Array.from({ length: sampleRate * seconds }, (_, i) => amplitude * Math.sin(i / sampleRate * Math.PI * hz * 2));
const settings = { gain: 1.3, persistence: 1 };
const features = { bass: .7, mids: .5, highs: .3, energy: .7, width: .5, balance: 0, onsets: [0, 0, 0] };
const energy = values => values.reduce((sum, value, i) => sum + (i % 4 === 0 ? value : 0), 0);
const picture = (read, time, extra = {}) => writeCalligraphy({ time, waveform: read(time), features, ...extra }, settings);
const copy = value => structuredClone(value);

test('Calligraphy: silence is dark, and gain zero erases a previously lit output', () => {
  const read = createLEDWaveformReader([new Float32Array(sampleRate)], sampleRate);
  for (const time of [0, .25, .9]) assert.equal(energy(picture(read, time)), 0);
  const live = createLEDWaveformReader([pcm(.3)], sampleRate);
  const output = picture(live, .5);
  assert.ok(energy(output) > 0);
  writeCalligraphy({ time: .5, waveform: live(.5), features }, { gain: 0 }, output);
  assert.equal(energy(output), 0);
});

test('Waveform: no sample, peak or RMS can depend on future PCM', () => {
  const unchanged = pcm(.2);
  const futureEdited = unchanged.slice();
  futureEdited.fill(.99, sampleRate / 2);
  const a = createLEDWaveformReader([unchanged], sampleRate);
  const b = createLEDWaveformReader([futureEdited], sampleRate);
  assert.deepEqual(a(.5), b(.5));
});

test('Waveform: arbitrary seeking reproduces the exact stereo arrays and picture', () => {
  const read = createLEDWaveformReader([pcm(.2, 73), pcm(.13, 141)], sampleRate);
  const waveform = copy(read(.51));
  const expected = picture(read, .51);
  for (const time of [.8, .03, .6, 0, .95, .1]) picture(read, time);
  assert.deepEqual(read(.51), waveform);
  assert.deepEqual(picture(read, .51), expected);
});

test('Waveform: mono, right-only and opposite-phase stereo preserve signal power', () => {
  const left = pcm(.22, 117), silent = new Float32Array(left.length);
  const opposite = Float32Array.from(left, value => -value);
  const mono = createLEDWaveformReader([left], sampleRate)(.5);
  const rightOnly = createLEDWaveformReader([silent, left], sampleRate)(.5);
  const stereo = createLEDWaveformReader([left, opposite], sampleRate)(.5);
  assert.equal(mono.frames[0].rmsLeft, mono.frames[0].rmsRight);
  assert.equal(rightOnly.frames[0].rmsLeft, 0);
  assert.ok(rightOnly.frames[0].rmsRight > .1);
  assert.equal(stereo.frames[0].rmsLeft, stereo.frames[0].rmsRight);
  assert.ok(stereo.frames[0].left.some(value => Math.abs(value) > .15));
  for (let i = 0; i < stereo.pointCount; i++) assert.equal(stereo.frames[0].left[i], -stereo.frames[0].right[i]);
  assert.ok(energy(writeCalligraphy({ time: .5, waveform: rightOnly, features }, settings)) > 0);
  assert.ok(energy(writeCalligraphy({ time: .5, waveform: stereo, features: { ...features, width: 1 } }, settings)) > 0);
});

test('Calligraphy: a short PCM attack lights the next 60 Hz frame without a future event', () => {
  const input = new Float32Array(sampleRate);
  input.fill(.8, sampleRate / 2, sampleRate / 2 + 96);
  const read = createLEDWaveformReader([input], sampleRate);
  assert.equal(energy(picture(read, .5)), 0);
  assert.ok(energy(picture(read, .5 + 1 / 60)) > 10);
  assert.equal(energy(picture(read, .75)), 0, 'Short afterimages must end after the signal decays');
});

test('Calligraphy: quiet-to-loud contrast follows PCM without frame normalization', () => {
  const quiet = createLEDWaveformReader([pcm(.008)], sampleRate);
  const loud = createLEDWaveformReader([pcm(.25)], sampleRate);
  const q = picture(quiet, .5), l = picture(loud, .5);
  assert.ok(energy(l) > energy(q) * 15);
  assert.ok(l.filter((v, i) => i % 4 === 0 && v > .085).length > q.filter((v, i) => i % 4 === 0 && v > .085).length);
});

test('Calligraphy: low, mid and high tones each remain visible, finite and bounded', () => {
  for (const hz of [45, 1000, 9000, 18000]) {
    const read = createLEDWaveformReader([pcm(.3, hz)], sampleRate);
    const output = picture(read, .5);
    assert.ok(energy(output) > 10, `${hz} Hz must contribute`);
    for (let i = 0; i < output.length; i++) assert.ok(Number.isFinite(output[i]) && output[i] >= 0 && output[i] <= (i % 4 === 0 ? 5 : 1));
  }
});

test('Calligraphy: current attacks brighten the actual stroke, while future attacks do nothing', () => {
  const read = createLEDWaveformReader([pcm(.18)], sampleRate);
  const plain = picture(read, .5);
  const hit = picture(read, .5, { events: [{ time: .5, band: 0, strength: .8 }] });
  const future = picture(read, .5, { events: [{ time: .51, band: 0, strength: .8 }] });
  assert.ok(energy(hit) > energy(plain) * 1.2);
  assert.deepEqual(future, plain);
});

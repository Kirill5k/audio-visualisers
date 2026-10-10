import test from 'node:test';
import assert from 'node:assert/strict';
import { createModulation, createSpreadAudioModulation, setSpreadAudioReactive, setModulationBound, eligibleModulationTargets, MODULATION_CONTROLS, FREQUENCY_RANGES } from '../js/particle-dance/particle-dance-modulation.js';
import { createMeshGridAudioModulator, createMeshGridAnalysis } from '../js/mesh-grid/mesh-grid-analysis.js';

test('new modulation uses the current source defaults and independent target bounds', () => {
  const first = createModulation({ min: 50, max: 2000 });
  const second = createModulation({ min: 0, max: 1 });
  assert.deepEqual(first, { enabled: true, mode: 'oscillate', amount: 1, contrast: 1, source: 'amplitude', fluxTiming: 'onset', invert: false,
    anchor: 'slider', attackMs: 10, releaseMs: 200, speed: 2, easing: 'sine', freqStart: 0, freqEnd: 1, min: 50, max: 2000 });
  first.amount = 4;
  assert.equal(second.amount, 1);
  assert.deepEqual(Object.values(MODULATION_CONTROLS.mode.options), ['audio', 'oscillate', 'ramp-up', 'ramp-down']);
  assert.equal(MODULATION_CONTROLS.attackMs.max, 500);
  assert.equal(MODULATION_CONTROLS.releaseMs.max, 2000);
  assert.deepEqual(FREQUENCY_RANGES.bass, { label: 'Bass (sub + low)', start: 0, end: .1 });
});

test('target registry includes pool counts and only numeric sliders of enabled effects', () => {
  const particles = { particleCount: { type: 'number', min: 50, max: 2000 }, hotspotCount: { type: 'number', min: 1, max: 20 },
    visible: { type: 'boolean' }, topology: { type: 'number', structural: true } };
  const effects = { glow: { enabled: { type: 'boolean' }, strength: { type: 'number', label: 'Strength' }, color: { type: 'color' } }, blur: { radius: { type: 'number' } } };
  const settings = { enablePostProcessing: true, glow_enabled: true, blur_enabled: false, fftSize: 2048, gain: 1 };
  const targets = eligibleModulationTargets(particles, effects, settings, { glow: 'Glow' });
  assert.deepEqual(Object.keys(targets), ['particleCount', 'hotspotCount', 'glow_strength']);
  assert.equal(targets.glow_strength.label, 'Glow: Strength');
  assert.deepEqual(Object.keys(eligibleModulationTargets(particles, effects, { ...settings, enablePostProcessing: false })), ['particleCount', 'hotspotCount']);
});

test('editable modulation endpoints clamp to target limits and cannot cross', () => {
  const spec = { min: 50, max: 2000 }, modulation = createModulation(spec);
  assert.equal(setModulationBound(modulation, 'max', 500, spec), true);
  setModulationBound(modulation, 'min', 800, spec);
  assert.equal(modulation.min, 500); assert.equal(modulation.max, 500);
  setModulationBound(modulation, 'max', 100, spec);
  assert.equal(modulation.max, 500);
  setModulationBound(modulation, 'min', -100, spec);
  setModulationBound(modulation, 'max', 9000, spec);
  assert.equal(modulation.min, 50); assert.equal(modulation.max, 2000);
  assert.equal(setModulationBound(modulation, 'min', NaN, spec), false);
  assert.equal(setModulationBound(modulation, 'max', Infinity, spec), false);
  assert.equal(modulation.min, 50); assert.equal(modulation.max, 2000);
  const signed = { min: -.1, max: .6 };
  setModulationBound(signed, 'min', -.5, { min: -1, max: 1 });
  assert.equal(signed.min, -.5);
});

test('restarting one ramp leaves other ramps and same-frame evaluation intact', () => {
  const modulator = createMeshGridAudioModulator();
  const zero = new Uint8Array(4);
  const configuration = () => ({ a: 0, b: 0, controlModulations: { a: { ...createModulation({ min: 0, max: 1 }, 'ramp-up'), easing: 'linear' },
    b: { ...createModulation({ min: 0, max: 1 }, 'ramp-up'), easing: 'linear' } } });
  modulator.process(configuration(), zero, zero, 0);
  assert.equal(modulator.process(configuration(), zero, zero, 1).a, .5);
  modulator.resetControl('a');
  const restarted = modulator.process(configuration(), zero, zero, 1);
  assert.equal(restarted.a, 0); assert.equal(restarted.b, .5);
  const later = modulator.process(configuration(), zero, zero, 2);
  assert.equal(later.a, .5); assert.equal(later.b, 1);
  modulator.resetControl('a');
  const down = configuration(); down.controlModulations.a.mode = 'ramp-down';
  assert.equal(modulator.process(down, zero, zero, 2).a, 1);
  modulator.process(down, zero, zero, 3);
  down.controlModulations.a.speed = 4;
  down.controlModulations.a.easing = 'sine';
  down.controlModulations.a.min = .2;
  down.controlModulations.a.max = .8;
  modulator.resetControl('a');
  assert.equal(modulator.process(down, zero, zero, 3).a, .8, 'editing a ramp starts at the new endpoint');
  assert.ok(Math.abs(modulator.process(down, zero, zero, 5).a - .5) < 1e-12);
});

test('analysis ramp reset does not replace the PCM spectrum or consume another frame', () => {
  const rate = 48000, pcm = new Float32Array(rate * 3);
  for (let i = 0; i < pcm.length; i++) pcm[i] = .1 * Math.sin(2 * Math.PI * 750 * i / rate);
  const buffer = { sampleRate: rate, duration: 3, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
  const settings = { fftSize: 2048, particleSize: 0, controlModulations: { particleSize: { ...createModulation({ min: 0, max: 1 }, 'ramp-up'), easing: 'linear' } } };
  const analysis = createMeshGridAnalysis(buffer, settings);
  analysis.frameAt(0);
  const before = analysis.frameAt(1);
  const spectrum = [...before.spectrum];
  assert.equal(before.settings.particleSize, .5);
  analysis.resetModulation('particleSize');
  const after = analysis.frameAt(1, 0);
  assert.equal(after.settings.particleSize, 0);
  assert.deepEqual([...after.spectrum], spectrum);
  analysis.dispose();
});

const spreadSpec = { min: 2, max: 20, step: .5, default: 8 };

test('Spread audio defaults use a bounded bass envelope and independent ranges', () => {
  const first = createSpreadAudioModulation(7.5, spreadSpec);
  const second = createSpreadAudioModulation(7.5, spreadSpec);
  assert.deepEqual(first, { ...createModulation(spreadSpec, 'audio'), source: 'amplitude',
    freqStart: 0, freqEnd: .1, anchor: 'range', amount: 1, attackMs: 120, releaseMs: 650, min: 6, max: 9 });
  first.min = 2;
  assert.equal(second.min, 6);
  for (const base of [2, 2.1, 7.5, 19.9, 20]) {
    const m = createSpreadAudioModulation(base, spreadSpec);
    assert.ok(m.min >= 2 && m.max <= 20 && m.min <= m.max);
    assert.equal(m.min % .5, 0);
    assert.equal(m.max % .5, 0);
  }
  assert.equal(createSpreadAudioModulation(2, spreadSpec).min, 2);
  assert.equal(createSpreadAudioModulation(20, spreadSpec).max, 20);
});

test('Spread checkbox preserves the manual value, other targets and edited audio parameters', () => {
  const particleSize = createModulation({ min: .05, max: .5 });
  const settings = { spread: 7.5, controlModulations: { particleSize } };
  setSpreadAudioReactive(settings, true, spreadSpec);
  assert.equal(settings.spread, 7.5);
  assert.equal(settings.controlModulations.particleSize, particleSize);
  Object.assign(settings.controlModulations.spread, { source: 'flux', min: 4, max: 12, amount: .6, attackMs: 250 });
  const edited = { ...settings.controlModulations.spread };
  setSpreadAudioReactive(settings, false, spreadSpec);
  assert.deepEqual(settings.controlModulations.spread, { ...edited, enabled: false });
  const silence = new Uint8Array(100);
  assert.equal(createMeshGridAudioModulator().process(settings, silence, silence, 0).spread, 7.5);
  setSpreadAudioReactive(settings, true, spreadSpec);
  assert.deepEqual(settings.controlModulations.spread, edited);
  assert.equal(settings.spread, 7.5);
});

test('enabling Spread audio replaces a temporal mapping without creating a second mapping', () => {
  const settings = { spread: 7.5, controlModulations: { spread: createModulation(spreadSpec, 'oscillate') } };
  setSpreadAudioReactive(settings, true, spreadSpec);
  assert.deepEqual(Object.keys(settings.controlModulations), ['spread']);
  assert.deepEqual(settings.controlModulations.spread, createSpreadAudioModulation(7.5, spreadSpec));
  const plain = { spread: 7.5 };
  setSpreadAudioReactive(plain, false, spreadSpec);
  assert.equal(plain.spread, 7.5);
  assert.equal(plain.controlModulations?.spread?.enabled ?? false, false);
});

test('Spread reacts only to bass energy, spanning silence to its configured maximum', () => {
  const settings = { spread: 7.5 };
  setSpreadAudioReactive(settings, true, spreadSpec);
  const silence = new Uint8Array(100), bass = new Uint8Array(100), treble = new Uint8Array(100);
  bass.fill(255, 0, 10); treble.fill(255, 10);
  const evaluate = spectrum => createMeshGridAudioModulator().process(settings, spectrum, silence, 0).spread;
  assert.equal(evaluate(silence), 6);
  assert.equal(evaluate(bass), 9);
  assert.equal(evaluate(treble), 6);
});

test('Spread attack expands smoothly and release contracts more slowly', () => {
  const settings = { spread: 7.5 };
  setSpreadAudioReactive(settings, true, spreadSpec);
  const modulator = createMeshGridAudioModulator();
  const silence = new Uint8Array(100), bass = new Uint8Array(100).fill(255, 0, 10);
  assert.equal(modulator.process(settings, silence, silence, 0).spread, 6);
  const attack = modulator.process(settings, bass, silence, .12).spread;
  assert.ok(Math.abs(attack - (6 + 3 * (1 - Math.exp(-1)))) < 1e-12);
  const release = modulator.process(settings, silence, silence, .24).spread;
  assert.ok(Math.abs(release - (6 + (attack - 6) * Math.exp(-.12 / .65))) < 1e-12);
  assert.ok(6 < release && release < attack && attack < 9);
});

test('Spread envelopes replay exactly and stay isolated between preview/export analyses', () => {
  const rate = 8000, pcm = new Float32Array(rate * 2);
  for (let i = 0; i < pcm.length; i++) {
    const time = i / rate;
    if (time > .2 && time < 1.2) pcm[i] = .1 * Math.sin(2 * Math.PI * 100 * time);
  }
  const buffer = { sampleRate: rate, duration: 2, length: pcm.length, numberOfChannels: 1, getChannelData: () => pcm };
  const settings = { spread: 7.5, fftSize: 1024 };
  setSpreadAudioReactive(settings, true, spreadSpec);
  const preview = createMeshGridAnalysis(buffer, settings), exported = createMeshGridAnalysis(buffer, structuredClone(settings));
  try {
    const run = analysis => Array.from({ length: 120 }, (_, frame) => analysis.frameAt(frame / 60).settings.spread);
    const expected = run(preview);
    assert.equal(exported.frameAt(0).settings.spread, 6, 'another analysis cannot consume the initial envelope');
    assert.deepEqual(run(exported), expected);
    preview.reset();
    assert.deepEqual(run(preview), expected);
    assert.ok(expected.some(value => value > 6));
    assert.ok(expected.every(value => value >= 6 && value <= 9));
  } finally { preview.dispose(); exported.dispose(); }
});

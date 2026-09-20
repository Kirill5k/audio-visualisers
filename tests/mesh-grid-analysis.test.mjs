import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeshGridAnalysis, createMeshGridSpectrumTransform, createMeshGridAudioModulator } from '../js/mesh-grid/mesh-grid-analysis.js';

function buffer(sampleRate = 48000, seconds = .3, makeSample = () => 0, channelCount = 1) {
  const length = Math.round(sampleRate * seconds);
  const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length }, (_, i) => makeSample(i, channel)));
  return { sampleRate, duration: seconds, length, numberOfChannels: channelCount, getChannelData: channel => channels[channel] };
}
const audioMod = overrides => ({ enabled: true, mode: 'audio', source: 'flux', fluxTiming: 'smoothed', freqStart: 0, freqEnd: 1,
  amount: 1, min: 0, max: 1, anchor: 'range', contrast: 1, attackMs: 0, releaseMs: 0, ...overrides });

function peakBin(spectrum) {
  let peak = 0;
  for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
  return peak;
}

test('silence stays zero and first-frame flux never manufactures an onset', () => {
  const analysis = createMeshGridAnalysis(buffer(), { fftSize: 16384, noiseGate: .1, peakDecay: .4,
    perlinNoiseIntensity: 1.35, controlModulations: { perlinNoiseIntensity: audioMod({ max: 5 }) } });
  for (let i = 0; i < 10; i++) {
    const frame = analysis.frameAt(i / 60);
    assert.ok(frame.spectrum.every(value => value === 0));
    assert.ok(frame.onsetSpectrum.every(value => value === 0));
    assert.equal(frame.settings.perlinNoiseIntensity, 0);
    assert.equal(frame.spectrum.length, 8192);
  }
  analysis.dispose();
});

test('Web Audio magnitude normalization and actual sample rates preserve tone bins', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const fftSize = 2048, frequency = 16 * sampleRate / fftSize;
    const pcm = buffer(sampleRate, .25, i => .1 * Math.sin(2 * Math.PI * frequency * i / sampleRate));
    const analysis = createMeshGridAnalysis(pcm, { fftSize, smoothingTimeConstant: 0 }, { browserBias: 0 });
    const frame = analysis.frameAt(.2);
    assert.equal(peakBin(frame.spectrum), 16);
    // A bin-centred sinusoid gives A * .42 / 2 after Blackman and the 1/N FFT.
    const expected = Math.floor((20 * Math.log10(.1 * .42 / 2) + 120) / 90 * 255);
    assert.ok(Math.abs(frame.spectrum[16] - expected) <= 1);
    assert.ok(frame.spectrum.every(Number.isFinite));
  }
});

test('browser bias shifts dB bounds, volume precedes FFT, and stereo averages channels', () => {
  const pcm = buffer(48000, .3, i => .01 * Math.sin(2 * Math.PI * 750 * i / 48000));
  const noBias = createMeshGridAnalysis(pcm, { smoothingTimeConstant: 0 }, { browserBias: 0 }).frameAt(.2).spectrum[32];
  const bias = createMeshGridAnalysis(pcm, { smoothingTimeConstant: 0 }).frameAt(.2).spectrum[32];
  assert.ok(Math.abs(noBias - bias - 255 * 10 / 90) < 1);
  const quiet = createMeshGridAnalysis(pcm, { smoothingTimeConstant: 0, volume: .1 }, { browserBias: 0 }).frameAt(.2).spectrum[32];
  assert.ok(Math.abs(noBias - quiet - 255 * 20 / 90) < 1);
  const opposite = buffer(48000, .3, (i, channel) => (channel ? -1 : 1) * Math.sin(2 * Math.PI * 750 * i / 48000), 2);
  assert.ok(createMeshGridAnalysis(opposite, {}).frameAt(.2).spectrum.every(value => value === 0));
});

test('source transform preserves gain/gate/attenuation order and separate sensitivity', () => {
  const transform = createMeshGridSpectrumTransform();
  const input = Uint8Array.from([20, 60, 100, 255]);
  const output = transform.process(input, { gain: 2, globalIntensity: .5, noiseGate: .3, bassAttenuation: .5, sensitivity: 9 });
  assert.deepEqual([...output.spectrum], [0, 0, 75, 223]);
  assert.deepEqual([...input], [20, 60, 100, 255]);
});

test('peak decay uses source exponential and reset removes history', () => {
  const transform = createMeshGridSpectrumTransform(), config = { peakDecay: .5 };
  transform.process(Uint8Array.of(200, 0), config, 1 / 60);
  const next = transform.process(Uint8Array.of(0, 0), config, 1 / 60);
  assert.equal(next.spectrum[0], Math.round(200 * (.5 + .49 * .5) ** 2));
  transform.reset();
  assert.deepEqual([...transform.process(Uint8Array.of(0, 0), config).spectrum], [0, 0]);
});

test('spectrum cap retains at least five percent and compression a ten-percent floor', () => {
  const transform = createMeshGridSpectrumTransform();
  const data = new Uint8Array(100); data[0] = 200;
  const cap = transform.process(data, { spectrumCap: 0 });
  assert.equal(cap.effectiveRange, 5);
  const compressed = transform.process(data, { spectrumCap: .5, spectrumCompress: 1 });
  assert.equal(compressed.effectiveRange, 5);
  assert.equal(compressed.cappedRange, 50);
  const silence = transform.process(new Uint8Array(100), { spectrumCap: .5, spectrumCompress: 1 });
  assert.equal(silence.effectiveRange, 50, 'source leaves silent range at cap');
  const stretched = transform.process(Uint8Array.from([0, 100, 200, 255]), { spectrumCap: .5 });
  assert.deepEqual([...stretched.spectrum], [0, 50, 100, 100]);
});

test('linear, logarithmic and mel layouts span the output and retain high-bin peaks', () => {
  const transform = createMeshGridSpectrumTransform();
  const input = new Uint8Array(1024); input[700] = 230;
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const frequencyScale of ['linear', 'log', 'mel']) {
      const frame = transform.process(input, { frequencyScale }, 1 / 60, sampleRate);
      assert.equal(frame.spectrum.length, input.length);
      assert.ok(Math.max(...frame.spectrum) >= 200, `${frequencyScale} retains a high-frequency impulse at ${sampleRate}`);
      assert.ok(frame.spectrum.every(Number.isFinite));
    }
  }
});

test('multiple controls read the same positive spectral flux once per frame', () => {
  const modulator = createMeshGridAudioModulator();
  const settings = { noise: .1, bend: .2, controlModulations: { noise: audioMod(), bend: audioMod() } };
  const silent = new Uint8Array(8), rising = new Uint8Array(8).fill(10);
  const initial = modulator.process(settings, rising, silent, 0);
  assert.equal(initial.noise, 0);
  modulator.reset();
  modulator.process(settings, silent, silent, 0);
  const next = modulator.process(settings, rising, silent, 1 / 60);
  assert.ok(Math.abs(next.noise - 10 / 255 * 12) < 1e-12);
  assert.equal(next.noise, next.bend);
  assert.equal(modulator.process(settings, rising, silent, 1 / 60), next, 'same-time reads do not advance shared history');
  const falling = modulator.process(settings, silent, silent, 2 / 60);
  assert.equal(falling.noise, 0);
  const afterGap = modulator.process(settings, rising, silent, 1);
  assert.equal(afterGap.noise, 0);
  const resized = modulator.process(settings, new Uint8Array(16).fill(30), silent, 1 + 1 / 60);
  assert.equal(resized.noise, 0);
});

test('onset flux uses its short FFT and remaps normalized ranges through spectrum cap', () => {
  const modulator = createMeshGridAudioModulator();
  const settings = { amount: 0, controlModulations: { amount: audioMod({ fluxTiming: 'onset' }) } };
  const display = new Uint8Array(16), onset = new Uint8Array(8);
  modulator.process(settings, display, onset, 0, 8);
  onset[6] = 200;
  assert.equal(modulator.process(settings, display, onset, 1 / 60, 8).amount, 0, 'upper uncapped onset bins are ignored');
  onset[1] = 20;
  const frame = modulator.process(settings, display, onset, 2 / 60, 8);
  assert.ok(Math.abs(frame.amount - 20 / 4 / 255 * 4) < 1e-12);
});

test('amplitude, centroid, active bands, attack/release, contrast and anchors match source', () => {
  const modulator = createMeshGridAudioModulator();
  const settings = { amp: .4, centroid: 0, active: 0, inverse: .8, slider: .3,
    controlModulations: {
      amp: audioMod({ source: 'amplitude', attackMs: 100, releaseMs: 200, contrast: 2 }),
      centroid: audioMod({ source: 'centroid' }), active: audioMod({ source: 'activeBands' }),
      inverse: audioMod({ source: 'amplitude', invert: true }),
      slider: audioMod({ source: 'amplitude', anchor: 'slider', amount: .2 }),
    } };
  const zero = new Uint8Array(4);
  modulator.process(settings, zero, zero, 0);
  const spectrum = Uint8Array.from([0, 0, 255, 255]);
  const frame = modulator.process(settings, spectrum, zero, .1);
  assert.ok(Math.abs(frame.amp - (.5 * (1 - Math.exp(-1))) ** 2) < 1e-12);
  assert.equal(frame.centroid, 2.5 / 3);
  assert.equal(frame.active, .5);
  assert.equal(frame.inverse, .5);
  assert.equal(frame.slider, .4);
  const released = modulator.process(settings, zero, zero, .2);
  assert.ok(Math.abs(released.amp - frame.amp * Math.exp(-1)) < 1e-12);
});

test('reset, fresh export instances and same-time reads give deterministic frames', () => {
  const pcm = buffer(44100, .3, i => .04 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const settings = { fftSize: 2048, peakDecay: .7, radialMix: .25,
    controlModulations: { radialMix: audioMod({ invert: true, attackMs: 10, releaseMs: 200 }) } };
  const analysis = createMeshGridAnalysis(pcm, settings);
  const sequence = instance => Array.from({ length: 14 }, (_, index) => {
    const frame = instance.frameAt(index / 60);
    assert.equal(instance.frameAt(index / 60), frame);
    return { spectrum: [...frame.spectrum], radialMix: frame.settings.radialMix };
  });
  const original = sequence(analysis);
  analysis.reset();
  assert.deepEqual(sequence(analysis), original);
  assert.deepEqual(sequence(createMeshGridAnalysis(pcm, settings)), original);
  analysis.setSettings({ ...settings, fftSize: 4096 });
  assert.equal(analysis.frameAt(.2).spectrum.length, 2048);
  analysis.dispose();
  assert.throws(() => analysis.frameAt(0), /disposed/);
});

test('paused cosmetic edits reuse FFT smoothing and preserve the frame flux and subsequent playback', () => {
  const pcm = buffer(48000, .3, i => i < 2400 ? 0 : .012 * Math.sin(2 * Math.PI * 750 * i / 48000));
  const settings = { smoothingTimeConstant: .85, gridColor: '#ffffff', radialMix: 0,
    controlModulations: { radialMix: audioMod({ amount: .5 }) } };
  const analysis = createMeshGridAnalysis(pcm, settings), untouched = createMeshGridAnalysis(pcm, settings);
  for (let index = 0; index < 5; index++) { analysis.frameAt(index / 60); untouched.frameAt(index / 60); }
  const time = 5 / 60, expected = untouched.frameAt(time);
  const expectedSpectrum = [...expected.spectrum], expectedOnset = [...expected.onsetSpectrum];
  analysis.frameAt(time);
  for (let edit = 0; edit < 8; edit++) {
    // App mutates and reuses this settings object for each control edit.
    settings.gridColor = edit % 2 ? '#ff0000' : '#00ff00';
    analysis.setSettings(settings);
    const frame = analysis.frameAt(time, 0);
    assert.deepEqual([...frame.spectrum], expectedSpectrum);
    assert.deepEqual([...frame.onsetSpectrum], expectedOnset);
    assert.equal(frame.settings.radialMix, expected.settings.radialMix);
    assert.equal(frame.settings.gridColor, settings.gridColor);
  }
  const resumed = analysis.frameAt(6 / 60), reference = untouched.frameAt(6 / 60);
  assert.deepEqual([...resumed.spectrum], [...reference.spectrum]);
  assert.equal(resumed.settings.radialMix, reference.settings.radialMix);
});

test('paused audio parameter edits re-evaluate the same PCM without accumulating smoothing', () => {
  const pcm = buffer(48000, .3, i => .012 * Math.sin(2 * Math.PI * 750 * i / 48000));
  const settings = { smoothingTimeConstant: .85, volume: 1, minDecibels: -120, maxDecibels: -30 };
  const analysis = createMeshGridAnalysis(pcm, settings), untouched = createMeshGridAnalysis(pcm, settings);
  for (let index = 0; index <= 5; index++) { analysis.frameAt(index / 60); untouched.frameAt(index / 60); }
  const expected = [...untouched.frameAt(5 / 60).spectrum];
  for (const patch of [{ volume: .25 }, { minDecibels: -100 }, { smoothingTimeConstant: .1 }]) {
    analysis.setSettings({ ...settings, ...patch });
    assert.notDeepEqual([...analysis.frameAt(5 / 60, 0).spectrum], expected, 'audio controls still take effect while paused');
    analysis.setSettings(settings);
    assert.deepEqual([...analysis.frameAt(5 / 60, 0).spectrum], expected, 'restoring settings restores the unchanged analysis frame');
  }
  assert.deepEqual([...analysis.frameAt(6 / 60).spectrum], [...untouched.frameAt(6 / 60).spectrum]);
});

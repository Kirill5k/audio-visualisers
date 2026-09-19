import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createPhaseTimelineBuilder, createPhaseFrameReader, FFT_SIZE, FFT_BINS } from '../js/phase/phase-analysis-core.js';
import { createPhaseAnalysis } from '../js/phase/phase-analysis.js';

const rate = 12000;
const tone = (frequency, seconds, amplitude = 0.5) => Float32Array.from({ length: rate * seconds }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
function analyse(channels) {
  const builder = createPhaseTimelineBuilder(channels, rate);
  while (!builder.done) builder.step(120);
  return { timeline: builder.timeline, at: createPhaseFrameReader(channels, builder.timeline) };
}
const copy = frame => ({ ...frame, features: { ...frame.features }, spectrum: frame.spectrum.slice(), waveform: frame.waveform.slice(), waveformLeft: frame.waveformLeft.slice(), waveformRight: frame.waveformRight.slice() });
const buffer = channels => ({ numberOfChannels: channels.length, length: channels[0].length, sampleRate: rate, getChannelData: index => channels[index] });

test('maximum FFT resolution and true silence are preserved', () => {
  assert.equal(FFT_SIZE, 32768); assert.equal(FFT_BINS, 16384);
  const { timeline, at } = analyse([new Float32Array(rate * 2)]);
  assert.equal(timeline.sections.length, 1);
  assert.equal(timeline.sections[0].name, 'Phase portrait');
  const frame = at(1);
  assert.equal(frame.spectrum.length, 16384); assert.equal(frame.waveform.length, 2048);
  assert.ok(frame.spectrum.every(value => value === 0));
  assert.ok(frame.waveform.every(value => value === 0));
  assert.deepEqual(frame.features, { bass: 0, mids: 0, highs: 0, energy: 0, kick: 0, rms: 0 });
});

test('opposite stereo polarity cannot cancel spectrum, waveform, or loudness', () => {
  const pcm = tone(1200, 3);
  const mono = copy(analyse([pcm]).at(2.5));
  const stereo = copy(analyse([pcm, Float32Array.from(pcm, value => -value)]).at(2.5));
  assert.deepEqual(stereo.spectrum, mono.spectrum);
  assert.deepEqual(stereo.features, mono.features);
  assert.deepEqual(stereo.waveform, mono.waveform);
  const right = copy(analyse([new Float32Array(pcm.length), pcm]).at(2.5));
  assert.ok(Math.max(...right.spectrum) > 180);
  assert.ok(Math.max(...right.waveform) > 0.4);
  assert.ok(Math.abs(right.features.rms / mono.features.rms - Math.SQRT1_2) < 1e-5);
});

test('absolute frame reads are identical after arbitrary seeks', () => {
  const { at } = analyse([tone(180, 4)]);
  const first = copy(at(2.13));
  at(0); at(3.5); at(0.5);
  assert.deepEqual(copy(at(2.13)), first);
});

test('the final frequency ranges are retained and quiet passages remain quieter', () => {
  const high = analyse([tone(5800, 3)]).at(2.8);
  const expectedBin = Math.round(5800 * FFT_SIZE / rate);
  assert.ok(Math.abs(high.spectrum.indexOf(Math.max(...high.spectrum)) - expectedBin) < 2);
  const pcm = tone(200, 6);
  for (let i = 0; i < rate * 3; i++) pcm[i] *= 0.08;
  const { at } = analyse([pcm]);
  assert.ok(at(2).features.energy < at(5).features.energy * 0.2);
});

test('scope textures retain signed stereo PCM and expose a causal trigger-aligned window', () => {
  const left = tone(180, 4), right = Float32Array.from(left, value => -value);
  const { at } = analyse([left, right]);
  const frame = at(3.5);
  assert.equal(frame.waveformLeft.length, FFT_SIZE);
  assert.equal(frame.waveformRight.length, FFT_SIZE);
  assert.equal(frame.scopeSamples, Math.round(rate * 0.09));
  assert.ok(frame.scopeStart >= frame.scopeDelaySamples);
  assert.ok(frame.scopeStart + frame.scopeSamples <= FFT_SIZE);
  assert.ok(frame.scopeGain >= 0.7 && frame.scopeGain <= 8);
  const end = Math.round(frame.frame * rate / 60);
  assert.equal(frame.waveformLeft.at(-1), left[end - 1]);
  assert.equal(frame.waveformRight.at(-1), right[end - 1]);
  for (let i = 0; i < FFT_SIZE; i++) assert.equal(frame.waveformLeft[i] + frame.waveformRight[i], 0);
  assert.ok(frame.waveformLeft[frame.scopeStart - 1] <= 0 && frame.waveformLeft[frame.scopeStart] > 0);
  const expected = copy(frame);
  at(1.1); at(2.2);
  assert.deepEqual(copy(at(3.5)), expected);
});

test('sustained tones hold a phase while structural timbre changes trigger smooth morphs', () => {
  const steady = analyse([tone(120, 24)]);
  assert.equal(steady.timeline.sections.length, 1, 'a fixed timer must not change a constant tone');
  assert.equal(steady.timeline.sections[0].name, 'Phase portrait', 'a pure sustained tone retains its own silhouette');
  const pcm = new Float32Array(rate * 30);
  pcm.set(tone(100, 10), 0); pcm.set(tone(1200, 10), rate * 10); pcm.set(tone(4800, 10), rate * 20);
  const { timeline, at } = analyse([pcm]);
  assert.ok(timeline.sections.length >= 3, `found ${timeline.sections.length} sections`);
  for (const expected of [10, 20]) assert.ok(timeline.sections.some(section => Math.abs(section.time - expected) < 1), `missing boundary near ${expected}`);
  const transition = timeline.sections[1];
  const start = at(transition.time);
  assert.ok(start.phase.reason && start.phase.confidence >= 0.5);
  assert.equal(start.morph, 0);
  const middle = at(transition.time + 0.4);
  assert.ok(middle.morph > 0.2 && middle.morph < 0.8);
  assert.equal(at(transition.time + 0.8).morph, 1, 'the faster morph settles within 800ms');
});

// Deterministic mixtures isolate arrangement changes from master volume.
function arrangement(seconds, layers) {
  let noise = 1317;
  const pcm = new Float32Array(rate * seconds);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / rate;
    noise = (Math.imul(noise, 1664525) + 1013904223) | 0;
    const white = noise / 2147483648;
    const layer = layers(t);
    const pad = 0.12 * Math.sin(2 * Math.PI * 440 * t) + 0.09 * Math.sin(2 * Math.PI * 660 * t);
    const bass = 0.24 * Math.sin(2 * Math.PI * 82.4 * t) * (0.72 + 0.28 * Math.exp(-(t % 0.5) * 10));
    const beatTime = t % 0.5;
    const hatTime = t % (layer.dense ? 0.125 : 0.25);
    const drums = 0.3 * Math.sin(2 * Math.PI * 65 * t) * Math.exp(-beatTime * 38)
      + white * 0.18 * Math.exp(-hatTime * 85);
    const extra = layer.dense ? 0.055 * (Math.sin(2 * Math.PI * 1318.5 * t) + Math.sin(2 * Math.PI * 2093 * t) + Math.sin(2 * Math.PI * 3520 * t)) : 0;
    pcm[i] = (pad + (layer.bass ? bass : 0) + (layer.drums ? drums : 0) + extra) * (layer.gain ?? 1);
  }
  return pcm;
}

test('a sustained bass entry and percussion exit create explained arrangement boundaries', () => {
  const pcm = arrangement(36, t => ({ bass: t >= 10, drums: t < 24 }));
  const { timeline, at } = analyse([pcm]);
  for (const [expected, word] of [[10, 'Bass'], [24, 'Percussion']]) {
    const boundary = timeline.sections.find(section => Math.abs(section.time - expected) < 1.1);
    assert.ok(boundary, `missing ${word} event near ${expected}: ${JSON.stringify(timeline.sections)}`);
    assert.match(boundary.reason, new RegExp(word, 'i'));
    assert.ok(boundary.confidence >= 0.5);
  }
  assert.ok(at(16).phase.bassPresence > at(6).phase.bassPresence + 0.15);
  assert.ok(at(18).phase.drumPresence > at(30).phase.drumPresence + 0.2);
});

test('constant grooves, a gain fade, and an isolated fill do not invent arrangement changes', () => {
  const steady = arrangement(28, () => ({ bass: true, drums: true }));
  assert.equal(analyse([steady]).timeline.sections.length, 1, 'repeating groove remains one phase');
  const faded = arrangement(28, t => ({ bass: true, drums: true, gain: t < 10 ? 0.25 : t > 16 ? 0.8 : 0.25 + (t - 10) * 0.55 / 6 }));
  const fadedSections = analyse([faded]).timeline.sections;
  assert.equal(fadedSections.length, 1, `master gain must not change the arrangement: ${JSON.stringify(fadedSections)}`);
  const pad = arrangement(28, () => ({}));
  for (let i = rate * 14; i < rate * 14.4; i++) pad[i] += Math.sin(i * 1.417) * 0.6 * Math.exp(-(i / rate - 14) * 25);
  assert.equal(analyse([pad]).timeline.sections.length, 1, 'one isolated hit is not a new phase');
});

test('a repeating melodic bass phrase does not manufacture section boundaries', () => {
  const notes = [82.4, 146.8, 110, 196];
  const pcm = arrangement(48, () => ({ drums: true }));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / rate, frequency = notes[Math.floor(t / 3) % notes.length];
    pcm[i] += 0.24 * Math.sin(2 * Math.PI * frequency * t);
  }
  assert.equal(analyse([pcm]).timeline.sections.length, 1, 'a repeating twelve-second phrase is musical content inside one phase');
});

test('busier equal-RMS passages are larger, and a repeated arrangement returns to its character', () => {
  const pcm = arrangement(36, t => ({ bass: true, drums: t >= 12 && t < 24, dense: t >= 12 && t < 24 }));
  // Match RMS independently in each passage; complexity cannot simply be loudness.
  for (let section = 0; section < 3; section++) {
    const from = section * 12 * rate, to = from + 12 * rate;
    let square = 0;
    for (let i = from; i < to; i++) square += pcm[i] ** 2;
    const scale = 0.2 / Math.sqrt(square / (to - from));
    for (let i = from; i < to; i++) pcm[i] *= scale;
  }
  const { at } = analyse([pcm]);
  const sparse = copy(at(8)), dense = copy(at(20)), repeated = copy(at(32));
  assert.ok(dense.phase.complexity > sparse.phase.complexity + 0.15);
  assert.ok(dense.phase.size > sparse.phase.size + 0.09);
  assert.notEqual(dense.shapeTo, sparse.shapeTo, 'sparse and dense arrangements should have distinct silhouettes');
  assert.equal(dense.phaseName, 'Radial crown', 'the busiest passage opens into a crown');
  assert.equal(repeated.shapeTo, sparse.shapeTo);
  assert.ok(Math.abs(repeated.phase.complexity - sparse.phase.complexity) < 0.08, JSON.stringify({ sparse: sparse.phase, dense: dense.phase, repeated: repeated.phase }));
  assert.ok(dense.phase.size <= 1.3 && sparse.phase.size >= 0.7);
  at(1); at(33);
  assert.deepEqual(copy(at(20)), dense, 'phase parameters must be seek/export deterministic');
});

test('transients are causal and silence cannot fabricate a kick', () => {
  const pcm = new Float32Array(rate * 4);
  pcm.set(tone(80, 1), rate);
  const { at } = analyse([pcm]);
  assert.equal(at(0.99).features.kick, 0);
  assert.ok(at(1.04).features.energy > 0);
  assert.equal(at(3).features.kick, 0);
});

test('public load supports asynchronous progress and rejects reads after disposal', async () => {
  const pcm = tone(240, 0.4);
  const analysis = createPhaseAnalysis();
  const progress = [];
  await analysis.load({ numberOfChannels: 1, length: pcm.length, sampleRate: rate, getChannelData: () => pcm }, { onProgress: value => progress.push(value) });
  assert.equal(analysis.getFrame(0.3).spectrum.length, 16384);
  assert.equal(analysis.getInfo().fftSize, 32768);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  analysis.dispose();
  assert.throws(() => analysis.getFrame(0.1), /Load audio/);
});

class BrowserWorker {
  constructor(url) {
    const source = `import { parentPort } from 'node:worker_threads'; globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) }; await import(${JSON.stringify(url.href)}); parentPort.on('message', data => self.onmessage({ data }));`;
    this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
  terminate() { this.worker.terminate(); }
}

test('worker retains source audio and rejects replaced or disposed loads', async () => {
  globalThis.Worker = BrowserWorker;
  const analysis = createPhaseAnalysis();
  try {
    const pcm = tone(400, 3);
    const first = analysis.load(buffer([pcm]));
    const replaced = assert.rejects(first, error => error.name === 'AbortError');
    await analysis.load(buffer([new Float32Array(rate / 4)]));
    await replaced;
    assert.equal(pcm.byteLength, rate * 3 * 4);
    assert.ok(analysis.getFrame(0.1).spectrum.every(value => value === 0));
    const next = analysis.load(buffer([pcm]));
    const disposed = assert.rejects(next, error => error.name === 'AbortError');
    analysis.dispose(); await disposed;
    assert.equal(analysis.getInfo().loaded, false);
  } finally { analysis.dispose(); delete globalThis.Worker; }
});

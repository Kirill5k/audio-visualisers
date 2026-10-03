import assert from 'node:assert/strict';
import test from 'node:test';
import { findScopeTrigger, scopeAutoGain, scopeSpan, scopeTraces, scopeSamples, SCOPE_MAX_POINTS } from '../js/phosphor/phosphor-scope.js';
import {
  TELEMETRY_CHANNELS, camelot, keyLabel, telemetryReadout, telemetryNorm, readoutFrame, sparklineSamples, alertAge, alertFlash,
} from '../js/phosphor/phosphor-telemetry.js';
import { PHOSPHOR_FLOOR_DB, PHOSPHOR_BAND_FLOOR_DB } from '../js/phosphor/phosphor-analysis-core.js';

const rate = 48000;
const sine = (hz, length, amplitude = .5, phase = 0) => Float32Array.from({ length }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate + phase));
const channel = id => TELEMETRY_CHANNELS.find(item => item.id === id);
const row = overrides => ({
  loudness: -12, rmsDb: -14, peakDb: -2, centroid: 1500, novelty: .4, attackRate: 3, tempo: 128, key: 14, keyScore: .8,
  correlation: .6, sideShare: .2, bands: [-3, -8, -20], onset: 0, ...overrides,
});

test('scope trigger locks to the rising zero crossing of the bass and stays in the past', () => {
  const pcm = sine(100, rate);
  const trigger = findScopeTrigger(pcm, pcm, 30000, 2000, rate);
  assert.ok(trigger <= 30000 && trigger >= 28000);
  const lowPassDelay = 1 / (2 * Math.PI * 200) * rate;
  const phase = ((trigger - lowPassDelay) % 480 + 480) % 480;
  assert.ok(phase < 24 || phase > 456, `crossing near a cycle start, phase ${phase}`);
  const later = findScopeTrigger(pcm, pcm, 30000 + 480, 2000, rate);
  assert.equal(later - trigger, 480, 'one cycle later triggers exactly one period later');
  assert.equal(findScopeTrigger(new Float32Array(rate), new Float32Array(rate), 30000, 2000, rate), 30000, 'silence free-runs');
  const span = scopeSpan(46, rate);
  for (const trace of scopeTraces(pcm, pcm, rate, .5, { span, traces: 10 })) {
    assert.ok(trace.start + span <= Math.round((.5 - trace.age * 2 / 60) * rate), 'every trace window ends before its time');
  }
});

test('scope auto-gain, spans and decimation stay within bounds', () => {
  close(scopeAutoGain(sine(100, rate, .425), sine(100, rate, .425), rate, rate), 2, .01);
  assert.equal(scopeAutoGain(sine(100, rate, 1), sine(100, rate, 1), rate, rate), 1);
  assert.equal(scopeAutoGain(new Float32Array(rate), new Float32Array(rate), rate, rate), 16);
  const burst = sine(100, rate * 2, .1);
  burst.fill(.85, rate - 100, rate);
  assert.equal(scopeAutoGain(burst, burst, rate, rate), 1, 'a peak within the last half second holds the gain down');
  close(scopeAutoGain(burst, burst, rate * 1.6, rate), 8.5, .01);
  assert.equal(scopeSpan(46, 44100), 2029);
  assert.equal(scopeSpan(12345, 44100), 2029, 'unknown windows fall back to 46 ms');
  const { count, step } = scopeSamples(sine(100, rate), sine(100, rate), 0, scopeSpan(93, rate));
  assert.ok(count <= SCOPE_MAX_POINTS && step === 5);
  assert.equal(scopeTraces(sine(100, 100), sine(100, 100), rate, .001, { span: 2048, traces: 10 }).length, 0, 'no trace before enough audio');
});

function close(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}

test('telemetry readouts format values and show an em dash when undefined', () => {
  assert.equal(TELEMETRY_CHANNELS.length, 12);
  assert.equal(telemetryReadout(channel('loudness'), row()), '−12.0');
  assert.equal(telemetryReadout(channel('loudness'), row({ loudness: PHOSPHOR_FLOOR_DB })), '—');
  assert.equal(telemetryReadout(channel('crest'), row()), '12.0');
  assert.equal(telemetryReadout(channel('centroid'), row({ centroid: 12345.6 })), '12,346');
  assert.equal(telemetryReadout(channel('flux'), row({ novelty: 1.4 })), '100');
  assert.equal(telemetryReadout(channel('correlation'), row({ correlation: -.25 })), '−0.25');
  assert.equal(telemetryReadout(channel('tempo'), row({ tempo: NaN })), '—');
  assert.equal(telemetryReadout(channel('key'), row()), 'Dm · 7A');
  assert.equal(telemetryReadout(channel('mix'), row()), 'LOW');
  assert.equal(telemetryReadout(channel('mix'), row({ bands: [PHOSPHOR_BAND_FLOOR_DB, -2, -1] })), 'HIGH');
  assert.equal(telemetryReadout(channel('mix'), row({ rmsDb: PHOSPHOR_FLOOR_DB })), '—');
  assert.deepEqual(camelot(9, true), { number: 8, letter: 'A' });
  assert.equal(keyLabel(0), 'C · 8B');
  assert.equal(keyLabel(-1), '—');
  close(telemetryNorm(channel('centroid'), 1095.4, {}), .5, .01);
  assert.equal(telemetryNorm(channel('tempo'), 131, { bpm: 128 }), 1);
});

test('readouts refresh at 10 Hz on absolute frames', () => {
  assert.deepEqual([0, 5, 6, 11, 12, -1].map(readoutFrame), [0, 0, 6, 6, 12, -6]);
});

test('sparklines sample an absolute grid, keep spikes with max reduction and end at the head', () => {
  const values = f => f === 503 ? 100 : f % 10;
  const a = sparklineSamples(values, 600, 10), b = sparklineSamples(values, 601, 10);
  assert.equal(a.at(-1).frame, 600);
  assert.equal(b.at(-1).frame, 601);
  assert.ok(a.every(s => s.frame % 5 === 0) && b.slice(0, -1).every(s => s.frame % 5 === 0), 'grid frames do not move');
  const shared = new Map(a.map(s => [s.frame, s.value]));
  assert.ok(b.slice(0, -1).every(s => !shared.has(s.frame) || shared.get(s.frame) === s.value));
  assert.ok(a.every(s => s.frame >= 0 && s.frame <= 600));
  assert.ok(!a.some(s => s.value === 100), 'last-value sampling can miss a spike');
  assert.ok(sparklineSamples(values, 600, 10, { reduce: 'max' }).some(s => s.value === 100), 'max sampling keeps it');
  assert.ok(sparklineSamples(() => NaN, 600, 10).every(s => Number.isNaN(s.value)));
});

test('alerts flash on recent threshold crossings and decay', () => {
  const peak = channel('peak');
  assert.equal(alertAge(peak, f => f === 590 ? 0 : -6, 600), 10 / 60);
  assert.equal(alertAge(peak, () => -6, 600), Infinity);
  assert.equal(alertAge(channel('rms'), () => 0, 600), Infinity, 'channels without alerts never flash');
  assert.equal(alertFlash(0), 1);
  assert.equal(alertFlash(Infinity), 0);
  assert.ok(alertFlash(.45) < .37 && alertFlash(.45) > .36);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../js/particle-dance/particle-dance-settings.js';
import { createParticleDanceSimulation } from '../js/particle-dance/particle-dance-simulation.js';
import { createParticleDanceMotion } from '../js/particle-dance/particle-dance-motion.js';

const keys = ['elasticExpansion', 'twistingCurrents', 'travellingRipples', 'particleJets', 'gatheringRelease'];
const off = Object.fromEntries(keys.map(key => [key, false]));
const settings = () => ({ ...createSettings(), ...off, particleCount: 260, audioSizeReactivity: 0 });
function spectrum(frame) {
  const data = new Uint8Array(512);
  if (frame % 30 >= 5 && frame % 30 < 12) data.fill(210);
  return data;
}
function run(simulation, config, frames = 100) {
  for (let f = 0; f < frames; f++) simulation.step(config, spectrum(f));
}
const copy = sim => Object.fromEntries(Object.entries(sim.output).map(([key, value]) => [key, ArrayBuffer.isView(value) ? [...value] : structuredClone(value)]));

for (const key of keys) test(`${key} changes particle positions independently of sprite size`, () => {
  const config = settings();
  const still = createParticleDanceSimulation({ settings: config });
  const reactive = createParticleDanceSimulation({ settings: { ...config, [key]: true } });
  let largest = 0;
  for (let frame = 0; frame < 90; frame++) {
    still.step(config, spectrum(frame));
    reactive.step({ ...config, [key]: true }, spectrum(frame));
    largest = Math.max(largest, ...reactive.output.positions.slice(0, config.particleCount * 3).map((x, i) => Math.abs(x - still.output.positions[i])));
  }
  assert.ok(largest > .03, `${key} produced no visible displacement (${largest})`);
  assert.deepEqual(reactive.output.sizes, still.output.sizes, 'Movement must not depend on flashing');
});

test('all switches off preserve base motion and immediately remove deformation and jet trails', () => {
  const config = settings(), on = { ...config, ...Object.fromEntries(keys.map(k => [k, true])) };
  const baseline = createParticleDanceSimulation({ settings: config });
  const reactive = createParticleDanceSimulation({ settings: on });
  run(baseline, config, 40); run(reactive, on, 40);
  assert.ok(reactive.output.jetTrailCount > 0);
  reactive.step(config, spectrum(39), 0);
  assert.deepEqual(reactive.output.positions, baseline.output.positions);
  assert.equal(reactive.output.jetTrailCount, 0);
  assert.deepEqual(reactive.particles, baseline.particles, 'Audio motion must not corrupt the underlying swarm or random sequence');
});

test('all motion histories replay deterministically and paused redraws do not advance them', () => {
  const config = { ...settings(), ...Object.fromEntries(keys.map(k => [k, true])) };
  const sim = createParticleDanceSimulation({ settings: config });
  run(sim, config, 100);
  const expected = copy(sim);
  for (let i = 0; i < 10; i++) sim.step(config, spectrum(99), 0);
  assert.deepEqual(copy(sim), expected);
  sim.reset(config); run(sim, config, 100);
  assert.deepEqual(copy(sim), expected);
});

test('motion remains bounded through prolonged loud audio, respawns and particle count changes', () => {
  const config = { ...settings(), ...Object.fromEntries(keys.map(k => [k, true])), decayRate: 2 };
  const sim = createParticleDanceSimulation({ settings: config });
  for (let i = 0; i < 1200; i++) {
    sim.step(config, spectrum(i));
    assert.ok(sim.output.positions.every(Number.isFinite));
    assert.ok(sim.output.positions.every(value => Math.abs(value) < config.spread * 3));
    assert.ok(sim.output.jetTrailPositions.every(Number.isFinite));
  }
  sim.step({ ...config, particleCount: 50 }, spectrum(5));
  assert.ok(sim.output.jetTrailCount <= Math.ceil(50 / 13) * 5);
});

test('a ripple reaches outer particles later than inner particles, then clears', () => {
  const config = { ...settings(), particleCount: 2, spread: 8, travellingRipples: true,
    attractionStrength: 0, breezeStrength: 0, damping: .9, decayRate: 0 };
  const sim = createParticleDanceSimulation({ settings: config });
  for (let i = 0; i < 2; i++) Object.assign(sim.particles[i], { x: i ? 4 : 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  const peaks = [{ value: 0, frame: 0 }, { value: 0, frame: 0 }];
  for (let frame = 0; frame < 100; frame++) {
    sim.step(config, new Uint8Array(512).fill(frame === 3 ? 230 : 0));
    for (let i = 0; i < 2; i++) {
      const delta = sim.output.positions[i * 3] - (i ? 4 : 1);
      if (delta > peaks[i].value) peaks[i] = { value: delta, frame };
    }
  }
  assert.ok(peaks[0].value > .1 && peaks[1].value > .1);
  assert.ok(peaks[1].frame > peaks[0].frame + 10, 'Wave should travel, not scale the whole cloud simultaneously');
  assert.equal(sim.output.positions[0], 1);
  assert.equal(sim.output.positions[3], 4);
});

test('jets affect a sparse subset and return after an isolated hit', () => {
  const config = { ...settings(), particleJets: true }, baselineConfig = settings();
  const sim = createParticleDanceSimulation({ settings: config });
  const baseline = createParticleDanceSimulation({ settings: baselineConfig });
  let affected = 0;
  for (let frame = 0; frame < 180; frame++) {
    const data = new Uint8Array(512);
    if (frame === 3) data.fill(230, 300);
    sim.step(config, data); baseline.step(baselineConfig, data);
    if (frame === 12) {
      for (let i = 0; i < config.particleCount; i++) {
        if (Math.abs(sim.output.positions[i * 3] - baseline.output.positions[i * 3]) > .001) affected++;
      }
    }
  }
  assert.ok(affected > 0 && affected <= Math.ceil(config.particleCount / 13));
  assert.equal(sim.output.jetTrailCount, 0);
  assert.ok(sim.output.positions.every((value, i) => Math.abs(value - baseline.output.positions[i]) < .001));
});

test('gathering is continuous across lobe boundaries', () => {
  const config = { ...settings(), gatheringRelease: true, particleCount: 2, spread: 8 };
  const motion = createParticleDanceMotion(2), silent = new Uint8Array(512);
  for (let i = 0; i < 600; i++) motion.begin(config, silent, 1 / 60, {});
  const p = new Float32Array([3 * Math.cos(Math.PI / 3 - .00001), 0, 3 * Math.sin(Math.PI / 3 - .00001),
    3 * Math.cos(Math.PI / 3 + .00001), 0, 3 * Math.sin(Math.PI / 3 + .00001)]);
  motion.apply(config, p, 0, 0); motion.apply(config, p, 1, 0);
  assert.ok(Math.hypot(p[0] - p[3], p[2] - p[5]) < .001);
});

test('twisting remains smooth when a particle changes radius after five minutes', () => {
  const config = { ...settings(), twistingCurrents: true, particleCount: 1, spread: 8 };
  const motion = createParticleDanceMotion(1), sustained = new Uint8Array(512).fill(180), p = new Float32Array(3);
  for (let i = 0; i < 18000; i++) {
    motion.begin(config, sustained, 1 / 60, {}); p.set([3, 0, 0]); motion.apply(config, p, 0, 1 / 60);
  }
  const before = [...p]; p.set([3.01, 0, 0]); motion.apply(config, p, 0, 0);
  assert.ok(Math.hypot(...p.map((value, i) => value - before[i])) < .02);
});

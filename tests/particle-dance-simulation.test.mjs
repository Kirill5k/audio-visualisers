import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../js/particle-dance/particle-dance-settings.js';
import { createParticleDanceSimulation, MAX_PARTICLES, MAX_CONNECTIONS } from '../js/particle-dance/particle-dance-simulation.js';
import { createMeshGridSpectrumTransform } from '../js/mesh-grid/mesh-grid-analysis.js';

const snapshot = simulation => ({
  particles: structuredClone(simulation.particles), time: simulation.time,
  buffers: Object.fromEntries(Object.entries(simulation.output).map(([key, value]) => [key, ArrayBuffer.isView(value) ? [...value] : value])),
});

test('seeded replay reproduces complete state through particle expiry and respawning', () => {
  const settings = { ...createSettings(), particleCount: 150, decayRate: 2 };
  const first = createParticleDanceSimulation({ settings, seed: 42 });
  const second = createParticleDanceSimulation({ settings, seed: 42 });
  for (let frame = 0; frame < 100; frame++) {
    const spectrum = Uint8Array.from({ length: 512 }, (_, i) => (frame * 7 + i * 3) % 256);
    first.step(settings, spectrum, 1 / 60);
    second.step(settings, spectrum, 1 / 60);
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  const final = snapshot(first);
  first.reset(settings);
  for (let frame = 0; frame < 100; frame++) {
    first.step(settings, Uint8Array.from({ length: 512 }, (_, i) => (frame * 7 + i * 3) % 256), 1 / 60);
  }
  assert.deepEqual(snapshot(first), final);
  const different = createParticleDanceSimulation({ settings, seed: 43 });
  assert.notDeepEqual(different.particles[0], createParticleDanceSimulation({ settings, seed: 42 }).particles[0]);
});

test('zero-delta repaint changes no physics, randomness or connection buffers', () => {
  const settings = { ...createSettings(), particleCount: 250, showConnections: true, densityGlow: true };
  const simulation = createParticleDanceSimulation({ settings });
  const spectrum = new Uint8Array(512).fill(130);
  for (let i = 0; i < 15; i++) simulation.step(settings, spectrum);
  const before = snapshot(simulation);
  for (let i = 0; i < 5; i++) simulation.step(settings, spectrum, 0);
  assert.deepEqual(snapshot(simulation), before);
});

test('audio sizes sample the full stretched spectrum after capping', () => {
  const settings = { ...createSettings(), particleCount: 100, densityGlow: false, decayRate: 0, showConnections: false };
  const input = new Uint8Array(512);
  input.fill(255, 90, 179);
  const frame = createMeshGridSpectrumTransform().process(input, settings);
  assert.equal(frame.effectiveRange, 179);
  assert.equal(frame.spectrum.length, 512);
  const simulation = createParticleDanceSimulation({ settings });
  simulation.step(settings, frame.spectrum, 0);
  // Particle #90 hears the upper portion of the stretched spectrum, not bin161.
  assert.ok(Math.abs(simulation.output.sizes[90] / (settings.particleSize * simulation.particles[90].baseSize) - 3.9) < 1e-6);
  assert.ok(Math.abs(simulation.output.sizes[0] / (settings.particleSize * simulation.particles[0].baseSize) - 1) < 1e-6);
});

test('source damping, boundary and moving hotspot equations retain the 120 Hz scale', () => {
  const settings = { ...createSettings(), particleCount: 1, spread: 20, decayRate: 0,
    attractionStrength: 0, breezeStrength: 0, damping: .5, densityGlow: false, showConnections: false };
  const simulation = createParticleDanceSimulation({ settings });
  Object.assign(simulation.particles[0], { x: 0, y: 0, z: 0, vx: 1, vy: 2, vz: 3 });
  simulation.step(settings, new Uint8Array(512), 1 / 60);
  assert.equal(simulation.time, .032);
  assert.deepEqual([simulation.particles[0].x, simulation.particles[0].y, simulation.particles[0].z], [.5, 1, 1.5]);
  assert.ok(Math.abs(simulation.output.hotspotPositions[0] - Math.cos(.016) * 10) < 1e-6);
});

test('live particle/hotspot counts are capped and zero decay remains finite', () => {
  const settings = { ...createSettings(), particleCount: 5000, hotspotCount: 50,
    decayRate: 0, showConnections: true, spread: 2 };
  const simulation = createParticleDanceSimulation({ settings });
  simulation.step(settings, new Uint8Array(512));
  assert.equal(simulation.output.count, MAX_PARTICLES);
  assert.equal(simulation.output.hotspotCount, 20);
  assert.ok(simulation.output.connectionCount <= MAX_CONNECTIONS);
  assert.ok(simulation.output.positions.every(Number.isFinite));
  assert.ok(simulation.output.colors.every(Number.isFinite));
  assert.ok(simulation.output.sizes.every(Number.isFinite));
  simulation.step({ ...settings, particleCount: 50 }, new Uint8Array(512), 0);
  assert.ok(simulation.output.sizes.subarray(50).every(value => value === 0));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { terrainEnergy } from '../js/atlas/signal-atlas-color.js';

test('energy hue remains neutral in silence and saturates at a bounded loudness', () => {
  assert.equal(terrainEnergy(null), 0);
  assert.equal(terrainEnergy({ lRms: 0, rRms: 0 }), 0);
  assert.equal(terrainEnergy({ lRms: NaN, rRms: -1 }), 0);
  assert.equal(terrainEnergy({ lRms: 1, rRms: 1 }), 1);
  const midpoint = 10 ** (-26 / 20);
  assert.ok(Math.abs(terrainEnergy({ lRms: midpoint, rRms: midpoint }) - .5) < 1e-12);
});

test('energy hue combines both channels without cancellation or a left-channel bias', () => {
  const left = terrainEnergy({ lRms: .1, rRms: 0 });
  const right = terrainEnergy({ lRms: 0, rRms: .1 });
  assert.equal(left, right);
  assert.ok(terrainEnergy({ lRms: .1, rRms: .1 }) > left);
});

test('energy hue depends only on the current analysed track time', () => {
  const levels = { lRms: .085, rRms: .092 };
  const atTime = terrainEnergy(levels);
  terrainEnergy({ lRms: 1, rRms: 1 });
  terrainEnergy({ lRms: 0, rRms: 0 });
  assert.equal(terrainEnergy(levels), atTime);
});

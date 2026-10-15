/**
 * Original Light Fall trail equations adapted from Vizz.fm with permission.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-d2d9ec860a756c37.js
 * Source SHA-256: b5a11ca462673f6660f4a9cec6a3f551f0df9a874e8fe2897e67c2cad55cb416
 * Retrieved 2026-10-12. No additional license is granted.
 * A seeded setup and explicit delta time make preview and export repeatable.
 */

export const MAX_TRAILS = 700;
export const DEFAULT_SEED = 0x1f411;
export const PALETTE_HUE_OFFSETS = [0.05813461, 0.04375552, 0.13003003, 0.11347675];
export const PALETTE_LIGHTNESS_FACTORS = [0.7044199, 0.7044199, 0.7044199, 0.6767956];

export function createSeededRandom(seed = DEFAULT_SEED) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function trailSlotX(normalized) {
  const curved = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1.2);
  return (0.5 * normalized + 0.5 * curved) * 80;
}

export function bendUv(radius) {
  const flat = 132.75 - (-160 + radius);
  return flat / (flat + Math.PI * radius * 0.5 + Math.max(0.1, 200 - radius));
}

/** Exactly the upstream call order and distributions, including hidden trails. */
export function createTrailLayout(seed = DEFAULT_SEED) {
  const random = createSeededRandom(seed);
  return Array.from({ length: MAX_TRAILS }, (_, index) => {
    const baseSlotX = trailSlotX((index / (MAX_TRAILS - 1)) * 2 - 1);
    const colorIndex = Math.floor(5 * random());
    const baseTailLength = 0.4 * random() + 0.3;
    const geometryX = baseSlotX + (random() - 0.5) * 2;
    const radius = 0.2 * random() + 0.1;
    const speed = 0.5 * random() + 0.2;
    const offset = random();
    return { baseSlotX, colorIndex, baseTailLength, geometryX, radius, speed, offset };
  });
}

export function smoothTrailEnergy(previous, target, retention, dt) {
  return Number.isNaN(target) ? previous : Number.isNaN(previous) ? target
    : previous + (target - previous) * (1 - Math.pow(retention, 120 * dt));
}

/** Displayed positions are ranked center-out; frequency is symmetric by rank. */
export function normalizedTrailRank(index, count) {
  const visibleCount = Math.ceil(count);
  if (visibleCount <= 1) return 0;
  const start = -Math.floor((visibleCount - 1) / 2);
  const rank = (index === 0 ? 0 : index % 2 === 1 ? Math.ceil(index / 2) : -Math.ceil(index / 2)) - start;
  return Math.max(-1, Math.min(1, (rank / Math.max(1, count - 1)) * 2 - 1));
}

export function createLightFallTrails({ seed = DEFAULT_SEED } = {}) {
  const layout = createTrailLayout(seed);
  // Upstream stores both envelopes as Float32, including its rounding behavior.
  const slowEnergy = new Float32Array(MAX_TRAILS);
  const fastEnergy = new Float32Array(MAX_TRAILS);
  const offsetX = new Float64Array(MAX_TRAILS);
  const tailLength = new Float64Array(MAX_TRAILS);
  const intensity = new Float64Array(MAX_TRAILS);
  const frequencyIndex = new Uint32Array(MAX_TRAILS);
  const output = { layout, slowEnergy, fastEnergy, offsetX, tailLength, intensity, frequencyIndex, count: 0, time: 0, bass: 0 };

  function step(settings, spectrum, dt = 1 / 60) {
    const delta = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const count = Math.max(0, Math.min(MAX_TRAILS, settings.trailCount));
    const visibleCount = Math.ceil(count);
    const audioReactivity = settings.audioReactivity ?? 0;
    output.time += delta * (settings.speedMultiplier ?? 0.1);
    output.count = visibleCount;
    intensity.fill(0, visibleCount);
    for (let index = 0; index < visibleCount; index++) {
      const normalized = normalizedTrailRank(index, count);
      offsetX[index] = trailSlotX(normalized) * (settings.trailSpread ?? 1) - layout[index].baseSlotX;
      const bin = Math.max(0, Math.min(Math.floor(Math.abs(normalized) * (spectrum.length - 1)), spectrum.length - 1));
      frequencyIndex[index] = bin;
      const energy = ((spectrum[bin] ?? 0) / 255 * (settings.sensitivity ?? 5)) ** 1.5;
      slowEnergy[index] = smoothTrailEnergy(slowEnergy[index], energy, 0.85, delta);
      fastEnergy[index] = smoothTrailEnergy(fastEnergy[index], energy, 0.35, delta);
      tailLength[index] = Math.min(0.95, layout[index].baseTailLength * (1 + slowEnergy[index] * audioReactivity * 0.6));
      intensity[index] = index === visibleCount - 1 && count < visibleCount ? count - Math.floor(count) : 1;
    }
    const bassBins = Math.floor(spectrum.length * 0.1);
    let sum = 0;
    for (let index = 0; index < bassBins; index++) sum += spectrum[index];
    output.bass = bassBins > 0 ? sum / bassBins / 255 : 0;
    return output;
  }

  function reset() {
    output.time = output.bass = output.count = 0;
    slowEnergy.fill(0);
    fastEnergy.fill(0);
    offsetX.fill(0);
    intensity.fill(0);
    frequencyIndex.fill(0);
    for (let index = 0; index < MAX_TRAILS; index++) tailLength[index] = layout[index].baseTailLength;
  }
  reset();
  return { output, step, reset };
}

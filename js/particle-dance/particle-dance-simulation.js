/* Particle Dance adapted with permission from vizz.fm, (c) 2026 Mathew Preziotte.
 * Source release 6283820, retrieved 2026-10-08. No additional license granted.
 * The particle equations, spatial hash and allocation order follow the source.
 * A seeded generator and a zero-delta repaint path make seek/export repeatable.
 */

export const MAX_PARTICLES = 2000;
export const MAX_CONNECTIONS = 3000;
export const MAX_HOTSPOTS = 20;
export const DEFAULT_SEED = 0x70617274;

export function createSeededRandom(seed = DEFAULT_SEED) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class SpatialHash {
  constructor(cellSize = 1.5) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.neighbors = [];
  }
  clear() { this.cells.clear(); }
  insert(index, x, y, z) {
    const key = `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)},${Math.floor(z / this.cellSize)}`;
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = []);
    cell.push(index);
  }
  getNeighbors(x, y, z) {
    this.neighbors.length = 0;
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize), cz = Math.floor(z / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (cell) for (const index of cell) this.neighbors.push(index);
    }
    return this.neighbors;
  }
}

function linearColor(hex) {
  let text = hex.replace('#', '');
  if (text.length === 3) text = text.split('').map(value => value + value).join('');
  const value = parseInt(text, 16);
  return [value >>> 16, (value >>> 8) & 255, value & 255].map(byte => {
    const c = byte / 255;
    return c < .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  });
}

function rainbow(hue) {
  const hueChannel = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return t * 6;
    if (t < .5) return 1;
    if (t < 2 / 3) return (2 / 3 - t) * 6;
    return 0;
  };
  return [hueChannel(hue + 1 / 3), hueChannel(hue), hueChannel(hue - 1 / 3)];
}

/** Pure CPU state; typed output buffers are reused until the next step. */
export function createParticleDanceSimulation({ settings, seed = DEFAULT_SEED }) {
  let random, time = 0, densityValid = false, hashValid = false;
  const particles = [];
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const sizes = new Float32Array(MAX_PARTICLES);
  const fade = new Float32Array(MAX_PARTICLES);
  const sizeRatios = new Float32Array(MAX_PARTICLES);
  const density = new Float32Array(MAX_PARTICLES);
  const hotspotPositions = new Float32Array(MAX_HOTSPOTS * 3);
  const hotspotIntensities = new Float32Array(MAX_HOTSPOTS);
  const connectionPositions = new Float32Array(MAX_CONNECTIONS * 6);
  const connectionColors = new Float32Array(MAX_CONNECTIONS * 6);
  const hash = new SpatialHash();
  const output = { positions, colors, sizes, fade, sizeRatios, density, hotspotPositions,
    hotspotIntensities, connectionPositions, connectionColors, count: 0, hotspotCount: 0, connectionCount: 0, bass: 0 };

  function reset(config = settings) {
    random = createSeededRandom(seed);
    time = 0;
    densityValid = false;
    hashValid = false;
    particles.length = 0;
    // The source caches all six initial values before sampling life/baseSize.
    const initial = new Float32Array(MAX_PARTICLES * 6);
    for (let i = 0; i < initial.length; i++) initial[i] = random() - .5;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const offset = i * 6;
      particles.push({ x: initial[offset] * config.spread, y: initial[offset + 1] * config.spread,
        z: initial[offset + 2] * config.spread, vx: .1 * initial[offset + 3],
        vy: .1 * initial[offset + 4], vz: .1 * initial[offset + 5],
        life: 100 * random(), baseSize: .5 + .5 * random() });
    }
    density.fill(0);
    sizes.fill(0);
    hash.clear();
    return step(config, new Uint8Array(config.fftSize / 2), 0);
  }

  function step(config, spectrum, dt = 1 / 60) {
    const delta = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    const k = 120 * delta;
    time += .016 * k;
    const count = Math.max(0, Math.min(Math.ceil(config.particleCount), MAX_PARTICLES));
    const hotspotCount = Math.max(1, Math.min(Math.ceil(config.hotspotCount), MAX_HOTSPOTS));
    const radius = config.spread * .5;
    for (let i = 0; i < hotspotCount; i++) {
      const angle = i / hotspotCount * Math.PI * 2 + .5 * time;
      hotspotPositions[i * 3] = Math.cos(angle) * radius;
      hotspotPositions[i * 3 + 1] = Math.sin(.3 * time + i) * radius * .5;
      hotspotPositions[i * 3 + 2] = Math.sin(angle) * radius;
      hotspotIntensities[i] = config.hotspotIntensity;
    }
    // Preserve the upstream pre-integration hash when connecting after a step.
    // Repainting the same frame retains its cached density, so pause is inert.
    if ((config.densityGlow || config.showConnections) && (delta > 0 || !hashValid || count !== output.count)) {
      hash.clear();
      for (let i = 0; i < count; i++) {
        const p = particles[i]; hash.insert(i, p.x, p.y, p.z);
      }
      hashValid = true;
    }
    if (!(config.densityGlow || config.showConnections)) hashValid = false;
    if (config.densityGlow && (delta > 0 || !densityValid || count !== output.count)) {
      for (let i = 0; i < count; i++) {
        const p = particles[i]; let total = 0;
        for (const neighbor of hash.getNeighbors(p.x, p.y, p.z)) {
          if (neighbor === i) continue;
          const other = particles[neighbor];
          const dx = other.x - p.x, dy = other.y - p.y, dz = other.z - p.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared < 9) total += (1 - Math.sqrt(distanceSquared) / 3) ** 2;
        }
        density[i] = Math.min(total / 8, 1);
      }
      densityValid = true;
    } else if (!config.densityGlow) densityValid = false;
    const velocityDamping = Math.pow(config.damping, k);
    const boundary = .8 * config.spread, boundarySquared = boundary * boundary;
    const rgb = linearColor(config.particleColor);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      if (delta > 0) {
        for (let h = 0; h < hotspotCount; h++) {
          const index = h * 3;
          const dx = hotspotPositions[index] - p.x, dy = hotspotPositions[index + 1] - p.y, dz = hotspotPositions[index + 2] - p.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) + .5;
          const force = hotspotIntensities[h] * config.attractionStrength * .1 / distance;
          p.vx += dx / distance * force * k;
          p.vy += dy / distance * force * k;
          p.vz += dz / distance * force * k;
        }
        if (config.breezeStrength > 0) {
          const strength = .02 * config.breezeStrength;
          const x = .3 * p.x + .5 * time, y = .3 * p.y + .3 * time, z = .3 * p.z + .4 * time;
          p.vx += (Math.sin(2.1 * y) + Math.cos(1.7 * z)) * strength * k;
          p.vy += (Math.sin(1.9 * z) + Math.cos(2.3 * x)) * strength * k;
          p.vz += (Math.sin(2 * x) + Math.cos(1.8 * y)) * strength * k;
        }
        p.vx *= velocityDamping; p.vy *= velocityDamping; p.vz *= velocityDamping;
        p.x += p.vx * k; p.y += p.vy * k; p.z += p.vz * k;
        const distanceSquared = p.x * p.x + p.y * p.y + p.z * p.z;
        if (distanceSquared > boundarySquared) {
          const distance = Math.sqrt(distanceSquared), inward = (distance - boundary) * .05 * k;
          const scale = (distance - inward) / distance;
          p.x *= scale; p.y *= scale; p.z *= scale;
        }
        p.life -= config.decayRate * k;
        if (config.decayRate > 0 && p.life <= 0) {
          p.life = 100;
          const index = 3 * Math.floor(random() * hotspotCount);
          p.x = hotspotPositions[index] + (random() - .5) * 2;
          p.y = hotspotPositions[index + 1] + (random() - .5) * 2;
          p.z = hotspotPositions[index + 2] + (random() - .5) * 2;
          p.vx = (random() - .5) * .1; p.vy = (random() - .5) * .1; p.vz = (random() - .5) * .1;
        }
      }
      let opacity = 1;
      if (config.decayRate > 0) {
        const life = p.life / 100, threshold = 1 - config.fadeInDuration;
        opacity = config.fadeInDuration > 0 && life > threshold
          ? 1 - (life - threshold) / config.fadeInDuration : threshold > 0 ? life / threshold : life;
      }
      fade[i] = opacity;
      const localDensity = config.densityGlow ? density[i] : 0;
      const boost = 1 + 2 * localDensity;
      const index = i * 3;
      positions[index] = p.x; positions[index + 1] = p.y; positions[index + 2] = p.z;
      const rainbowRgb = config.rainbowAmount > 0 ? rainbow(i / count * .85) : rgb;
      for (let channel = 0; channel < 3; channel++) {
        const base = rgb[channel] * (1 - config.rainbowAmount) + rainbowRgb[channel] * config.rainbowAmount;
        colors[index + channel] = Math.min(base * boost + .5 * localDensity, 1) * opacity;
      }
      let response = 1;
      if (config.audioSizeReactivity > 0) {
        const bin = Math.min(Math.floor(i / count * spectrum.length), spectrum.length - 1);
        response += (spectrum[bin] || 0) / 255 * config.audioSizeReactivity;
      }
      const size = config.particleSize * p.baseSize * (.5 + .5 * opacity) * response;
      sizes[i] = size;
      sizeRatios[i] = config.particleSize > 0 ? size / config.particleSize : 0;
    }
    sizes.fill(0, count);
    let connectionCount = 0;
    if (config.showConnections) for (let i = 0; i < count && connectionCount < MAX_CONNECTIONS; i++) {
      const p = particles[i];
      for (const neighbor of hash.getNeighbors(p.x, p.y, p.z)) {
        if (neighbor <= i || connectionCount >= MAX_CONNECTIONS) continue;
        const other = particles[neighbor];
        const dx = other.x - p.x, dy = other.y - p.y, dz = other.z - p.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared < 2.25) {
          const intensity = (1 - distanceSquared / 2.25) * Math.min(fade[i], fade[neighbor]) * ((sizeRatios[i] + sizeRatios[neighbor]) * .5);
          const index = connectionCount * 6;
          connectionPositions.set([p.x, p.y, p.z, other.x, other.y, other.z], index);
          for (let channel = 0; channel < 3; channel++) {
            connectionColors[index + channel] = connectionColors[index + channel + 3] = rgb[channel] * intensity;
          }
          connectionCount++;
        }
      }
    }
    let bass = 0;
    const bassBins = Math.floor(.1 * spectrum.length);
    for (let i = 0; i < bassBins; i++) bass += spectrum[i];
    output.bass = bassBins ? bass / bassBins / 255 * (config.sensitivity ?? 1) : 0;
    output.count = count; output.hotspotCount = hotspotCount; output.connectionCount = connectionCount;
    return output;
  }
  reset();
  return { step, reset, particles, output, get time() { return time; } };
}

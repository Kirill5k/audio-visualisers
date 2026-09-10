/** Deterministic, bounded constellation topology. No rendering or browser dependencies. */
export const CONSTELLATION_CANDIDATES = 2048;
export const CONSTELLATION_MAX_LINKS = 512;
export const CONSTELLATION_DEPTH = 2600;

const mod = (n, d) => ((n % d) + d) % d;
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

export class ConstellationNetwork {
  constructor({ count = CONSTELLATION_CANDIDATES, seed = 0x716ab3 } = {}) {
    this.count = count;
    this.seed = seed;
    this.base = new Float32Array(count * 3);
    this.positions = new Float32Array(count * 3);
    this.fades = new Float32Array(count);
    this.nodeLight = new Float32Array(count);
    this.bands = new Uint8Array(count);
    this.degree = new Uint8Array(count);
    this.cellSize = 260;
    this.cells = new Map();
    for (let i = 0; i < count; i++) {
      this.base[i * 3] = (hash(seed + i * 11) * 2 - 1) * 1500;
      this.base[i * 3 + 1] = (hash(seed + i * 11 + 1) * 2 - 1) * 1100;
      this.base[i * 3 + 2] = hash(seed + i * 11 + 2) * CONSTELLATION_DEPTH;
      this.bands[i] = Math.floor(hash(seed + i * 11 + 3) * 32);
      const key = this.cellKey(this.base[i * 3], this.base[i * 3 + 1], this.base[i * 3 + 2]);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(i);
    }
    this.reset();
    this.updatePositions(0);
    const neighbourSkeleton = Array.from({ length: count }, () => []);
    const skeletonDegree = new Uint8Array(count);
    const pairs = [];
    for (let i = 0; i < count; i++) {
      for (const other of this.neighbours(i, 560)) {
        if (other.index <= i) continue;
        pairs.push({ a: i, b: other.index, score: other.d2 / (560 * 560) + hash(i * 1709 + other.index * 71) * 0.24 });
      }
    }
    pairs.sort((a, b) => a.score - b.score);
    for (const pair of pairs) {
      if (skeletonDegree[pair.a] >= 3 || skeletonDegree[pair.b] >= 3) continue;
      skeletonDegree[pair.a]++;
      skeletonDegree[pair.b]++;
      neighbourSkeleton[pair.a].push(pair.b);
      neighbourSkeleton[pair.b].push(pair.a);
    }
    this.neighbourSkeleton = neighbourSkeleton;
  }

  cellKey(x, y, z) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  reset() {
    this.links = [];
    this.degree.fill(0);
    this.nodeLight.fill(0);
    this.lastBirth = new Int32Array(32).fill(-10000);
    this.previousOnsets = new Float32Array(32);
    this.lastFrame = -1;
    this.lastEventSlot = -1;
    this.birthCount = 0;
    this.events = 0;
    this.visibleLinks = 0;
  }

  updatePositions(distance) {
    for (let i = 0; i < this.count; i++) {
      const p = i * 3;
      const depth = mod(this.base[p + 2] - distance, CONSTELLATION_DEPTH) + 3;
      this.positions[p] = this.base[p];
      this.positions[p + 1] = this.base[p + 1];
      this.positions[p + 2] = -depth;
      this.fades[i] = smooth(16, 100, depth) * (1 - smooth(2380, 2600, depth));
    }
  }

  neighbours(index, reach) {
    const p = index * 3;
    if (this.neighbourSkeleton) {
      return this.neighbourSkeleton[index].flatMap(other => {
        if (this.fades[other] < 0.2) return [];
        const q = other * 3;
        const dx = this.positions[p] - this.positions[q];
        const dy = this.positions[p + 1] - this.positions[q + 1];
        const dz = this.positions[p + 2] - this.positions[q + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        return d2 <= reach * reach ? [{ index: other, d2 }] : [];
      });
    }
    const bx = Math.floor(this.base[p] / this.cellSize);
    const by = Math.floor(this.base[p + 1] / this.cellSize);
    const bz = Math.floor(this.base[p + 2] / this.cellSize);
    const radius = Math.ceil(reach / this.cellSize);
    const found = [];
    const reach2 = reach * reach;
    for (let z = bz - radius; z <= bz + radius; z++) {
      for (let y = by - radius; y <= by + radius; y++) {
        for (let x = bx - radius; x <= bx + radius; x++) {
          const bucket = this.cells.get(`${x},${y},${mod(z, 10)}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === index || this.degree[other] >= 3 || this.fades[other] < 0.2) continue;
            const q = other * 3;
            const dx = this.positions[p] - this.positions[q];
            const dy = this.positions[p + 1] - this.positions[q + 1];
            const dz = this.positions[p + 2] - this.positions[q + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= reach2 && d2 > 50 * 50) found.push({ index: other, d2 });
          }
        }
      }
    }
    return found;
  }

  grow(band, strength, time, frame, settings, visible) {
    let seedIndex = -1;
    let bestScore = -Infinity;
    // Screen-visible seeds make each musical gesture readable at the current view.
    for (let i = 0; i < this.count; i++) {
      if (this.fades[i] < 0.7 || (visible && !visible[i])) continue;
      const depth = -this.positions[i * 3 + 2];
      if (depth < 320 || depth > 2200) continue;
      const difference = Math.abs(this.bands[i] - band);
      const bandAffinity = 1 - Math.min(difference, 32 - difference) / 16;
      const score = hash(this.seed + i * 977 + frame * 163 + band * 71) * 1.4 + bandAffinity * 0.7;
      if (score > bestScore) { bestScore = score; seedIndex = i; }
    }
    if (seedIndex < 0) return;
    const reach = 340 * (settings.linkReach ?? 1);
    const life = settings.linkLife ?? 1.2;
    const maxEdges = strength > 0.72 ? 5 : (strength > 0.45 ? 4 : 3);
    const visited = new Set([seedIndex]);
    const frontier = [{ index: seedIndex, depth: 0, parent: -1 }];
    let added = 0;
    while (frontier.length && added < maxEdges) {
      const source = frontier.shift();
      if (source.depth >= 3) continue;
      const neighbours = this.neighbours(source.index, reach);
      const candidates = neighbours.filter(item => !visited.has(item.index));
      candidates.sort((a, b) => {
        const score = item => item.d2 / (reach * reach) * 0.45 - hash(frame * 983 + item.index * 37 + source.index) * 0.55;
        return score(a) - score(b);
      });
      const branches = source.depth === 0 ? 2 : 1;
      let children = 0;
      for (const candidate of candidates) {
        if (children >= branches || added >= maxEdges) break;
        const delay = source.depth * (0.07 + hash(frame + candidate.index) * 0.035);
        const key = Math.min(source.index, candidate.index) * this.count + Math.max(source.index, candidate.index);
        const previous = this.links.findIndex(link => link.key === key);
        if (previous >= 0) {
          const old = this.links.splice(previous, 1)[0];
          this.degree[old.a]--;
          this.degree[old.b]--;
        }
        this.links.push({
          key, a: source.index, b: candidate.index, band, born: time, delay,
          expires: Math.min(time + 6, time + delay + life * (0.9 + strength * 0.75)),
          maxExpires: Math.min(time + 6, time + delay + life * 3),
          strength, reveal: 0, alpha: 0,
        });
        this.degree[source.index]++;
        this.degree[candidate.index]++;
        visited.add(candidate.index);
        frontier.push({ index: candidate.index, depth: source.depth + 1, parent: source.index });
        children++;
        added++;
      }
    }
    this.birthCount += added;
    if (added) this.events++;
  }

  update({ time = 0, distance = 0, features = {}, frame = Math.round(time * 60), playing = true, settings = {}, visible }) {
    if (frame < this.lastFrame) this.reset();
    this.updatePositions(distance);
    const levels = features.levels ?? [];
    const onsets = features.onsets ?? [];
    const life = settings.linkLife ?? 1.2;
    const audible = (features.rms ?? features.energy ?? 0) > 0.0004 && (features.energy ?? 0) > 0.015;
    this.nodeLight.fill(0);
    this.visibleLinks = 0;
    const kept = [];
    for (const link of this.links) {
      const dz = Math.abs(this.positions[link.a * 3 + 2] - this.positions[link.b * 3 + 2]);
      if (time >= link.expires || dz > 650 || this.fades[link.a] < 0.002 || this.fades[link.b] < 0.002) {
        this.degree[link.a]--;
        this.degree[link.b]--;
        continue;
      }
      const level = audible ? (levels[link.band] ?? features.energy ?? 0) : 0;
      if (!playing) {
        // The app advances visual rest time at a fixed audio frame, restoring the
        // untouched musical snapshot on resume. Release lights during that rest.
        link.pauseAt ??= time;
        link.expires = Math.min(link.expires, link.pauseAt + 0.75);
      } else if (level > 0.3 && frame !== this.lastFrame) {
        link.expires = Math.min(link.maxExpires, Math.max(link.expires, time + life * 0.45));
      } else if (level < 0.075 && frame !== this.lastFrame) {
        link.expires = Math.min(link.expires, time + life * 0.58);
      }
      const age = time - link.born - link.delay;
      link.reveal = clamp(age / 0.115);
      const tail = (1 - smooth(link.expires - life * 0.55, link.expires, time))
        * (link.pauseAt == null ? 1 : 1 - smooth(link.pauseAt, link.pauseAt + 0.75, time));
      const envelope = smooth(0, 0.09, age) * tail;
      link.alpha = envelope * (0.45 + link.strength * 0.4 + level * 0.25) * Math.min(this.fades[link.a], this.fades[link.b]);
      if (link.alpha > 0.005) this.visibleLinks++;
      this.nodeLight[link.a] = Math.max(this.nodeLight[link.a], link.alpha * 0.8);
      this.nodeLight[link.b] = Math.max(this.nodeLight[link.b], link.alpha * smooth(0.65, 1, link.reveal));
      kept.push(link);
    }
    this.links = kept;
    if (frame !== this.lastFrame && playing && audible) {
      const events = [];
      for (let band = 0; band < 32; band++) {
        // Gain has already been applied by the shared app. Favor distinct attacks
        // rather than letting every small spectral fluctuation start another tree.
        const onset = clamp(onsets[band] ?? 0);
        const threshold = 0.38 + (1 - clamp(features.energy ?? 0)) * 0.12;
        const crossing = onset > threshold && (onset > this.previousOnsets[band] * 1.12 || this.previousOnsets[band] < threshold);
        const bandSlot = Math.floor(frame / 36);
        if (crossing && bandSlot !== Math.floor(this.lastBirth[band] / 36)) events.push({ band, strength: onset, score: onset * (band < 10 ? 1.12 : 1) });
        this.previousOnsets[band] = onset;
      }
      events.sort((a, b) => b.score - a.score || a.band - b.band);
      // A deterministic time slot is a global refractory period. Unlike a rolling
      // event cooldown, it reconstructs exactly after a bounded seek warmup.
      const eventSlot = Math.floor(frame / 18);
      if (eventSlot !== this.lastEventSlot && events.length) {
        const selected = [];
        const peak = (features.energy ?? 0) > 0.94 && events[0].strength > 0.92;
        for (const event of events) {
          if (selected.some(other => Math.abs(other.band - event.band) < 8)) continue;
          this.grow(event.band, event.strength, time, frame, settings, visible);
          this.lastBirth[event.band] = frame;
          selected.push(event);
          if (selected.length === (peak ? 2 : 1)) break;
        }
        this.lastEventSlot = eventSlot;
      }
    } else if (!audible) {
      this.previousOnsets.fill(0);
    }
    this.visibleLinks = Math.min(CONSTELLATION_MAX_LINKS, this.visibleLinks);
    this.lastFrame = frame;
    return this.links;
  }

  saveState() {
    return {
      links: this.links.map(link => ({ ...link })),
      lastBirth: Array.from(this.lastBirth), previousOnsets: Array.from(this.previousOnsets),
      lastFrame: this.lastFrame, lastEventSlot: this.lastEventSlot, birthCount: this.birthCount, events: this.events,
    };
  }

  restoreState(saved) {
    this.reset();
    if (!saved) return;
    this.links = saved.links.map(link => ({ ...link }));
    this.lastBirth.set(saved.lastBirth);
    this.previousOnsets.set(saved.previousOnsets);
    this.lastFrame = saved.lastFrame;
    this.lastEventSlot = saved.lastEventSlot ?? -1;
    this.birthCount = saved.birthCount;
    this.events = saved.events;
    for (const link of this.links) { this.degree[link.a]++; this.degree[link.b]++; }
  }

  getStats() {
    return {
      candidates: this.count, activeLinks: this.links.length, visibleLinks: this.visibleLinks,
      maxDegree: Math.max(...this.degree), musicalEvents: this.events, linksBorn: this.birthCount,
    };
  }
}

import { createParticleMotionAudio } from './particle-dance-motion-audio.js';

const JET_STRIDE = 13;
const TAIL_LENGTH = 6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Musical motion is layered over the seeded swarm, so each switch is reversible.
 * All clocks and history advance on simulation dt, including offline export.
 * Springs carry velocity; the base swarm's damping cannot swallow their impulses.
 */
export function createParticleDanceMotion(maxParticles) {
  const audio = createParticleMotionAudio();
  const maxJets = Math.ceil(maxParticles / JET_STRIDE);
  const jetOffsets = new Float64Array(maxJets * 3);
  const jetVelocities = new Float64Array(maxJets * 3);
  const jetLife = new Float64Array(maxJets);
  const angles = new Float64Array(maxParticles);
  const history = new Float32Array(maxJets * TAIL_LENGTH * 3);
  const historyLength = new Uint8Array(maxJets);
  const jetTrailPositions = new Float32Array(maxJets * (TAIL_LENGTH - 1) * 6);
  const jetTrailColors = new Float32Array(jetTrailPositions.length);
  const waves = Array.from({ length: 6 }, () => ({ age: 1, strength: 0 }));
  let expansion = 0, expansionVelocity = 0, twistSpeed = 0;
  let gathering = 0, formationScale = 1, release = 0, releaseVelocity = 0;
  let waveIndex = 0, jetEvent = 0, features, lastCount = maxParticles;
  const output = { jetTrailPositions, jetTrailColors, jetTrailCount: 0 };

  function reset() {
    audio.reset();
    expansion = expansionVelocity = twistSpeed = 0;
    gathering = release = releaseVelocity = 0; formationScale = 1;
    waveIndex = jetEvent = 0; lastCount = maxParticles;
    angles.fill(0);
    for (const wave of waves) { wave.age = 1; wave.strength = 0; }
    jetOffsets.fill(0); jetVelocities.fill(0); jetLife.fill(0);
    history.fill(0); historyLength.fill(0);
    jetTrailPositions.fill(0); jetTrailColors.fill(0); output.jetTrailCount = 0;
  }

  function begin(config, spectrum, dt, audioFrame) {
    features = audio.update(spectrum, dt, { ...audioFrame, settings: config });
    const count = clamp(Math.ceil(config.particleCount), 0, maxParticles);
    for (let i = count; i < lastCount; i++) clearParticle(i);
    lastCount = count;
    if (!config.elasticExpansion) expansion = expansionVelocity = 0;
    if (!config.twistingCurrents) { angles.fill(0); twistSpeed = 0; }
    if (!config.travellingRipples) for (const wave of waves) wave.strength = 0;
    if (!config.gatheringRelease) { gathering = release = releaseVelocity = 0; formationScale = 1; }
    if (!config.particleJets) {
      jetOffsets.fill(0); jetVelocities.fill(0); jetLife.fill(0); historyLength.fill(0);
    }
    if (dt <= 0) return;
    if (config.elasticExpansion) {
      expansionVelocity += features.kick * 2.8;
      expansionVelocity += ((features.bass * .07 - expansion) * 85 - expansionVelocity * 7) * dt;
      expansion = clamp(expansion + expansionVelocity * dt, -.12, .38);
    }
    if (config.twistingCurrents) {
      const target = features.mid * (1 + (config.gatheringRelease ? features.phrase * .7 : 0));
      twistSpeed += (target - twistSpeed) * (1 - Math.exp(-dt / .35));
    }
    if (config.travellingRipples) {
      for (const wave of waves) wave.age += dt;
      const strength = Math.max(features.percussion, features.kick * .65);
      if (strength > 0) {
        const wave = waves[waveIndex++ % waves.length];
        wave.age = 0; wave.strength = strength;
      }
    }
    if (config.gatheringRelease) {
      const blend = 1 - Math.exp(-dt / 1.5);
      gathering += ((1 - features.phrase) * .38 - gathering) * blend;
      formationScale += (.88 + .32 * features.phrase - formationScale) * blend;
      releaseVelocity += features.release * 2.4;
      releaseVelocity += (-45 * release - 6 * releaseVelocity) * dt;
      release = clamp(release + releaseVelocity * dt, -.06, .4);
    }
    if (config.particleJets && features.hat > 0) jetEvent++;
  }

  function clearParticle(index) {
    angles[index] = 0;
    if (index % JET_STRIDE) return;
    const jet = index / JET_STRIDE;
    jetLife[jet] = 0; historyLength[jet] = 0;
    jetOffsets.fill(0, jet * 3, jet * 3 + 3);
    jetVelocities.fill(0, jet * 3, jet * 3 + 3);
  }

  function apply(config, positions, index, dt) {
    const offset = index * 3;
    let x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
    const spread = Math.max(.1, config.spread);
    if (config.gatheringRelease) {
      // Continuous angular attraction avoids snapping at lobe boundaries.
      const phase = Math.atan2(z, x);
      const angle = phase - Math.sin(3 * phase) * gathering * .8;
      const radius = Math.hypot(x, z) * (1 - gathering) + spread * .32 * gathering;
      x = Math.cos(angle) * radius; z = Math.sin(angle) * radius;
      y *= 1 - gathering * .6;
      const scale = formationScale + release;
      x *= scale; y *= scale; z *= scale;
    }
    if (config.twistingCurrents) {
      const radius = Math.hypot(x, z) / spread;
      // Integrate local angular velocity, rather than multiplying elapsed time
      // by radius: changing radius must not cause an ever-larger angular jump.
      if (dt > 0) angles[index] = (angles[index] + twistSpeed * clamp(1.4 - radius * 3.4, -.8, 1.2) * dt) % (Math.PI * 2);
      const angle = angles[index];
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const nextX = x * cosine - z * sine;
      z = x * sine + z * cosine; x = nextX;
      y += Math.sin(angle * 2 + index * .13) * spread * .025 * features.mid;
    }
    if (config.elasticExpansion) {
      x *= 1 + expansion; y *= 1 + expansion * .6; z *= 1 + expansion;
    }
    if (config.travellingRipples) {
      const distance = Math.hypot(x, y, z);
      let displacement = 0;
      for (const wave of waves) {
        if (wave.strength <= 0 || wave.age >= .8) continue;
        const front = wave.age / .8 * spread * .95;
        const phase = (distance - front) / (spread * .095);
        displacement += Math.exp(-phase * phase * 2) * wave.strength * spread * .11 * (1 - wave.age / .8);
      }
      const scale = 1 + displacement / Math.max(.15, distance);
      x *= scale; y *= scale; z *= scale;
    }
    if (config.particleJets && index % JET_STRIDE === 0) {
      const jet = index / JET_STRIDE, j = jet * 3;
      if (dt > 0) {
        if (features.hat > 0) {
          const radius = Math.max(.1, Math.hypot(x, z));
          const direction = jet % 2 ? 1 : -1;
          const strength = features.hat * spread * (1.2 + .25 * Math.sin(jet * 7.13 + jetEvent));
          jetVelocities[j] += -z / radius * strength * direction;
          jetVelocities[j + 1] += strength * Math.sin(jet * 2.4) * .28;
          jetVelocities[j + 2] += x / radius * strength * direction;
          jetLife[jet] = .8;
        }
        jetLife[jet] = Math.max(0, jetLife[jet] - dt);
        for (let c = 0; c < 3; c++) {
          jetVelocities[j + c] += (-42 * jetOffsets[j + c] - 8 * jetVelocities[j + c]) * dt;
          jetVelocities[j + c] = clamp(jetVelocities[j + c], -spread * 2, spread * 2);
          jetOffsets[j + c] = clamp(jetOffsets[j + c] + jetVelocities[j + c] * dt, -spread * .3, spread * .3);
        }
      }
      x += jetOffsets[j]; y += jetOffsets[j + 1]; z += jetOffsets[j + 2];
    }
    positions[offset] = x; positions[offset + 1] = y; positions[offset + 2] = z;
  }

  function trails(config, positions, colors, count, dt) {
    output.jetTrailCount = 0;
    if (!config.particleJets) { jetTrailPositions.fill(0); jetTrailColors.fill(0); return; }
    for (let index = 0; index < count; index += JET_STRIDE) {
      const jet = index / JET_STRIDE, h = jet * TAIL_LENGTH * 3, p = index * 3;
      if (jetLife[jet] <= 0) { historyLength[jet] = 0; continue; }
      if (dt > 0) {
        history.copyWithin(h + 3, h, h + (TAIL_LENGTH - 1) * 3);
        history.set(positions.subarray(p, p + 3), h);
        historyLength[jet] = Math.min(TAIL_LENGTH, historyLength[jet] + 1);
      }
      for (let segment = 0; segment < historyLength[jet] - 1; segment++) {
        const line = output.jetTrailCount++ * 6;
        jetTrailPositions.set(history.subarray(h + segment * 3, h + segment * 3 + 6), line);
        const alpha = Math.min(1, jetLife[jet] * 3);
        for (let c = 0; c < 3; c++) {
          jetTrailColors[line + c] = colors[p + c] * alpha * (1 - segment / (TAIL_LENGTH - 1));
          jetTrailColors[line + c + 3] = colors[p + c] * alpha * (1 - (segment + 1) / (TAIL_LENGTH - 1));
        }
      }
    }
    jetTrailPositions.fill(0, output.jetTrailCount * 6);
    jetTrailColors.fill(0, output.jetTrailCount * 6);
  }
  reset();
  return { output, reset, begin, apply, trails, clearParticle };
}

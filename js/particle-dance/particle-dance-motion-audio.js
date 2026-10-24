const clamp01 = value => Math.max(0, Math.min(1, value));
const numeric = (value, fallback) => Number.isFinite(value) ? value : fallback;
const approach = (current, target, dt, seconds) => target + (current - target) * Math.exp(-dt / seconds);
const BANDS = [[35, 220], [250, 4000], [4000, 12000]];
const DISPLAY_BANDS = [[0, .12], [.12, .55], [.55, 1]];

/** Deterministic motion features, independent of playback, rendering and settings.
 * Input spectra are FFT bytes. Raw unsmoothed onsetSpectrum uses physical Hz;
 * Raw bytes apply audioFrame.settings gain/intensity/gate before analysis; the
 * already-transformed display fallback uses broad normalized partitions instead.
 * Energies are envelopes; kick/percussion/hat/release are single-update impulses.
 * The returned object and working buffers are reused. A zero dt is inert.
 */
export function createParticleMotionAudio() {
  const result = { bass: 0, mid: 0, high: 0, energy: 0, phrase: 0, kick: 0, percussion: 0, hat: 0, release: 0 };
  const previous = { data: new Float32Array(0), raw: false, rate: 0, ready: false, gain: 1, intensity: 1, gate: 0 };
  let current = new Float32Array(0);
  const starts = new Int32Array(3), ends = new Int32Array(3);
  const levels = new Float64Array(3), fluxes = new Float64Array(3);
  const floors = new Float64Array(3), deviations = new Float64Array(3);
  const cooldowns = new Float64Array(3), above = new Uint8Array(3);
  let previousEnergy = 0, quietTime = 0, releaseCooldown = 0, releaseArmed = false;

  function reset() {
    for (const key of Object.keys(result)) result[key] = 0;
    previous.ready = false;
    previous.data.fill(0);
    floors.fill(0); deviations.fill(0); cooldowns.fill(0); above.fill(0);
    levels.fill(0); fluxes.fill(0);
    previousEnergy = quietTime = releaseCooldown = 0;
    releaseArmed = false;
  }

  function impulse(index, flux, level, dt, ready, floor, cooldown) {
    cooldowns[index] = Math.max(0, cooldowns[index] - dt);
    const threshold = Math.max(floor, floors[index] * 2.4 + deviations[index] * 1.1);
    const active = flux > threshold && level > .055;
    const hit = ready && active && !above[index] && cooldowns[index] === 0;
    above[index] = active ? 1 : 0;
    if (hit) cooldowns[index] = cooldown;
    const difference = Math.abs(flux - floors[index]);
    floors[index] = approach(floors[index], flux, dt, .8);
    deviations[index] = approach(deviations[index], difference, dt, .8);
    return hit ? clamp01(.18 + (flux - threshold) * 3.2) : 0;
  }

  function update(spectrum, dt = 1 / 60, audioFrame = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return result;
    const raw = !!audioFrame.onsetSpectrum?.length;
    const source = raw ? audioFrame.onsetSpectrum : spectrum;
    const length = source?.length || 0;
    const rate = Number.isFinite(audioFrame.sampleRate) && audioFrame.sampleRate > 0 ? audioFrame.sampleRate : 48000;
    const gain = raw ? Math.max(0, numeric(audioFrame.settings?.gain, 1)) : 1;
    const intensity = raw ? Math.max(0, numeric(audioFrame.settings?.globalIntensity, 1)) : 1;
    const gate = raw ? clamp01(numeric(audioFrame.settings?.noiseGate, 0)) : 0;
    const changed = length !== previous.data.length || raw !== previous.raw || (raw && (rate !== previous.rate
      || gain !== previous.gain || intensity !== previous.intensity || gate !== previous.gate));
    if (changed) {
      if (length !== previous.data.length) {
        previous.data = new Float32Array(length);
        current = new Float32Array(length);
      }
      previous.raw = raw; previous.rate = rate; previous.ready = false;
      previous.gain = gain; previous.intensity = intensity; previous.gate = gate;
      floors.fill(0); deviations.fill(0); cooldowns.fill(0); above.fill(0);
      for (let band = 0; band < 3; band++) {
        const range = raw ? BANDS[band] : DISPLAY_BANDS[band];
        const scale = raw ? length / (rate / 2) : length;
        starts[band] = Math.min(length, Math.ceil(range[0] * scale));
        ends[band] = Math.min(length, Math.ceil(range[1] * scale));
      }
    }
    // Gain then gate matches the display transform. Re-prime on edits so moving
    // an audio slider cannot masquerade as a musical onset or drop arrival.
    const multiplier = Math.min(255, gain * intensity);
    for (let i = 0; i < length; i++) {
      const value = clamp01(numeric(source[i], 0) * multiplier / 255);
      current[i] = value < gate ? 0 : value;
    }
    const ready = previous.ready && dt <= .5;
    for (let band = 0; band < 3; band++) {
      let energy = 0, flux = 0;
      for (let i = starts[band]; i < ends[band]; i++) {
        const value = current[i];
        const rise = Math.max(0, value - previous.data[i]);
        energy += value * value;
        flux += rise * rise;
      }
      const count = Math.max(1, ends[band] - starts[band]);
      levels[band] = Math.sqrt(energy / count);
      fluxes[band] = ready ? Math.sqrt(flux / count) : 0;
    }
    previous.data.set(current);
    previous.ready = true;

    // Different recovery times let the bass settle while mids continue flowing.
    result.bass = approach(result.bass, levels[0], dt, levels[0] > result.bass ? .045 : .28);
    result.mid = approach(result.mid, levels[1], dt, levels[1] > result.mid ? .18 : .6);
    result.high = approach(result.high, levels[2], dt, levels[2] > result.high ? .025 : .14);
    const energy = .42 * levels[0] + .36 * levels[1] + .22 * levels[2];
    result.energy = approach(result.energy, energy, dt, energy > result.energy ? .12 : .5);
    result.phrase = approach(result.phrase, energy, dt, energy > result.phrase ? 2.4 : 3.2);
    result.kick = impulse(0, fluxes[0], levels[0], dt, ready, .028, .18);
    result.percussion = impulse(1, Math.max(.8 * fluxes[0], fluxes[1], .65 * fluxes[2]),
      Math.max(levels[0], levels[1], levels[2]), dt, ready, .025, .15);
    result.hat = impulse(2, fluxes[2], levels[2], dt, ready, .035, .075);

    // A quiet section arms one large arrival. Keeping the arm during a build
    // allows the eventual impact to release it, without firing on every kick.
    releaseCooldown = Math.max(0, releaseCooldown - dt);
    quietTime = energy < .32 || energy < result.phrase * .7 ? quietTime + dt : 0;
    if (quietTime >= .7 && releaseCooldown === 0) releaseArmed = true;
    const arrival = ready && energy - previousEnergy > .12 && energy > Math.max(.36, result.phrase + .13);
    result.release = releaseArmed && releaseCooldown === 0 && arrival ? clamp01((energy - previousEnergy) * 1.5) : 0;
    if (result.release > 0) {
      releaseArmed = false;
      releaseCooldown = 2.5;
      quietTime = 0;
    }
    previousEnergy = energy;
    return result;
  }

  return { update, reset };
}

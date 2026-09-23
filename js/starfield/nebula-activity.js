// Canonical musical events and fractional-time presentation are separate. A
// render can sample these waves repeatedly without changing their history.
export const MAX_NEBULA_WAVES = 6;
const WAVE_SECONDS = 2.4;
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = value => value * value * (3 - 2 * value);

export function createNebulaActivity(settings, originForEvent = () => [0, 0.1, -1]) {
  let waves = [];
  let time = 0;
  let lastFrame = -1;
  let lastWaveTime = -Infinity;
  let response = { breath: 0, highs: 0 };

  function reset() {
    waves = []; time = 0; lastFrame = -1; lastWaveTime = -Infinity;
    response = { breath: 0, highs: 0 };
  }

  function sample({ time: now = time, features = response, light = 1 } = {}) {
    const breathing = !settings.backgroundOnly && settings.nebulaBreathing !== false;
    const amount = clamp(settings.breathResponse ?? 1, 0, 3);
    return {
      time: now,
      // These are bounded, pre-smoothed response values. Light fading is kept
      // separate so pausing cannot collapse or warp the frozen cloud geometry.
      breath: breathing ? clamp(features.breath, 0, 1) * amount : 0,
      turbulence: breathing ? clamp(features.highs, 0, 1) * amount * 0.16 : 0,
      waves: settings.backgroundOnly || settings.wavefronts === false ? [] : waves
        .filter(wave => now >= wave.born && now - wave.born < WAVE_SECONDS)
        .map(wave => {
          const age = now - wave.born;
          const attack = smooth(Math.min(1, age / 0.08));
          const tail = smooth(Math.min(1, (WAVE_SECONDS - age) / 0.35));
          return {
            ...wave,
            radius: 0.025 + age * 0.24 * clamp(settings.waveSpeed ?? 1, 0.2, 3),
            intensity: wave.strength * attack * Math.exp(-Math.max(0, age - 0.08) / 0.45)
              * tail * clamp(settings.waveStrength ?? 1, 0, 3) * clamp(light, 0, 1),
          };
        }),
    };
  }

  return {
    update({ time: now = 0, frame = Math.round(now * 60), features = {}, playing = false }) {
      time = now;
      response = { breath: features.breath || 0, highs: features.highs || 0 };
      if (settings.backgroundOnly) {
        waves = []; lastFrame = frame;
        return sample();
      }
      waves = waves.filter(wave => now >= wave.born && now - wave.born < WAVE_SECONDS);
      if (settings.wavefronts === false) waves = [];
      if (playing && frame !== lastFrame) {
        // The response timeline owns peak detection and its 250 ms refractory
        // period. Presentation never re-detects an onset or quantizes a slot.
        if (features.accentTrigger > 0 && settings.wavefronts !== false
          && now - lastWaveTime >= 0.25 - 1e-7) {
          const band = Math.round(clamp(features.accentBand, 0, 31));
          const origin = originForEvent(frame, band);
          if (origin) {
            const magnitude = Math.hypot(...origin) || 1;
            waves.push({ born: now, frame, band, origin: origin.map(value => value / magnitude),
              strength: clamp(features.accentTrigger, 0, 1) * 0.45 + clamp(features.accent, 0, 1) * 0.25 });
            if (waves.length > MAX_NEBULA_WAVES) waves.shift();
            lastWaveTime = now;
          }
        }
        lastFrame = frame;
      }
      return sample();
    },
    sample,
    reset,
    saveState() {
      return { time, lastFrame, lastWaveTime, response: { ...response },
        waves: waves.map(wave => ({ ...wave, origin: [...wave.origin] })) };
    },
    restoreState(saved) {
      if (!saved) { reset(); return; }
      time = saved.time; lastFrame = saved.lastFrame; lastWaveTime = saved.lastWaveTime ?? -Infinity;
      response = { breath: saved.response?.breath || 0, highs: saved.response?.highs || 0 };
      waves = (saved.waves || []).map(wave => ({ ...wave, origin: [...wave.origin] }));
    },
  };
}

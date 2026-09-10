// Music-driven cloud motion is evaluated from a short, finite history. Unlike
// an integrated oscillator, this produces the same cloud shape after an 8-second
// seek rebuild, during playback, and in an offline export.
export const MAX_NEBULA_WAVES = 6;
const HISTORY_SECONDS = 2.8;
const WAVE_SECONDS = 3.4;
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

function kernel(age) {
  if (age < 0 || age >= HISTORY_SECONDS) return 0;
  // A quick but smooth opening, followed by a slower relaxation. The last part
  // reaches exactly zero, avoiding both a cutoff jump and infinite state memory.
  const tail = Math.min(1, (HISTORY_SECONDS - age) / 0.4);
  return (1 - Math.exp(-(age + 1 / 60) / 0.14)) * Math.exp(-age / 0.58)
    * tail * tail * (3 - 2 * tail);
}
const KERNEL_WEIGHT = Array.from({ length: Math.ceil(HISTORY_SECONDS * 60) }, (_, i) => kernel(i / 60))
  .reduce((sum, weight) => sum + weight, 0);

export function createNebulaActivity(settings, originForEvent = () => [0, 0.1, -1]) {
  let history = [];
  let waves = [];
  let time = 0;
  let lastFrame = -1;
  let lastWaveSlot = -1;

  function reset() {
    history = []; waves = []; time = 0; lastFrame = -1; lastWaveSlot = -1;
  }

  function sample() {
    let level = 0;
    let turbulence = 0;
    for (const entry of history) {
      const age = time - entry.time;
      level += entry.level * kernel(age) / KERNEL_WEIGHT;
      turbulence += entry.attack * Math.exp(-age / 0.24) * Math.max(0, 1 - age / 1.2);
    }
    const breathing = !settings.backgroundOnly && settings.nebulaBreathing !== false;
    const response = clamp(settings.breathResponse ?? 1, 0, 3);
    return {
      time,
      breath: breathing ? clamp(level * response, 0, 1.15) : 0,
      turbulence: breathing ? Math.min(1, turbulence * response) : 0,
      waves: settings.backgroundOnly || settings.wavefronts === false ? [] : waves.map(wave => {
        const age = Math.max(0, time - wave.born);
        const attack = Math.min(1, age / 0.08);
        const tail = Math.max(0, 1 - age / WAVE_SECONDS);
        return {
          ...wave,
          radius: 0.025 + age * 0.24 * clamp(settings.waveSpeed ?? 1, 0.2, 3),
          intensity: wave.strength * attack * Math.pow(tail, 0.72)
            * clamp(settings.waveStrength ?? 1, 0, 3),
        };
      }),
    };
  }

  return {
    update({ time: now = 0, frame = Math.round(now * 60), features = {}, playing = false }) {
      time = now;
      if (settings.backgroundOnly) {
        history = []; waves = []; lastFrame = frame; lastWaveSlot = -1;
        return sample();
      }
      history = history.filter(entry => now >= entry.time && now - entry.time < HISTORY_SECONDS);
      waves = waves.filter(wave => now >= wave.born && now - wave.born < WAVE_SECONDS);
      if (settings.nebulaBreathing === false) history = [];
      if (settings.wavefronts === false) waves = [];
      const slot = Math.floor(frame / 18);
      if (slot !== lastWaveSlot) lastWaveSlot = -1;
      const audible = playing && Number(features.rms || 0) > 0.00001;
      if (playing && frame !== lastFrame) {
        if (audible && settings.nebulaBreathing !== false) {
          let attack = 0;
          for (let band = 10; band < 25; band++) attack = Math.max(attack, features.onsets?.[band] || 0);
          history.push({ time: now, level: clamp(features.mids, 0, 1), attack });
        }
        if (audible && settings.wavefronts !== false && slot !== lastWaveSlot) {
          let onset = 0;
          let band = 0;
          // The analysis uses logarithmic bands from 35 Hz: the first ten cover
          // bass below approximately 250 Hz. Sustained bass/kick envelopes alone
          // are deliberately insufficient to generate a front.
          for (let i = 0; i < 10; i++) {
            if ((features.onsets?.[i] || 0) > onset) { onset = features.onsets[i]; band = i; }
          }
          if (onset > 0.075) {
            const origin = originForEvent(frame, band);
            if (origin) {
              const magnitude = Math.hypot(...origin) || 1;
              waves.push({ born: now, frame, band, origin: origin.map(value => value / magnitude),
                strength: Math.min(1.65, 0.48 + onset * 1.2 + (features.bass || 0) * 0.18) });
              if (waves.length > MAX_NEBULA_WAVES) waves.shift();
              lastWaveSlot = slot;
            }
          }
        }
        lastFrame = frame;
      }
      return sample();
    },
    sample,
    reset,
    saveState() {
      return { time, lastFrame, lastWaveSlot,
        history: history.map(entry => ({ ...entry })),
        waves: waves.map(wave => ({ ...wave, origin: [...wave.origin] })) };
    },
    restoreState(saved) {
      if (!saved) { reset(); return; }
      time = saved.time; lastFrame = saved.lastFrame; lastWaveSlot = saved.lastWaveSlot;
      history = saved.history.map(entry => ({ ...entry }));
      waves = saved.waves.map(wave => ({ ...wave, origin: [...wave.origin] }));
    },
  };
}

/** Source effect timing and enum conversion, independent of Three.js. */
export const EFFECT_ENUMS = Object.freeze({
  glitch: { lineMode: { uniform: 'lineModeInt', values: { random: 0, wave: 1, audio: 2 } } },
  hexMirror: { sampleMode: { uniform: 'sampleModeInt', values: { local: 0, center: 1 } } },
  neonEdge: {
    colorMode: { uniform: 'colorModeInt', values: { solid: 0, source: 1, direction: 2 } },
    blendMode: { uniform: 'blendModeInt', values: { replace: 0, add: 1 } },
  },
  textureOverlay: { blendMode: { uniform: 'uBlendMode', values: {
    normal: 0, multiply: 1, screen: 2, overlay: 3, softLight: 4,
    add: 5, subtract: 6, darken: 7, lighten: 8, colorDodge: 9, colorBurn: 10,
    lumaKey: 11, glow: 12, luminosity: 13, paletteLock: 14,
  } } },
});

export const ADDED_CLOCKED_EFFECTS = new Set([
  'ripple', 'pondRipple', 'raindrops', 'waterDistortion', 'hexMirror',
  'reflection', 'glitch', 'film',
]);

export function effectClockRate(effect, rippleSpeed = 1) {
  if (effect === 'film' || effect === 'waterDistortion') return 1.2;
  if (effect === 'reflection') return 1.92 * rippleSpeed;
  return 1.92;
}

/** Each instance owns the source's sixteen-plate, twelve-transitions/sec sequence. */
export function createGrainTimeline() {
  let indexA = 0, indexB = 7, phase = 0;
  return {
    reset() { indexA = 0; indexB = 7; phase = 0; },
    advance(dt = 0) {
      phase += 12 * Math.max(0, Number.isFinite(dt) ? dt : 0);
      while (phase >= 1) {
        phase -= 1;
        indexA = indexB;
        indexB = (indexB + 7) % 16;
      }
      return { indexA, indexB, phase };
    },
  };
}

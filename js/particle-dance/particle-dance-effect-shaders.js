/**
 * Adapted from Vizz.fm with the user’s confirmed permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 * Retrieved 2026-10-08. No additional license is granted.
 */

export const barrelDistortionFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float amount;
  uniform float amountX;
  uniform float amountY;
  uniform float centerX;
  uniform float centerY;
  uniform float zoom;
  uniform float chromaticAberration;
  uniform float vignette;
  uniform float vignetteSize;
  uniform float opacity;

  varying vec2 vUv;

  // Function to apply barrel distortion with asymmetric X/Y and custom center.
  // Runs in aspect-corrected space so the distortion field stays circular
  // regardless of canvas aspect (windowed vs fullscreen).
  vec2 distortUV(vec2 uv, vec2 center, float aspect, float distAmount, float distX, float distY, float zoomVal) {
    // Convert to centered coordinates relative to custom center
    vec2 centered = (uv - center) * 2.0;
    centered.x *= aspect;

    // Apply zoom
    centered /= zoomVal;

    // Calculate distance from center (with asymmetric scaling)
    vec2 scaled = vec2(centered.x * distX, centered.y * distY);
    float r2 = dot(scaled, scaled);

    // Apply barrel/pincushion distortion
    float distortionFactor = 1.0 + distAmount * r2;

    // Apply distortion
    vec2 distorted = centered * distortionFactor;

    // Convert back to UV coordinates
    distorted.x /= aspect;
    return distorted * 0.5 + center;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Calculate base distorted UV
    vec2 distortedUV = distortUV(vUv, center, aspect, amount, amountX, amountY, zoom);

    // Check if we're sampling outside the texture (for the main channel)
    bool outsideBounds = distortedUV.x < 0.0 || distortedUV.x > 1.0 ||
                         distortedUV.y < 0.0 || distortedUV.y > 1.0;

    vec3 finalColor;

    if (chromaticAberration > 0.001) {
      // Chromatic aberration: sample R, G, B with slightly different distortion amounts
      float redAmount = amount * (1.0 + chromaticAberration * 2.0);
      float greenAmount = amount;
      float blueAmount = amount * (1.0 - chromaticAberration * 2.0);

      vec2 uvR = distortUV(vUv, center, aspect, redAmount, amountX, amountY, zoom);
      vec2 uvG = distortedUV;
      vec2 uvB = distortUV(vUv, center, aspect, blueAmount, amountX, amountY, zoom);

      // Sample each channel, using black for out-of-bounds
      float r = (uvR.x >= 0.0 && uvR.x <= 1.0 && uvR.y >= 0.0 && uvR.y <= 1.0)
                ? texture2D(tDiffuse, uvR).r : 0.0;
      float g = (uvG.x >= 0.0 && uvG.x <= 1.0 && uvG.y >= 0.0 && uvG.y <= 1.0)
                ? texture2D(tDiffuse, uvG).g : 0.0;
      float b = (uvB.x >= 0.0 && uvB.x <= 1.0 && uvB.y >= 0.0 && uvB.y <= 1.0)
                ? texture2D(tDiffuse, uvB).b : 0.0;

      finalColor = vec3(r, g, b);
    } else {
      // No chromatic aberration - simple sample
      if (outsideBounds) {
        gl_FragColor = mix(original, vec4(0.0, 0.0, 0.0, 1.0), opacity);
        return;
      }
      finalColor = texture2D(tDiffuse, distortedUV).rgb;
    }

    // Apply vignette (darken edges based on distance from center)
    if (vignette > 0.001) {
      vec2 vignetteUV = (vUv - center) * 2.0;
      vignetteUV.x *= aspect;
      float dist = length(vignetteUV) / vignetteSize;
      float vignetteAmount = 1.0 - dist * dist * vignette;
      vignetteAmount = clamp(vignetteAmount, 0.0, 1.0);
      finalColor *= vignetteAmount;
    }

    gl_FragColor = mix(original, vec4(finalColor, 1.0), opacity);
  }
`;

export const rippleFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float amplitude;
  uniform float frequency;
  uniform float speed;
  uniform float decay;
  uniform float centerX;
  uniform float centerY;
  uniform float time;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);

    // Get position relative to center
    vec2 delta = vUv - center;
    float dist = length(delta);

    // Normalize the direction
    vec2 direction = dist > 0.0 ? delta / dist : vec2(0.0);

    // Create ripple wave pattern
    // The wave moves outward over time
    float wave = sin(dist * frequency * 6.28318 - time * speed * 3.0);

    // Apply decay - ripples get weaker further from center
    float decayFactor = exp(-dist * decay * 3.0);

    // Calculate displacement
    float displacement = wave * amplitude * decayFactor;

    // Offset UV coordinates along the radial direction
    vec2 rippleUV = vUv + direction * displacement;

    // Clamp to valid range
    rippleUV = clamp(rippleUV, 0.0, 1.0);

    vec4 rippleColor = texture2D(tDiffuse, rippleUV);

    gl_FragColor = mix(original, rippleColor, opacity);
  }
`;

export const pondRippleFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float amplitude;
  uniform float rings;
  uniform float speed;
  uniform float crestWidth;
  uniform float decay;
  uniform float shimmer;
  uniform float chromatic;
  uniform float centerX;
  uniform float centerY;
  uniform float opacity;

  varying vec2 vUv;

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave)
  // so refracted samples past the frame edge don't smear into streaks.
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Aspect-corrected radial coordinates so wavefronts are true circles
    vec2 p = vUv - center;
    p.x *= aspect;
    float dist = length(p);
    vec2 direction = dist > 0.0 ? p / dist : vec2(0.0);

    // Repeating wavefronts expanding from the center. Each period holds one
    // solitary crest: a gaussian bump whose signed slope refracts radially,
    // magnifying inside the ring and compressing outside, like a lens edge.
    float phase = dist * rings - time * speed;
    float f = fract(phase) - 0.5;
    float x = f / crestWidth;
    float crest = exp(-x * x);
    float slope = -x * crest;

    // Ripples weaken with distance from the impact point
    float decayFactor = exp(-dist * decay);
    float strength = amplitude * decayFactor;

    float displacement = slope * strength;

    // Radial refraction, mapped back into non-square UV space
    vec2 dirUv = vec2(direction.x / aspect, direction.y);
    vec2 rippleUV = vUv + dirUv * displacement;

    // Frosted micro-texture riding only on the crests
    if (shimmer > 0.0) {
      vec2 cell = floor(vUv * resolution * 0.35);
      vec2 noise = vec2(hash(cell), hash(cell + 13.7)) - 0.5;
      rippleUV += noise * crest * strength * shimmer * 0.6;
    }

    vec4 rippled;
    if (chromatic > 0.001) {
      // Slight per-channel spread along the refraction direction
      vec2 chromaOffset = dirUv * crest * strength * chromatic * 0.5;
      rippled.r = texture2D(tDiffuse, mirrorRepeat(rippleUV + chromaOffset)).r;
      rippled.g = texture2D(tDiffuse, mirrorRepeat(rippleUV)).g;
      rippled.b = texture2D(tDiffuse, mirrorRepeat(rippleUV - chromaOffset)).b;
    } else {
      rippled.rgb = texture2D(tDiffuse, mirrorRepeat(rippleUV)).rgb;
    }
    rippled.a = original.a;

    gl_FragColor = mix(original, rippled, opacity);
  }
`;

export const raindropsFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float amplitude;
  uniform float density;
  uniform float scale;
  uniform float speed;
  uniform float slide;
  uniform float blur;
  uniform float opacity;

  varying vec2 vUv;

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave)
  // so refracted samples past the frame edge don't smear into streaks.
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash2(vec2 p) {
    return vec2(hash(p), hash(p + 19.19));
  }

  // Small stationary droplets that appear at random spots, sit for a
  // while, and slowly shrink away as they dry.
  float staticDrops(vec2 p, float t) {
    vec2 g = p * scale * 4.0;
    vec2 id = floor(g);
    vec2 st = fract(g) - 0.5;
    vec2 rnd = hash2(id);

    float cycleTime = t * 0.1 + rnd.y * 3.0;
    float cycle = fract(cycleTime);
    // Re-roll the landing spot each cycle; the swap happens while the
    // drop is fully faded, so it's never seen jumping
    vec2 pos = (hash2(id + floor(cycleTime) * 0.713) - 0.5) * 0.6;

    float fade = smoothstep(0.0, 0.05, cycle) * smoothstep(1.0, 0.35, cycle);

    vec2 d = st - pos;
    // Gravity pools the water low: fatten the bottom half, taper the top
    d.y *= 1.0 + 0.1 * smoothstep(0.0, 0.25, d.y);
    d.y *= 1.0 - 0.09 * smoothstep(0.0, -0.25, d.y);
    // Wobbly per-drop rim so no drop reads as a perfect circle
    d += vec2(sin(d.y * 18.0 + rnd.x * 43.0), sin(d.x * 15.0 + rnd.y * 37.0)) * 0.05;

    // Real panes carry a wide mix of drop sizes
    float size = 0.16 + 0.2 * hash(id + floor(cycleTime) * 0.29 + 5.1);
    float mask = smoothstep(size, size * 0.35, length(d)) * fade;
    return mask * step(hash(id + 11.3), density);
  }

  // One layer of drops sliding down tall lane-shaped cells: the drop hangs
  // near the top, then slips down with a slight wiggle, leaving beads and
  // a wet wake above it. Returns (height, wake).
  vec2 slideLayer(vec2 p, float t, float layerSeed) {
    vec2 g = p * vec2(scale, scale * 0.5) + layerSeed;
    vec2 id = floor(g);
    vec2 st = fract(g);
    st.x -= 0.5;
    float n = hash(id);

    float gate = step(hash(id + 31.7), 0.2 + density * 0.5);

    // Every lane runs at its own pace so drops don't move in lockstep
    float rate = 0.6 + 0.8 * hash(id + 3.9);
    float cycleTime = t * 0.4 * rate + n * 9.0;
    float cycle = fract(cycleTime);
    float idx = floor(cycleTime);
    // Timeline: grow in, slip down, sit still at rest, then fade away.
    // The hold before fading matters: without it the drop dissolves while
    // still moving, and real drops settle first
    float life = smoothstep(0.0, 0.1, cycle) * smoothstep(1.0, 0.75, cycle);
    // Per-cycle variety: where the drop starts, how far it slides, and
    // how much of its life the slide takes (re-rolled while invisible)
    vec2 v = hash2(id + idx * 0.177);
    float startY = 0.7 + 0.18 * v.x;
    float travel = 0.25 + 0.35 * v.y;
    float slipEnd = 0.45 + 0.3 * hash(id + idx * 0.531 + 1.7);
    // Long deceleration: cube the remaining distance so the drop covers
    // most of its slide early, then creeps into its final resting spot
    float q = 1.0 - smoothstep(0.15, slipEnd, cycle);
    float y = startY - travel + travel * q * q * q;
    // Fresh lane position each cycle, swapped while the drop is invisible
    float nx = hash(id + floor(cycleTime) * 0.131);
    float x = (nx - 0.5) * 0.5 + sin(st.y * 8.0 + n * 20.0) * 0.1;

    // Cells are twice as tall as wide, so double y to measure distance in
    // square units
    vec2 d = vec2(st.x - x, (st.y - y) * 2.0);
    // Bottom-heavy while it hangs: bulge below the midline, pinch above
    d.y *= 1.0 + 0.11 * smoothstep(0.0, 0.2, d.y);
    d.y *= 1.0 - 0.08 * smoothstep(0.0, -0.2, d.y);
    // Stretch into a rivulet while the drop is actively slipping
    float moving = smoothstep(0.15, 0.3, cycle) * smoothstep(slipEnd, slipEnd * 0.65, cycle);
    d.x *= 1.0 + 0.18 * moving;
    d.y *= 1.0 - 0.08 * moving;
    // Gloopy irregular rim, phase-locked to this drop
    d += vec2(sin(d.y * 14.0 + n * 51.0), sin(d.x * 12.0 + n * 47.0)) * 0.035;
    float mainDrop = smoothstep(0.15, 0.04, length(d)) * life;

    // The strip the drop has already slid through
    float above = smoothstep(-0.03, 0.03, st.y - y);
    float lane = smoothstep(0.1, 0.02, abs(st.x - x));
    float wake = above * lane * life;

    // Beads of water shed along the way
    float bead = smoothstep(0.1, 0.03, length(vec2(st.x - x, (fract(st.y * 4.0) - 0.5) * 0.5)));
    bead *= wake * step(0.5, hash(id + floor(st.y * 4.0) * 0.37 + 8.8));

    return vec2((mainDrop + bead * 0.7) * gate, wake * gate);
  }

  // Total water height at a point, plus how freshly wiped the glass is
  vec2 dropField(vec2 p, float t) {
    float height = staticDrops(p, t);
    vec2 a = slideLayer(p, t, 0.0);
    vec2 b = slideLayer(p * 1.6 + 7.3, t * 1.3, 17.0);
    height += (a.x + b.x * 0.8) * slide;
    float wake = clamp(a.y + b.y, 0.0, 1.0) * slide;
    return vec2(height, wake);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    float aspect = resolution.x / resolution.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    float t = time * speed;

    // Screen-space gradient of the height field: the droplet's surface
    // normal, which is what bends the light
    vec2 field = dropField(p, t);
    vec2 e = vec2(0.0015, 0.0);
    vec2 grad = vec2(
      dropField(p + e.xy, t).x - field.x,
      dropField(p + e.yx, t).x - field.x
    );

    vec2 offs = grad * amplitude;
    // Soft-limit the displacement: steep rims otherwise fling neighboring
    // pixels to sample far-apart spots, which reads as static, not water
    float offsLen = length(offs);
    offs *= 0.08 / (0.08 + offsLen);
    vec2 refractedUV = vUv + offs;

    // Fogged glass everywhere, except inside droplets and where a sliding
    // drop has freshly wiped its trail clean
    float frost = blur * 0.01 * (1.0 - field.y) * (1.0 - smoothstep(0.15, 0.4, field.x));
    // Strongly refracting areas get a touch of blur too: it anti-aliases
    // the compressed lens image so it looks wet instead of noisy
    frost += length(offs) * 0.15;

    vec4 rippled = texture2D(tDiffuse, mirrorRepeat(refractedUV));

    // With Frost at 0, frost is zero everywhere off-crest (offs is zero
    // between drops), which is most of the screen. Those pixels branch
    // coherently to a single tap instead of the full 9-tap blur.
    if (frost > 1e-5) {
      vec2 frostRadius = vec2(frost / aspect, frost);
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(1.0, 0.0) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(-1.0, 0.0) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(0.0, 1.0) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(0.0, -1.0) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(0.707, 0.707) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(-0.707, 0.707) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(0.707, -0.707) * frostRadius));
      rippled += texture2D(tDiffuse, mirrorRepeat(refractedUV + vec2(-0.707, -0.707) * frostRadius));
      rippled /= 9.0;
    }
    rippled.a = original.a;

    gl_FragColor = mix(original, rippled, opacity);
  }
`;

export const waterDistortionFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform float waveSpeed;
  uniform float waveStrength;
  uniform float waveScale;
  uniform vec3 waterColor;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    // Sample original color first
    vec4 originalColor = texture2D(tDiffuse, vUv);

    // Calculate wave distortion
    vec2 uv = vUv;

    // Create wave pattern using sine waves
    float sx = sin((uv.x * waveScale + time * waveSpeed) * 2.0);
    float sy = sin((uv.y * waveScale + time * waveSpeed) * 2.0);
    float cx = cos((uv.y * waveScale - time * waveSpeed) * 3.0);
    float cy = cos((uv.x * waveScale - time * waveSpeed) * 3.0);

    // Combine waves for more complex pattern
    float displacement = (sx * sy + cx * cy) * waveStrength;

    // Apply distortion to UV coordinates
    vec2 distortedUV = vec2(
      uv.x + displacement,
      uv.y + displacement
    );

    // Sample the texture with distorted UVs
    vec4 texColor = texture2D(tDiffuse, distortedUV);

    // Default water color if uniform is invalid
    vec3 defaultWaterColor = vec3(0.0, 0.4, 1.0); // Default blue

    // Use default color if any component is NaN or infinity
    vec3 safeWaterColor = vec3(
      isnan(waterColor.r) || isinf(waterColor.r) ? defaultWaterColor.r : waterColor.r,
      isnan(waterColor.g) || isinf(waterColor.g) ? defaultWaterColor.g : waterColor.g,
      isnan(waterColor.b) || isinf(waterColor.b) ? defaultWaterColor.b : waterColor.b
    );

    // Add water color tint
    vec3 waterEffectColor = mix(texColor.rgb, safeWaterColor, 0.2);

    // Add subtle highlight based on wave height
    float highlight = pow(abs(displacement) * 10.0, 2.0);
    waterEffectColor += highlight * 0.1;

    // Mix between original and effect based on opacity
    gl_FragColor = vec4(mix(originalColor.rgb, waterEffectColor, opacity), originalColor.a);
  }
`;

export const hexMirrorFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float tileSize;
  uniform float rotation;
  uniform float spin;
  uniform float zoom;
  uniform float centerX;
  uniform float centerY;
  uniform int sampleModeInt;
  uniform float opacity;

  varying vec2 vUv;

  #define PI 3.14159265359

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave)
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  vec2 rotate2d(vec2 p, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Aspect-corrected lattice space, spacing 1 between neighboring cells
    vec2 p = vUv - center;
    p.x *= aspect;
    float latticeAngle = radians(rotation) + time * spin;
    p = rotate2d(p, latticeAngle);
    p /= tileSize;

    // Nearest center of a triangular lattice: two offset rectangular grids,
    // take whichever candidate is closer
    const vec2 s = vec2(1.0, 1.7320508);
    vec2 c1 = (floor(p / s) + 0.5) * s;
    vec2 c2 = (floor((p - s * 0.5) / s) + 0.5) * s + s * 0.5;
    vec2 l1 = p - c1;
    vec2 l2 = p - c2;
    vec2 cell = dot(l1, l1) < dot(l2, l2) ? c1 : c2;
    vec2 local = p - cell;

    // Dihedral 6-mirror fold of the cell-local coordinates. Mirror axes fall
    // on multiples of 30 degrees, matching both the neighbor directions and
    // the cell edge directions, which is what makes the tiling seamless.
    float ang = atan(local.y, local.x);
    float r = length(local);
    float seg = PI / 3.0;
    ang = mod(ang, seg);
    ang = abs(ang - seg * 0.5);
    vec2 folded = vec2(cos(ang), sin(ang)) * r;

    // In Place keeps the fold in its own cell; Center collapses every cell
    // onto the same wedge around the center point
    vec2 q = sampleModeInt == 1 ? folded : cell + folded;

    // Back to screen UV space
    q *= tileSize / zoom;
    q = rotate2d(q, -latticeAngle);
    q.x /= aspect;
    vec2 uv = q + center;

    vec4 tiled = texture2D(tDiffuse, mirrorRepeat(uv));
    gl_FragColor = mix(original, tiled, opacity);
  }
`;

export const directionalBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float strength;
  uniform float angle;
  uniform float samples;
  uniform float opacity;
  uniform vec2 resolution;

  varying vec2 vUv;

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    float sampleCount = max(4.0, samples);

    // Aspect correction so the streak angle is true in screen space
    float rad = radians(angle);
    vec2 dir = vec2(cos(rad), sin(rad)) * vec2(resolution.y / resolution.x, 1.0);

    // Per-pixel jitter (interleaved gradient noise) offsets each pixel's
    // sample positions along the streak, turning the discrete ghost images
    // of a regular sample grid into a smooth blur at low sample counts
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    vec4 color = vec4(0.0);
    for (float i = 0.0; i < 32.0; i++) {
      if (i >= sampleCount) break;

      // Centered on the pixel so the image doesn't shift as strength grows
      float t = (i + jitter) / sampleCount - 0.5;
      vec2 sampleUV = clamp(vUv + dir * strength * t, 0.0, 1.0);
      color += texture2D(tDiffuse, sampleUV);
    }
    color /= sampleCount;

    gl_FragColor = mix(original, color, opacity);
  }
`;

export const bokehBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float size;
  uniform float highlightBoost;
  uniform float blades;
  uniform float rotation;
  uniform float opacity;
  uniform vec2 resolution;

  varying vec2 vUv;

  float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  // Highlight-weighted accumulation: bright samples dominate the average,
  // which is what turns points of light into solid bokeh discs. Squared so
  // the slider reaches ~100x weight: small highlights need to outweigh
  // dozens of dark taps to stay visible.
  float sampleWeight(vec3 color) {
    float luminance = getLuminance(color);
    float lum4 = luminance * luminance * luminance * luminance;
    return 1.0 + highlightBoost * highlightBoost * lum4;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    float radius = size * 0.004;

    if (radius < 0.0002) {
      gl_FragColor = original;
      return;
    }

    // Per-pixel jitter (interleaved gradient noise) on both radius and angle.
    // The aperture shape stays coherent because the polygon clamp below bounds
    // the sampled region itself; jittering tap positions inside that region
    // turns undersampling into fine grain instead of structured dot patterns.
    // Two decorrelated noise values so radius and angle don't move in lockstep.
    float jitterR = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float jitterA = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(37.0, 17.0), vec2(0.06711056, 0.00583715))));

    // Aspect correction so the disc is circular in screen space, not UV space
    vec2 aspect = vec2(resolution.y / resolution.x, 1.0);

    float bladeRot = radians(rotation);
    float sector = 6.2831853 / blades;

    float centerWeight = sampleWeight(original.rgb);
    vec3 sum = original.rgb * centerWeight;
    float weightSum = centerWeight;

    const float TAPS = 32.0;
    const float GOLDEN = 2.3999632;
    for (float i = 0.0; i < TAPS; i++) {
      // sqrt gives uniform area density across the disc
      float r = sqrt((i + jitterR) / TAPS);
      float theta = i * GOLDEN + jitterA * 6.2831853;

      // Polygonal aperture: pull the radius in toward the blade edges so the
      // disc is a regular n-gon (the shape real lens apertures stamp on bokeh)
      float a = mod(theta - bladeRot, sector) - sector * 0.5;
      float polyRadius = cos(sector * 0.5) / cos(a);

      vec2 offset = vec2(cos(theta), sin(theta)) * (r * polyRadius * radius) * aspect;
      vec3 color = texture2D(tDiffuse, vUv + offset).rgb;
      float weight = sampleWeight(color);
      sum += color * weight;
      weightSum += weight;
    }

    gl_FragColor = mix(original, vec4(sum / weightSum, original.a), opacity);
  }
`;

export const reflectionFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float waterLevel;
  uniform float rippleAmount;
  uniform float blur;
  uniform float fade;
  uniform float squash;
  uniform float shoreline;
  uniform float opacity;

  varying vec2 vUv;

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave),
  // so a squashed reflection that runs past the top of the source stays clean
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    // Wobble the waterline itself so the surface reads as lapping water
    // instead of a straight screen split. The mirror axis uses the wobbled
    // line too, keeping the reflection consistent with the visible edge.
    float wobble = (sin(vUv.x * 38.0 + time * 1.2) + 0.6 * sin(vUv.x * 93.0 - time * 2.1))
      * rippleAmount * 0.004;
    float level = waterLevel + wobble;

    if (vUv.y >= level) {
      gl_FragColor = original;
      return;
    }

    // 0 at the waterline -> 1 at the bottom of the screen
    float depth = (level - vUv.y) / level;

    // Mirror across the waterline; squash < 1 compresses the reflection
    // vertically for a perspective look
    vec2 srcUv = vec2(vUv.x, level + (level - vUv.y) / squash);

    // Ripple displacement: layered sines whose amplitude grows from zero at
    // the waterline, so the reflection stays pixel-continuous with the scene
    // right at the surface and gets wobblier with depth
    float w1 = sin(vUv.y * 90.0 + time * 2.0);
    float w2 = sin(vUv.y * 47.0 - time * 1.3 + vUv.x * 14.0);
    float w3 = sin(vUv.x * 65.0 + vUv.y * 20.0 + time * 1.7);
    float amp = rippleAmount * 0.012 * depth;
    srcUv += vec2(w2 + w3, w1 + w2) * amp;

    // Per-pixel jitter (interleaved gradient noise) rotates each pixel's
    // spiral so a sparse tap count reads as smooth blur, not ghost images
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    // Jittered golden-angle spiral gather, radius growing with depth
    float radiusPx = blur * depth * 0.035 * resolution.y;
    const float TAPS = 32.0;
    const float GOLDEN = 2.3999632;
    vec3 color = vec3(0.0);
    for (float i = 0.0; i < TAPS; i++) {
      float r = sqrt((i + jitter) / TAPS) * radiusPx;
      float theta = (i + jitter) * GOLDEN;
      vec2 offset = vec2(cos(theta), sin(theta)) * r / resolution;
      color += texture2D(tDiffuse, mirrorRepeat(srcUv + offset)).rgb;
    }
    color /= TAPS;

    // Darken with depth so the reflection sinks into the water
    color *= 1.0 - fade * depth;

    // Shoreline glint: a thin rippled highlight hugging the waterline, like
    // light catching the surface. Brightens the local color rather than
    // adding flat white so it inherits the scene's palette.
    float sparkle = 0.6 + 0.4 * sin(vUv.x * 120.0 + time * 2.4)
      * sin(vUv.x * 53.0 - time * 1.6);
    float glint = shoreline * sparkle * exp(-depth * level * resolution.y * 0.25);
    color += (color + 0.06) * glint;

    // Soften the waterline over ~2px so it doesn't alias
    float edge = smoothstep(level, level - 2.0 / resolution.y, vUv.y);

    gl_FragColor = vec4(mix(original.rgb, color, opacity * edge), original.a);
  }
`;

export const neonEdgeFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float intensity;
  uniform float thickness;
  uniform float threshold;
  uniform int colorModeInt;
  uniform int blendModeInt;
  uniform vec3 edgeColor;
  uniform float opacity;

  varying vec2 vUv;

  #define PI 3.14159265359

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 hue2rgb(float h) {
    vec3 k = mod(vec3(0.0, 4.0, 2.0) + h * 6.0, 6.0);
    return 1.0 - clamp(min(k, 4.0 - k), 0.0, 1.0);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 texel = thickness / resolution;

    // 3x3 luminance neighborhood
    float tl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  1.0)).rgb);
    float tc = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0,  1.0)).rgb);
    float tr = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  1.0)).rgb);
    float ml = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0,  0.0)).rgb);
    float mr = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0,  0.0)).rgb);
    float bl = luma(texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb);
    float bc = luma(texture2D(tDiffuse, vUv + texel * vec2( 0.0, -1.0)).rgb);
    float br = luma(texture2D(tDiffuse, vUv + texel * vec2( 1.0, -1.0)).rgb);

    // Sobel gradients
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    float mag = length(vec2(gx, gy));

    float edge = clamp((mag - threshold) * intensity, 0.0, 1.0);

    vec3 lineColor;
    if (colorModeInt == 1) {
      // Push the source color to full brightness so hue survives on dark pixels
      float peak = max(original.r, max(original.g, original.b));
      lineColor = original.rgb / max(peak, 1e-4);
    } else if (colorModeInt == 2) {
      lineColor = hue2rgb(atan(gy, gx) / (2.0 * PI) + 0.5);
    } else {
      lineColor = edgeColor;
    }

    vec3 edges = lineColor * edge;
    vec3 result = blendModeInt == 1 ? original.rgb + edges : edges;

    gl_FragColor = vec4(mix(original.rgb, result, opacity), original.a);
  }
`;

export const bloomFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float threshold;
  uniform float intensity;
  uniform float radius;
  uniform vec2 resolution;
  uniform float opacity;

  varying vec2 vUv;

  // Get luminance of a color
  float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  // Extract bright pixels above threshold
  vec3 extractBright(vec3 color) {
    float luminance = getLuminance(color);
    float contribution = max(0.0, luminance - threshold);
    return color * contribution;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 texelSize = radius / resolution;

    // Gaussian-weighted disc blur via golden-angle spiral, covering the same
    // footprint as the old kernel (out to 2x radius texels) but with even
    // coverage instead of a sparse cross, so wide radii stay smooth.
    // Per-pixel rotation (interleaved gradient noise) hides the ring pattern.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rot = jitter * 6.2831853;
    float cr = cos(rot);
    float sr = sin(rot);

    vec3 bloom = extractBright(original.rgb);
    float weightSum = 1.0;

    const float TAPS = 20.0;
    const float GOLDEN = 2.3999632;
    for (float i = 0.0; i < TAPS; i++) {
      // sqrt gives uniform area density across the disc
      float r = sqrt((i + 0.5) / TAPS);
      float theta = i * GOLDEN;
      vec2 dir = vec2(cos(theta), sin(theta));
      dir = vec2(dir.x * cr - dir.y * sr, dir.x * sr + dir.y * cr);
      float weight = exp(-2.5 * r * r);
      bloom += extractBright(texture2D(tDiffuse, vUv + dir * r * 2.0 * texelSize).rgb) * weight;
      weightSum += weight;
    }

    // Apply intensity
    bloom *= intensity / weightSum;

    // Add bloom to original (additive blending for glow effect)
    vec3 result = original.rgb + bloom;

    gl_FragColor = mix(original, vec4(result, original.a), opacity);
  }
`;

export const rgbShiftFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float amount;
  uniform float angle;
  uniform float radial;
  uniform float falloff;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    vec2 uniformOffset = vec2(cos(angle), sin(angle));
    vec2 dir = vUv - 0.5;
    float r = length(dir);
    vec2 radialOffset = (r > 0.0 ? dir / r : vec2(0.0)) * pow(r, falloff);

    vec2 offset = amount * mix(uniformOffset, radialOffset, radial);

    vec4 cr = texture2D(tDiffuse, vUv + offset);
    vec4 cga = texture2D(tDiffuse, vUv);
    vec4 cb = texture2D(tDiffuse, vUv - offset);
    vec4 shifted = vec4(cr.r, cga.g, cb.b, cga.a);
    gl_FragColor = mix(cga, shifted, opacity);
  }
`;

export const pixelateFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float pixelSize;
  uniform vec2 resolution;
  uniform float dprScale;
  uniform float smoothing;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    // Calculate pixel grid size based on resolution
    vec2 pixelCount = resolution * dprScale / pixelSize;
    vec2 cellSize = 1.0 / pixelCount;

    // Get the top-left corner of this cell
    vec2 cellOrigin = floor(vUv * pixelCount) / pixelCount;

    // Sample multiple points within the cell based on smoothing level
    // Higher smoothing = more samples = more stable but slightly softer
    vec4 pixelated = vec4(0.0);
    float samples = 0.0;

    int smoothInt = int(smoothing);

    // Sample in a grid pattern within the cell
    for (int y = 0; y < 4; y++) {
      if (y >= smoothInt) break;
      for (int x = 0; x < 4; x++) {
        if (x >= smoothInt) break;

        // Calculate sample position within cell (evenly distributed)
        vec2 offset = (vec2(float(x), float(y)) + 0.5) / smoothing;
        vec2 sampleUV = cellOrigin + offset * cellSize;

        pixelated += texture2D(tDiffuse, sampleUV);
        samples += 1.0;
      }
    }

    pixelated /= samples;

    gl_FragColor = mix(original, pixelated, opacity);
  }
`;

export const dotScreenFragmentShader = `
  uniform vec2 center;
  uniform float angle;
  uniform float scale;
  uniform vec2 tSize;
  uniform float dprScale;
  uniform float opacity;

  uniform sampler2D tDiffuse;

  varying vec2 vUv;

  float pattern() {
    float s = sin(angle), c = cos(angle);

    vec2 tex = vUv * tSize * dprScale - center;
    vec2 point = vec2(c * tex.x - s * tex.y, s * tex.x + c * tex.y) * scale;

    return (sin(point.x) * sin(point.y)) * 4.0;
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    float average = (color.r + color.g + color.b) / 3.0;

    vec3 dotScreenColor = vec3(average * 10.0 - 5.0 + pattern());

    // Mix between original and effect based on opacity
    gl_FragColor = vec4(mix(color.rgb, dotScreenColor, opacity), color.a);
  }
`;

export const glitchFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform float intensity;
  uniform float speed;
  uniform float blockSize;
  uniform float colorShift;
  uniform int lineModeInt;
  uniform float lineWaveFreq;
  uniform float lineWaveAmp;
  uniform float opacity;

  varying vec2 vUv;

  // Pseudo-random function
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Pseudo-random based on time
  float randomTime(float seed) {
    return random(vec2(seed, floor(time * speed)));
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 uv = vUv;

    // Create time-varying seed for randomness
    float timeSeed = floor(time * speed * 10.0);

    // Horizontal line displacement.
    // lineModeInt: 0 = random scanline glitch (original behavior).
    // lineModeInt: 1 = coherent sinusoidal slit-scan.
    // lineModeInt: 2 = same as 1, but lineWaveAmp is the slider you hijack to audio.
    if (lineModeInt == 0) {
      float lineNoise = random(vec2(floor(uv.y / blockSize), timeSeed));
      if (lineNoise > 1.0 - intensity * 0.3) {
        float displacement = (random(vec2(timeSeed, floor(uv.y / blockSize))) - 0.5) * intensity * 0.1;
        uv.x += displacement;
      }
    } else {
      uv.x += sin(uv.y * lineWaveFreq + time * speed) * lineWaveAmp * intensity;
    }

    // Block glitch effect
    vec2 blockCoord = floor(uv / blockSize);
    float blockNoise = random(blockCoord + timeSeed);
    if (blockNoise > 1.0 - intensity * 0.1) {
      // Shift entire block
      float blockShift = (random(blockCoord + timeSeed + 1.0) - 0.5) * intensity * 0.2;
      uv.x += blockShift;
    }

    // Sample with color channel separation
    float shift = colorShift * intensity;
    float r = texture2D(tDiffuse, uv + vec2(shift, 0.0)).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - vec2(shift, 0.0)).b;

    vec3 glitched = vec3(r, g, b);

    // Random brightness flicker
    float flicker = 1.0 + (random(vec2(timeSeed, 0.0)) - 0.5) * intensity * 0.2;
    glitched *= flicker;

    gl_FragColor = mix(original, vec4(glitched, original.a), opacity);
  }
`;

export const filmFragmentShader = `
  #include <common>

  // control parameter
  uniform float time;

  uniform bool grayscale;

  // noise effect intensity value (0 = no effect, 1 = full effect)
  uniform float nIntensity;

  // scanlines effect intensity value (0 = no effect, 1 = full effect)
  uniform float sIntensity;

  // scanlines effect count value (0 = no effect, 4096 = full effect)
  uniform float sCount;

  uniform float opacity;

  uniform sampler2D tDiffuse;

  varying vec2 vUv;

  void main() {
    // sample the source
    vec4 cTextureScreen = texture2D(tDiffuse, vUv);

    // make some noise
    float dx = rand(vUv + time);

    // add noise
    vec3 cResult = cTextureScreen.rgb + cTextureScreen.rgb * clamp(0.1 + dx, 0.0, 1.0);

    // get us a sine and cosine
    vec2 sc = vec2(sin(vUv.y * sCount), cos(vUv.y * sCount));

    // add scanlines
    cResult += cTextureScreen.rgb * vec3(sc.x, sc.y, sc.x) * sIntensity;

    // interpolate between source and result by intensity
    cResult = cTextureScreen.rgb + clamp(nIntensity, 0.0, 1.0) * (cResult - cTextureScreen.rgb);

    // convert to grayscale if desired
    if (grayscale) {
      cResult = vec3(cResult.r * 0.3 + cResult.g * 0.59 + cResult.b * 0.11);
    }

    // Mix between original and effect based on opacity
    vec3 finalColor = mix(cTextureScreen.rgb, cResult, opacity);
    gl_FragColor = vec4(finalColor, cTextureScreen.a);
  }
`;

export const ditherFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float dprScale;
  uniform float colorLevels;
  uniform float pixelScale;
  uniform bool grayscale;
  uniform float opacity;

  varying vec2 vUv;

  // 2x2 Bayer threshold, the base case of the recursive construction
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }

  // 8x8 Bayer matrix value via the standard 2x2 recursion: identical values
  // to the classic 64-entry table, but a handful of ALU ops per pixel instead
  // of a 64-branch lookup chain. Coordinates are folded into [0,8) first so
  // the y*y term stays float-precision-exact at any resolution.
  float bayerMatrix(vec2 coord) {
    vec2 a = mod(floor(coord), 8.0);
    return (bayer2(a * 0.25) * 0.25 + bayer2(a * 0.5)) * 0.25 + bayer2(a);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    // Get pixel coordinate in dither grid space
    vec2 pixelCoord = floor(vUv * resolution * dprScale / pixelScale);

    // Get Bayer threshold for this pixel
    float threshold = bayerMatrix(pixelCoord) - 0.5;

    vec3 color = original.rgb;

    // Optional grayscale conversion
    if (grayscale) {
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      color = vec3(lum);
    }

    // Quantize each channel with dithering
    float levels = colorLevels - 1.0;
    vec3 dithered = floor(color * levels + threshold + 0.5) / levels;
    dithered = clamp(dithered, 0.0, 1.0);

    gl_FragColor = vec4(mix(original.rgb, dithered, opacity), original.a);
  }
`;

export const textureOverlayFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D uTexture;
  uniform int uBlendMode;
  uniform float scale;
  uniform float rotation;
  uniform vec3 tintColor;
  uniform float opacity;
  uniform bool uHasTexture;
  uniform vec2 resolution;
  uniform sampler2D uTextureNext;
  uniform bool uGrainAnimated;
  uniform float uGrainMix;

  varying vec2 vUv;

  
  vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
  vec3 blendScreen(vec3 base, vec3 blend) { return 1.0 - (1.0 - base) * (1.0 - blend); }

  float overlayChannel(float base, float blend) {
    return base < 0.5 ? 2.0 * base * blend : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  }
  vec3 blendOverlay(vec3 base, vec3 blend) {
    return vec3(overlayChannel(base.r, blend.r), overlayChannel(base.g, blend.g), overlayChannel(base.b, blend.b));
  }

  float softLightChannel(float base, float blend) {
    return blend < 0.5
      ? base - (1.0 - 2.0 * blend) * base * (1.0 - base)
      : base + (2.0 * blend - 1.0) * (sqrt(base) - base);
  }
  vec3 blendSoftLight(vec3 base, vec3 blend) {
    return vec3(softLightChannel(base.r, blend.r), softLightChannel(base.g, blend.g), softLightChannel(base.b, blend.b));
  }

  vec3 blendAdd(vec3 base, vec3 blend) { return min(base + blend, 1.0); }
  vec3 blendSubtract(vec3 base, vec3 blend) { return max(base - blend, 0.0); }
  vec3 blendDarken(vec3 base, vec3 blend) { return min(base, blend); }
  vec3 blendLighten(vec3 base, vec3 blend) { return max(base, blend); }
  vec3 blendColorDodge(vec3 base, vec3 blend) {
    return vec3(
      blend.r >= 1.0 ? 1.0 : min(1.0, base.r / (1.0 - blend.r)),
      blend.g >= 1.0 ? 1.0 : min(1.0, base.g / (1.0 - blend.g)),
      blend.b >= 1.0 ? 1.0 : min(1.0, base.b / (1.0 - blend.b))
    );
  }
  vec3 blendColorBurn(vec3 base, vec3 blend) {
    return vec3(
      blend.r <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - base.r) / blend.r),
      blend.g <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - base.g) / blend.g),
      blend.b <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - base.b) / blend.b)
    );
  }

  vec3 applyBlend(vec3 base, vec3 blend, int mode) {
    if (mode == 0) return blend; // normal: caller handles alpha
    if (mode == 1) return blendMultiply(base, blend);
    if (mode == 2) return blendScreen(base, blend);
    if (mode == 3) return blendOverlay(base, blend);
    if (mode == 4) return blendSoftLight(base, blend);
    if (mode == 5) return blendAdd(base, blend);
    if (mode == 6) return blendSubtract(base, blend);
    if (mode == 7) return blendDarken(base, blend);
    if (mode == 8) return blendLighten(base, blend);
    if (mode == 9) return blendColorDodge(base, blend);
    if (mode == 10) return blendColorBurn(base, blend);
    return blend; // fallback to normal
  }


  // Sample a texture twice at decorrelated scale/rotation/offset and combine,
  // so its tiling never visibly repeats. Average then rescale around mid-grey
  // to preserve the grain's contrast.
  vec3 sampleDetiled(sampler2D tex, float aspect, vec2 center) {
    vec2 uv = vUv - center;
    uv.x *= aspect;
    float cosR = cos(rotation);
    float sinR = sin(rotation);
    uv = vec2(uv.x * cosR - uv.y * sinR, uv.x * sinR + uv.y * cosR);
    uv *= scale;
    uv += center;
    vec3 s1 = texture2D(tex, uv).rgb;

    vec2 uv2 = vUv - center;
    uv2.x *= aspect;
    float r2 = rotation + 2.39996;          // golden angle, decorrelates orientation
    float cosR2 = cos(r2);
    float sinR2 = sin(r2);
    uv2 = vec2(uv2.x * cosR2 - uv2.y * sinR2, uv2.x * sinR2 + uv2.y * cosR2);
    uv2 *= scale * 1.61803;                  // irrational ratio so tiles never align
    uv2 += center + vec2(0.37, 0.73);
    vec3 s2 = texture2D(tex, uv2).rgb;

    vec3 avg = (s1 + s2) * 0.5;
    return clamp(0.5 + (avg - 0.5) * 1.41421, 0.0, 1.0);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    if (!uHasTexture) {
      gl_FragColor = original;
      return;
    }

    float aspect = resolution.x / resolution.y;
    vec2 center = vec2(0.5);

    vec3 grain = sampleDetiled(uTexture, aspect, center);

    // Animated grain: crossfade into the next plate. Ease with smoothstep so
    // there's no tick at plate boundaries, and normalise by 1/sqrt(w1\xb2+w2\xb2) so
    // averaging two decorrelated noise fields doesn't dim the grain mid-fade.
    if (uGrainAnimated) {
      vec3 grainNext = sampleDetiled(uTextureNext, aspect, center);
      float t = smoothstep(0.0, 1.0, uGrainMix);
      float w1 = 1.0 - t;
      float w2 = t;
      float norm = inversesqrt(w1 * w1 + w2 * w2);
      grain = clamp(0.5 + ((grain - 0.5) * w1 + (grainNext - 0.5) * w2) * norm, 0.0, 1.0);
    }

    // Apply tint
    vec3 tinted = grain * tintColor;

    // Blend
    vec3 blended = applyBlend(original.rgb, tinted, uBlendMode);

    // Mix with opacity
    vec3 finalColor = mix(original.rgb, blended, opacity);
    gl_FragColor = vec4(finalColor, original.a);
  }
`;

export const bokehPreBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float size;
  uniform float opacity;
  uniform float maxRadius;
  uniform vec2 resolution;

  varying vec2 vUv;

  float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  // Much sharper soft-max than the main pass's artistic weighting: the dilate
  // stages must hand highlights through the chain at near-full brightness, or
  // each stage's dimming compounds and discs come out gray
  float sampleWeight(vec3 color) {
    float luminance = getLuminance(color);
    float lum2 = luminance * luminance;
    float lum8 = lum2 * lum2 * lum2 * lum2;
    return 1.0 + 1024.0 * lum8;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    if (size < 0.05 || opacity < 0.001) {
      gl_FragColor = original;
      return;
    }

    // Grow highlights toward the main pass's tap spacing (~0.16x its gather
    // radius), bounded by how far this stage can spread without undersampling
    float radiusPx = size * 0.004 * resolution.y;
    float dilateRadius = clamp(radiusPx * 0.16, 1.0, maxRadius);

    float centerWeight = sampleWeight(original.rgb);
    vec3 sum = original.rgb * centerWeight;
    float weightSum = centerWeight;

    // Dense fixed golden-angle spiral: no jitter, so blobs come out solid
    const float TAPS = 24.0;
    const float GOLDEN = 2.3999632;
    for (float i = 0.0; i < TAPS; i++) {
      float r = sqrt((i + 0.5) / TAPS) * dilateRadius;
      float theta = i * GOLDEN;
      vec2 offset = vec2(cos(theta), sin(theta)) * r / resolution;
      vec3 color = texture2D(tDiffuse, vUv + offset).rgb;
      float weight = sampleWeight(color);
      sum += color * weight;
      weightSum += weight;
    }

    // Fade the dilation with opacity: the main pass mixes against this pass's
    // output as its "original", so the dilate must also become an identity as
    // opacity approaches zero or a fully-transparent effect still softens the
    // image
    gl_FragColor = vec4(mix(original.rgb, sum / weightSum, opacity), original.a);
  }
`;


/**
 * Light Fall adapted from Vizz.fm with the author’s permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-d2d9ec860a756c37.js
 * Source SHA-256: b5a11ca462673f6660f4a9cec6a3f551f0df9a874e8fe2897e67c2cad55cb416
 * Retrieved 2026-10-12. No additional license is granted.
 */

// Original Light Fall GLSL; only exported JavaScript names are changed.

export const lightFallVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform float uTime;
  uniform float uArcRadius;
  uniform float uMeander;

  const float HALF_PI = 1.57079632679;
  const float Z_START = 132.7500;
  const float WALL_Z = -160.0000;
  const float WALL_H = 200.0000;

  // 2D gradient (Perlin-style) noise, three octaves below. Range roughly [-1, 1].
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vUv = uv;

    // Border-radius fillet on the fixed corner at (y = 0, z = WALL_Z): the
    // circle center sits at (y = r, z = WALL_Z + r), tangent to the floor and
    // the wall, so growing r rounds the corner symmetrically.
    float r = uArcRadius;
    float lFlat = Z_START - (WALL_Z + r);
    float lArc = HALF_PI * r;
    float lUp = max(0.1, WALL_H - r);
    float total = lFlat + lArc + lUp;
    float d = position.z * total;

    // Path centerline (y, z) and tangent angle theta (0 = flat, HALF_PI = wall).
    float py; float pz; float theta;
    if (d <= lFlat) {
      py = 0.0; pz = Z_START - d; theta = 0.0;
    } else if (d <= lFlat + lArc) {
      float n = (d - lFlat) / lArc;
      float eased = n * n * (3.0 - 2.0 * n);
      theta = (n * 0.4 + eased * 0.6) * HALF_PI;
      py = r * (1.0 - cos(theta));
      pz = WALL_Z + r - sin(theta) * r;
    } else {
      py = r + (d - lFlat - lArc);
      pz = WALL_Z;
      theta = HALF_PI;
    }

    // Frame normal in the y/z plane, perpendicular to the path tangent.
    vec2 nrm = vec2(cos(theta), sin(theta));

    // Organic meander: fbm gradient noise displaces the road laterally. The
    // field is sampled along the path (flowing downstream over time) and across
    // the road's world x, so nearby tubes move together while distant ones
    // diverge: the sheet of trails ripples like a current instead of swaying
    // rigidly. World x (baked slot + per-frame rank offset via modelMatrix)
    // keeps displayed neighbors correlated. Identity (wx = 0) at slider 0 so
    // old presets are unchanged.
    float wx = 0.0;
    if (uMeander > 0.0) {
      float roadX = position.x + modelMatrix[3].x;
      vec2 q = vec2(d * 0.010 - uTime * 0.30, roadX * 0.012 + uTime * 0.05);
      float f = gnoise(q)
              + 0.50 * gnoise(q * 2.03 + 17.1)
              + 0.25 * gnoise(q * 4.01 + 47.7);
      wx = f * uMeander * 1.6;
    }

    // position.x already carries this tube's road x + cross-section offset;
    // position.y is the cross-section offset applied along the frame normal.
    vec3 bent = vec3(position.x + wx, py + position.y * nrm.x, pz + position.y * nrm.y);
    vec3 objNormal = vec3(normal.x, normal.y * nrm.x, normal.y * nrm.y);

    vNormal = normalMatrix * objNormal;
    vec4 mvPosition = modelViewMatrix * vec4(bent, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const lightFallFragmentShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSpeed;
  uniform float uOffset;
  uniform float uTailLength;
  uniform float uIntensityMultiplier;
  uniform float uBendUv;
  uniform float uIsReflection;
  uniform float uDotDensity;
  uniform float uDotSize;
  uniform float uDotSpeed;
  uniform float uBrightness;
  uniform float uDirection;
  uniform float uAudio;
  uniform float uAudioFast;
  uniform float uAudioReactivity;
  uniform float uAudioColorShift;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float t = fract(uTime * uSpeed * uDirection + uOffset);
    float dist = fract((t - vUv.x) * uDirection + 1.0);

    float baseAlpha = smoothstep(uTailLength, 0.0, dist);
    baseAlpha = pow(max(0.0, baseAlpha), 1.2);

    vec3 viewDir = normalize(vViewPosition);
    float fresnel = abs(dot(normalize(vNormal), viewDir));
    float edgeSoftness = smoothstep(0.0, 0.02, fresnel);
    baseAlpha *= edgeSoftness;

    float core = pow(max(0.0, baseAlpha), 3.0) * 1.5;

    // This tube's frequency-bin energy, hue-shifted into the color when enabled.
    // Identity when uAudioColorShift == 0 so old presets are unchanged.
    vec3 tubeColor = uColor;
    if (uAudioColorShift > 0.0) {
      vec3 hsv = rgb2hsv(uColor);
      hsv.x = fract(hsv.x + uAudio * uAudioColorShift * 0.35);
      tubeColor = hsv2rgb(hsv);
    }

    float movingUV = vUv.x - (uTime * uSpeed * uDotSpeed * uDirection) - uOffset;
    float signalPos = movingUV * uDotDensity;
    float dotId = floor(signalPos);
    float dotLocal = fract(signalPos);

    // Transient layer: louder bin energy lowers the hash threshold so more
    // dots spark on hits. Threshold stays at 0.6 (original) when reactivity is 0.
    float dotThreshold = mix(0.6, 0.15, clamp(uAudioFast * uAudioReactivity, 0.0, 1.0));
    float distToCenter = length(vec2((dotLocal - 0.5) * 2.0, (fract(vUv.y + 0.5) - 0.5) * 6.0));
    float dotShape = 1.0 - smoothstep(0.0, max(0.001, uDotSize), distToCenter);
    float dotFinal = dotShape * step(dotThreshold, hash(vec2(dotId, uOffset))) *
      (sin(uTime * 4.0 + hash(vec2(dotId)) * 6.28) * 0.3 + 0.7) * baseAlpha;

    if (uIsReflection > 0.5) {
      float refFade = 1.0 - smoothstep(uBendUv - 0.015, uBendUv, vUv.x);
      baseAlpha *= refFade;
      core *= refFade;
      dotFinal *= refFade * 0.1;
      baseAlpha = pow(max(0.0, baseAlpha), 0.5) * (0.7 + hash(vUv * 300.0 + uTime * 0.05) * 0.3);
      core *= 0.3;
    }

    // Envelope layer: smoothed bin energy scales brightness. 1.0 at reactivity 0.
    float audioBoost = 1.0 + uAudio * uAudioReactivity;

    vec3 trailColor = tubeColor * (baseAlpha + core * 1.5) * uIntensityMultiplier * uBrightness * audioBoost;
    vec3 rgb = trailColor / max(1.0 - clamp(dotFinal * 1.8, 0.0, 0.95), 0.001) +
               tubeColor * dotFinal * 2.5 * uIntensityMultiplier * uBrightness * audioBoost;

    gl_FragColor = vec4(rgb, (baseAlpha + dotFinal) * uIntensityMultiplier);
  }
`;

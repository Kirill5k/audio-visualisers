/* Mesh Grid source adapted with permission from vizz.fm.
 * Copyright (c) 2026 Mathew Preziotte. Original source release 1b2b169.
 * https://vizz.fm/app/ — retrieved 2026-09-20.
 */

export const meshVertexShader = `
  attribute float frequency;
  attribute vec2 planarPos;
  varying vec3 vPosition;
  varying vec2 vPlanar;
  varying float vFrequency;

  void main() {
    vPosition = position;
    vPlanar = planarPos;
    vFrequency = frequency;
    vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewPosition;
  }
`;

export const meshFragmentShader = `
  uniform vec3 baseColor;
  uniform float time;
  uniform float colorIntensity;
  uniform float colorReactivity;
  uniform float circleMode;
  uniform float gridHalfX;
  uniform float gridHalfZ;
  uniform float angleHueMix;
  uniform float surfaceOpacity;
  uniform float surfaceShade;
  uniform float fillReactivity;
  varying vec3 vPosition;
  varying vec2 vPlanar;
  varying float vFrequency;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    // Discard fragments outside the ellipse when circle mode is on.
    // Uses the undisplaced planar coords so the mask survives sphere wrap.
    if (circleMode > 0.5) {
      float nx = vPlanar.x / gridHalfX;
      float nz = vPlanar.y / gridHalfZ;
      if (nx * nx + nz * nz > 1.0) discard;
    }

    // Create a color gradient based on frequency
    // Low frequencies: blue/purple
    // Mid frequencies: green/yellow
    // High frequencies: orange/red
    // colorReactivity scales the frequency on the color path only, so height
    // (waveHeight) and alpha keep their own signal when analyser gain runs hot
    float cf = clamp(vFrequency * colorReactivity, 0.0, 1.0);
    float hue = mix(0.7, 0.0, cf); // 0.7 is blue, 0.0 is red
    float saturation = 0.8 + cf * 0.2;
    float value = 0.6 + cf * 0.4;

    // Add some pulsing effect with time
    value += sin(time * 2.0) * 0.1 * cf;

    // Convert HSV to RGB
    vec3 color = hsv2rgb(vec3(hue, saturation, value));

    // Angle-driven hue: color wheel around the center, amplitude still drives
    // saturation/value so the signal stays readable. Blended in RGB to avoid
    // hue-wrap artifacts.
    if (angleHueMix > 0.0) {
      float angleHue = fract(atan(vPlanar.y, vPlanar.x) / 6.2831853 + 0.5);
      vec3 angleColor = hsv2rgb(vec3(angleHue, saturation, value));
      color = mix(color, angleColor, angleHueMix);
    }

    // Mix with base color using the colorIntensity uniform
    color = mix(baseColor, color, colorIntensity);

    // surfaceShade darkens the solid fill so the wireframe reads as contour
    // lines on top of it; the wireframe itself uses shade 1 / opacity 1.
    // fillReactivity blends the fill's alpha from flat toward amplitude-driven,
    // so loud regions fill in solid while quiet ones stay wireframe.
    float alpha = surfaceOpacity * mix(1.0, vFrequency, fillReactivity);
    gl_FragColor = vec4(color * surfaceShade, alpha);
  }
`;

export const dotVertexShader = `
  attribute float frequency;
  attribute vec2 planarPos;
  uniform float dotSize;
  uniform float dotReactivity;
  uniform float uPixelRatio;
  uniform float sizeMul;
  varying vec2 vPlanar;
  varying float vFrequency;

  void main() {
    vPlanar = planarPos;
    vFrequency = frequency;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Reactivity shrinks quiet dots toward 15% of their base size
    float amp = mix(1.0, mix(0.15, 1.0, frequency), dotReactivity);
    // Prominence is opacity-led (see fragment); size only grows modestly.
    // sizeMul is 1 for the solid core, larger for the glow halo layer.
    float base = 0.7 + 0.2 * dotSize;
    gl_PointSize = base * sizeMul * amp * uPixelRatio * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const dotFragmentShader = `
  uniform vec3 baseColor;
  uniform float time;
  uniform float colorIntensity;
  uniform float colorReactivity;
  uniform float circleMode;
  uniform float gridHalfX;
  uniform float gridHalfZ;
  uniform float angleHueMix;
  uniform float dotSize;
  uniform float dotReactivity;
  varying vec2 vPlanar;
  varying float vFrequency;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    if (circleMode > 0.5) {
      float nx = vPlanar.x / gridHalfX;
      float nz = vPlanar.y / gridHalfZ;
      if (nx * nx + nz * nz > 1.0) discard;
    }

    // Circular sprite with a soft antialiased rim
    vec2 pc = gl_PointCoord - 0.5;
    float r2 = dot(pc, pc);
    if (r2 > 0.25) discard;
    float edge = smoothstep(0.25, 0.16, r2);

    // Same color scheme as the wireframe so dots read as part of the grid
    float cf = clamp(vFrequency * colorReactivity, 0.0, 1.0);
    float hue = mix(0.7, 0.0, cf);
    float saturation = 0.8 + cf * 0.2;
    float value = 0.6 + cf * 0.4;
    value += sin(time * 2.0) * 0.1 * cf;
    vec3 color = hsv2rgb(vec3(hue, saturation, value));
    if (angleHueMix > 0.0) {
      float angleHue = fract(atan(vPlanar.y, vPlanar.x) / 6.2831853 + 0.5);
      vec3 angleColor = hsv2rgb(vec3(angleHue, saturation, value));
      color = mix(color, angleColor, angleHueMix);
    }
    color = mix(baseColor, color, colorIntensity);

    // Reactivity fades quiet dots as well as shrinking them; the slider
    // itself drives overall alpha so dots fade in before they grow
    float fadeIn = clamp(dotSize * 3.0, 0.0, 1.0);
    float alpha = mix(1.0, clamp(0.1 + vFrequency * 1.2, 0.0, 1.0), dotReactivity);
    gl_FragColor = vec4(color, alpha * edge * fadeIn);
  }
`;

export const dotGlowFragmentShader = `
  uniform vec3 baseColor;
  uniform float time;
  uniform float colorIntensity;
  uniform float colorReactivity;
  uniform float circleMode;
  uniform float gridHalfX;
  uniform float gridHalfZ;
  uniform float angleHueMix;
  uniform float dotSize;
  uniform float dotReactivity;
  uniform float dotGlow;
  varying vec2 vPlanar;
  varying float vFrequency;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    if (circleMode > 0.5) {
      float nx = vPlanar.x / gridHalfX;
      float nz = vPlanar.y / gridHalfZ;
      if (nx * nx + nz * nz > 1.0) discard;
    }

    vec2 pc = gl_PointCoord - 0.5;
    float r2 = dot(pc, pc);
    if (r2 > 0.25) discard;
    float falloff = exp(-r2 * 18.0);

    float cf = clamp(vFrequency * colorReactivity, 0.0, 1.0);
    float hue = mix(0.7, 0.0, cf);
    float saturation = 0.8 + cf * 0.2;
    float value = 0.6 + cf * 0.4;
    value += sin(time * 2.0) * 0.1 * cf;
    vec3 color = hsv2rgb(vec3(hue, saturation, value));
    if (angleHueMix > 0.0) {
      float angleHue = fract(atan(vPlanar.y, vPlanar.x) / 6.2831853 + 0.5);
      vec3 angleColor = hsv2rgb(vec3(angleHue, saturation, value));
      color = mix(color, angleColor, angleHueMix);
    }
    color = mix(baseColor, color, colorIntensity);

    // Follows the core dots' fade-in and reactivity, scaled by the glow slider
    float fadeIn = clamp(dotSize * 3.0, 0.0, 1.0);
    float alpha = mix(1.0, clamp(0.1 + vFrequency * 1.2, 0.0, 1.0), dotReactivity);
    gl_FragColor = vec4(color, dotGlow * 0.6 * alpha * falloff * fadeIn);
  }
`;

export const backgroundVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Output directly to clip space - bypasses camera matrices entirely
    // position.xy ranges from -1 to 1 with PlaneGeometry(2, 2)
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

export const backgroundFragmentShader = `
  uniform int uBackgroundType;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform float uGradientAngle;
  uniform float uRadialX;
  uniform float uRadialY;
  uniform float uRadialRadius;
  uniform float uRadialSharpness;
  uniform float uTime;
  uniform float uAudioValue;
  uniform float uStarDensity;
  uniform float uTwinkleSpeed;
  uniform float uAudioReactivity;
  uniform float uPlasmaScale;
  uniform float uPlasmaSpeed;
  uniform float uPlasmaComplexity;
  uniform float uDustDensity;
  uniform float uDustSpeed;
  uniform float uDustOpacity;
  uniform float uDustSharpness;
  uniform vec3 uColor3;
  uniform float uGlowSize;
  uniform float uGlowSpeed;
  uniform float uGrain;
  uniform float uSkySunSize;
  uniform float uSkyHaze;
  uniform float uSkyGlare;
  uniform float uSkyField;
  uniform float uSkyStreaks;
  uniform float uSkyFlare;
  uniform vec2 uResolution;
  uniform float uFadeAlpha;
  // >= 0: draw this flat gray instead of the background. Used for the main pass
  // when a visualizer blend mode is active, so the framebuffer holds the
  // visualizer over the mode's neutral color and the fade pass can blend it
  // onto the real background.
  uniform float uNeutral;
  uniform int uBlendMode;
  uniform sampler2D uFramebuffer;

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


  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

  // Set a color's luminance, clipping toward gray if a channel leaves 0..1
  // (the Photoshop luminosity-mode approach)
  vec3 setLuma(vec3 c, float l) {
    vec3 r = c + (l - luma(c));
    float lr = luma(r);
    float mn = min(r.r, min(r.g, r.b));
    float mx = max(r.r, max(r.g, r.b));
    if (mn < 0.0) r = lr + (r - lr) * lr / max(lr - mn, 1e-4);
    if (mx > 1.0) r = lr + (r - lr) * (1.0 - lr) / max(mx - lr, 1e-4);
    return clamp(r, 0.0, 1.0);
  }

  // Hash function for pseudo-random values
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Sin-free hash that stays well distributed for large pixel coordinates, where the
  // sin-based hash above breaks down in mediump. Used for per-pixel grain and dither.
  float pixelHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Simple value noise
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Four corners
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    // Smooth interpolation
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  // One depth layer of floating particles. Expects p to already be aspect-corrected
  // (square cells) so the distance metric is circular and particles render round.
  // Each particle is a glowing orb: a tight bright core plus a soft halo, which reads
  // as a small sphere catching light rather than a featureless blur. Larger baseSize =
  // "closer" (bigger orb); smaller = "farther". Samples a 3x3 cell neighborhood so the
  // halos spill across cell borders.
  // The whole layer also drifts across the screen along drift (cell units per
  // second), so particles travel rather than just stirring in place. Cells stream
  // continuously through the field, so there is no visible wrap.
  float dustLayer(vec2 p, float cellScale, float threshold, float baseSize, float seed, float t, vec2 drift) {
    p = p * cellScale - drift * t;
    vec2 cell = floor(p);
    float total = 0.0;

    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 c = cell + vec2(float(dx), float(dy));
        float rnd = hash(c + seed);
        // Only some cells hold a particle
        if (rnd < threshold) continue;

        float phase = hash(c + seed + 2.5) * 6.28318;
        // Particle hangs suspended at its cell position...
        vec2 center = c + vec2(hash(c + seed + 0.5), hash(c + seed + 1.5));

        // ...and only stirs in occasional gentle bursts. A slow per-particle envelope
        // gates the motion: zero most of the time (the orb just hangs), easing up into a
        // soft stir now and then. Each particle's envelope is offset, so at any instant
        // some are stirring while the rest hold still - suspended, not drifting.
        float envPhase = hash(c + seed + 7.5) * 6.28318;
        float envRate = 0.05 + hash(c + seed + 8.5) * 0.08;
        float ts = t * 0.6;
        float stir = smoothstep(0.35, 1.0, sin(ts * envRate + envPhase));

        // During a burst it eases through a slow little arc (unique rate per particle)
        float fx = 0.1 + hash(c + seed + 4.5) * 0.25;
        float fy = 0.1 + hash(c + seed + 5.5) * 0.25;
        float amp = (0.2 + hash(c + seed + 6.5) * 0.18) * stir;
        center += amp * vec2(sin(ts * fx + phase), cos(ts * fy + phase * 1.7));

        float d = length(p - center);
        float size = baseSize * (0.7 + hash(c + seed + 3.5) * 0.6);

        // Particle shape. uDustSharpness morphs the falloff from a soft blurry glow (0)
        // to a crisp round dot (1): higher sharpness pushes the inner edge outward so the
        // gradient tightens into a hard edge, and flattens the gamma so the disc fills in.
        float inner = size * mix(0.0, 0.92, uDustSharpness);
        float orb = smoothstep(size, inner, d);
        orb = pow(orb, mix(1.6, 1.0, uDustSharpness));

        // Each particle breathes its brightness slowly and out of phase
        float breathe = 0.6 + 0.4 * sin(ts * 0.35 + phase);
        total += orb * breathe;
      }
    }

    return total;
  }

  void main() {
    vec3 color;

    if (uBackgroundType == 0) {
      // Solid color
      color = uColor1;

    } else if (uBackgroundType == 1) {
      // Linear gradient
      // Calculate gradient based on angle
      float angleRad = uGradientAngle;
      vec2 direction = vec2(cos(angleRad), sin(angleRad));

      // Project UV onto gradient direction
      float t = dot(vUv - 0.5, direction) + 0.5;
      t = clamp(t, 0.0, 1.0);

      color = mix(uColor1, uColor2, t);

    } else if (uBackgroundType == 2) {
      // Radial gradient with configurable center, radius, and sharpness.
      // Aspect-corrected so the falloff is a circle on widescreen, not an ellipse.
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 center = vec2(uRadialX, uRadialY);
      vec2 d = (vUv - center) * vec2(aspect, 1.0);
      float t = length(d) / uRadialRadius;
      t = clamp(t, 0.0, 1.0);
      // Apply sharpness: <1 = softer, 1 = linear, >1 = sharper
      t = pow(t, uRadialSharpness);
      // Ease into the outer color so the radius edge has no visible crease
      t = t * t * (3.0 - 2.0 * t);

      color = mix(uColor1, uColor2, t);

    } else if (uBackgroundType == 6) {
      // Ambient glow: two large, soft blooms of color drifting slowly over the base
      // color, with a low-frequency warp so their edges read as diffuse light rather
      // than perfect discs. The look of a blurred studio backdrop.
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float t = uTime * uGlowSpeed * 0.06;

      vec2 warp = vec2(noise(p * 1.6 + t * 0.7), noise(p * 1.6 - t * 0.5 + 7.3)) - 0.5;
      p += warp * 0.4;

      // Each bloom wanders on its own slow Lissajous path
      vec2 c1 = vec2(0.32 + 0.22 * sin(t * 0.9), 0.2 + 0.18 * cos(t * 0.7));
      vec2 c2 = vec2(-0.34 + 0.24 * cos(t * 0.6 + 2.0), -0.22 + 0.18 * sin(t * 0.8 + 1.0));

      float s2 = uGlowSize * uGlowSize;
      vec2 d1 = p - c1;
      vec2 d2 = p - c2;
      float g1 = exp(-dot(d1, d1) / (0.30 * s2));
      float g2 = exp(-dot(d2, d2) / (0.24 * s2));

      // Audio reactivity swells the blooms
      float boost = 1.0 + uAudioValue * uAudioReactivity * 0.5;
      color = uColor1;
      color = mix(color, uColor2, clamp(g1 * boost, 0.0, 1.0));
      color = mix(color, uColor3, clamp(g2 * boost, 0.0, 1.0));

    } else if (uBackgroundType == 3) {
      // Starfield
      color = uColor1; // Base background color

      // Scale UV for star density - higher density = more stars
      vec2 scaledUv = vUv * uStarDensity * 80.0;
      vec2 gridCell = floor(scaledUv);

      // Get random value for this grid cell
      float starRand = hash(gridCell);

      // Only some cells have stars (threshold controls star count)
      float starThreshold = 0.97;

      if (starRand > starThreshold) {
        // Position star randomly within cell
        vec2 starPos = gridCell + vec2(hash(gridCell + 0.5), hash(gridCell + 1.5));
        float dist = length(scaledUv - starPos);

        // Star brightness falloff
        float starSize = 0.1 + hash(gridCell + 2.5) * 0.15;
        float star = smoothstep(starSize, 0.0, dist);

        // Twinkle animation - each star has unique phase
        float twinklePhase = hash(gridCell + 3.5) * 6.28318;
        float twinkle = sin(uTime * uTwinkleSpeed * (0.5 + hash(gridCell + 4.5)) + twinklePhase);
        twinkle = twinkle * 0.4 + 0.6; // Bias toward visible (0.2 to 1.0)

        // Star color variation
        float colorVar = hash(gridCell + 5.5);
        vec3 starColor = uColor2;
        // Slight color temperature variation (warm to cool)
        starColor.r *= 0.9 + colorVar * 0.2;
        starColor.b *= 1.1 - colorVar * 0.2;

        // Audio reactivity - bass makes stars brighter (scaled by reactivity amount)
        float audioBoost = 1.0 + uAudioValue * uAudioReactivity * 2.0;

        // Final star brightness
        float brightness = star * twinkle * audioBoost;
        brightness *= 0.6 + hash(gridCell + 6.5) * 0.4; // Size variation

        color += starColor * brightness;
      }

    } else if (uBackgroundType == 4) {
      // Plasma - layered noise for organic flowing patterns
      float time = uTime * uPlasmaSpeed;

      // Scale UV coordinates
      vec2 uv = vUv * uPlasmaScale;

      // Layer multiple noise octaves for complexity
      float n = 0.0;
      float amplitude = 1.0;
      float frequency = 1.0;

      // Number of octaves based on complexity (1-5)
      int octaves = int(uPlasmaComplexity);

      for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;

        // Offset each layer differently over time for flowing effect
        vec2 offset = vec2(
          sin(time * 0.3 + float(i) * 1.7) * 0.5,
          cos(time * 0.4 + float(i) * 2.1) * 0.5
        );

        n += amplitude * noise((uv + offset) * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }

      // Normalize noise to 0-1
      n = n * 0.5 + 0.5;

      // Create plasma color by mixing the two colors with noise
      // Use multiple noise samples for more interesting color patterns
      float n2 = noise(uv * 1.5 + vec2(time * 0.1, -time * 0.15));
      float n3 = noise(uv * 0.7 - vec2(time * 0.08, time * 0.12));

      float mixFactor = (n + n2 * 0.5 + n3 * 0.3) / 1.8;
      mixFactor = pow(mixFactor, 0.8); // Adjust contrast

      // Audio reactivity: boost the secondary color presence
      // Higher audio = more secondary color visible
      float audioBoost = uAudioValue * uAudioReactivity;
      mixFactor = mixFactor + audioBoost * (1.0 - mixFactor) * 0.5;
      mixFactor = clamp(mixFactor, 0.0, 1.0);

      // Mix colors
      color = mix(uColor1, uColor2, mixFactor);

    } else if (uBackgroundType == 5) {
      // Floating dust - layered soft particles with faked depth (bokeh).
      // Each layer drifts at a different speed (parallax) and breathes over time.
      // Depth is purely time-based self-motion, never camera-coupled, so it sits
      // behind 3D visualizers as atmosphere without fighting the real camera.
      color = uColor1; // Base background color
      float t = uTime * uDustSpeed;
      float dens = uDustDensity;
      vec3 dustColor = uColor2;

      // Aspect-correct UV so cells are square and particles render round, not oval
      vec2 auv = vUv * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);

      // Each layer drifts as a whole at its own rate for parallax (near moves fastest
      // in screen space because its cells are largest), and particles stir inside.
      // Depth comes from orb size and density (near = larger/fewer, far = tiny/many).
      float far = dustLayer(auv, 30.0 * dens, 0.88, 0.16, 11.0, t, vec2(0.05, 0.02));
      float mid = dustLayer(auv, 16.0 * dens, 0.83, 0.22, 37.0, t, vec2(0.08, 0.035));
      float near = dustLayer(auv, 7.0 * dens, 0.80, 0.30, 71.0, t, vec2(0.12, 0.05));

      // Weight by depth: far dim, near bright
      float dust = far * 0.6 + mid * 0.85 + near * 1.0;

      // Whole field breathes slowly as one
      dust *= 0.85 + 0.15 * sin(t * 0.2);

      // Audio reactivity - gently brighten the field
      dust *= 1.0 + uAudioValue * uAudioReactivity;

      // Overall opacity / intensity of the field
      dust *= uDustOpacity;

      color += dustColor * dust;
    } else if (uBackgroundType == 7) {
      // Sky: the sun photographed from the ground. A small bright disc under a huge,
      // soft fan of scattered light on a muted sky, everything wide and low-contrast.
      // Light is accumulated additively in a linear "exposure" space and then rolled
      // off with a soft tonemap, so bright cores drift toward white the way a camera
      // sensor saturates, instead of clipping to a hot orange or muddying toward
      // brown. The base sky and ground colors are pre-inverted through the same
      // curve, so with no light on top of them they render exactly as picked.
      // Haze softens the disc and widens its halo; Glare is the exposure of the
      // scattered-light dome and the veil it throws over the frame.
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      float t = uTime * uGlowSpeed;
      float audio = uAudioValue * uAudioReactivity;

      vec2 sun = vec2(uRadialX, uRadialY);
      float horizonY = uSkyField;
      float groundSoft = 0.004 + 0.02 * uSkyHaze;
      float ground = 1.0 - smoothstep(horizonY - groundSoft, horizonY + groundSoft, vUv.y);

      // Sky gradient: horizon color pools low with an exponential falloff, zenith
      // color owns the top of the frame
      float skyT = clamp((vUv.y - horizonY) / max(1.0 - horizonY, 0.05), 0.0, 1.0);
      float skyMix = (1.0 - exp(-skyT * 2.4)) / (1.0 - exp(-2.4));
      vec3 skyBase = mix(uColor2, uColor1, skyMix);
      vec3 groundBase = mix(uColor1, uColor2, 0.3) * 0.42;
      vec3 base = mix(skyBase, groundBase, ground);
      vec3 light = -log(1.0 - min(base, vec3(0.985)));

      // Sun-relative coordinates, aspect corrected. Refraction squashes a large disc
      // as it nears the horizon; a tiny disc stays round
      vec2 d = (vUv - sun) * vec2(aspect, 1.0);
      float low = 1.0 - smoothstep(0.0, 0.25, sun.y - horizonY);
      d.y *= 1.0 + 0.5 * low * smoothstep(0.02, 0.08, uSkySunSize);
      float r = length(d);
      float aboveSun = vUv.y - sun.y;

      // Dome: a wide fan of scattered light rising from the sun. Wider than it is
      // tall, brightest low, with a long soft tail. Its color runs from the sun color
      // at the base to a cool, desaturated lit-air tint at the top, so the upper dome
      // reads as sky catching light rather than as a bigger sun. Bass swells it.
      vec2 gd = vec2(d.x * 0.85, max(aboveSun, 0.0) * 1.05 - min(aboveSun, 0.0) * 2.2);
      float domeW = 0.36 * (1.0 + 0.15 * audio);
      float dome = exp(-pow(length(gd) / domeW, 1.5));
      float domeUp = smoothstep(0.0, 0.45, aboveSun);
      vec3 domeColor = mix(uColor3, vec3(0.80, 0.82, 0.92), 0.25 + 0.4 * domeUp);
      float domeAmt = dome * uSkyGlare * 1.5 * (1.0 - ground * 0.75);
      light += domeColor * domeAmt;

      // Halo hugging the disc: an exponential tail (forward scatter) plus a tight
      // gaussian core. Haze widens and brightens the tail.
      float size = uSkySunSize * (1.0 + 0.03 * sin(t * 2.3) + 0.05 * audio);
      float haloW = size * (1.0 + 2.5 * uSkyHaze) + 0.015;
      float halo = exp(-r / haloW) * (0.4 + 0.7 * uSkyHaze)
        + exp(-(r * r) / (size * size * 6.0)) * (0.8 - 0.4 * uSkyHaze);
      light += uColor3 * halo * (1.0 - ground * 0.9);

      // Veil: glare lifts the whole frame toward warm white around the sun
      float veil = exp(-r * 2.2) * uSkyGlare * 0.55 * (1.0 + 0.4 * audio);
      light += mix(uColor3, vec3(1.0), 0.5) * veil * (1.0 - ground * 0.7);

      // Disc: haze softens its edge and dims it from a blown-white point to a
      // colored, filtered disc you can look at
      float discIn = size * (0.9 - 0.45 * uSkyHaze);
      float discOut = size * (1.0 + 0.3 * uSkyHaze);
      float disc = 1.0 - smoothstep(discIn, discOut, r);
      light += mix(uColor3, vec3(1.0), 0.3) * disc * mix(9.0, 1.4, uSkyHaze);

      // Horizon: a thin warm flush lying along the horizon line, widest under the sun,
      // and a faint haze layer softening the ground edge
      float rim = exp(-max(vUv.y - horizonY, 0.0) * 28.0) * exp(-abs(d.x) * 1.4);
      light += uColor3 * rim * 0.35 * (1.0 - ground) * step(0.001, horizonY);
      float horizonHaze = exp(-abs(vUv.y - horizonY) * 24.0) * 0.12 * step(0.001, horizonY);
      light += domeColor * horizonHaze;

      // Cloud striations: long horizontal bands drifting past, two octaves so they
      // read as thin cloud rather than a repeating ripple. They filter the light
      // layers (clouds sit in front of the sun) and only faintly tint the sky.
      if (uSkyStreaks > 0.0) {
        float c1 = noise(vec2(vUv.x * aspect * 1.4 + t * 0.015, vUv.y * 11.0 + t * 0.003));
        float c2 = noise(vec2(vUv.x * aspect * 3.6 - t * 0.01, vUv.y * 26.0 - t * 0.002));
        float cloud = (c1 * 0.65 + c2 * 0.35) - 0.5;
        float streakMask = (1.0 - skyT * 0.6) * (1.0 - ground);
        float filt = 1.0 - clamp(cloud * uSkyStreaks * 1.2, -0.6, 0.6) * streakMask;
        light = mix(light, light * filt, 0.75);
      }

      // Lens flare: many soft rays around the sun with random lengths and weights,
      // a wide bright burst at the core, and one large ghost arc mirrored through
      // the frame center
      if (uSkyFlare > 0.0) {
        float ang = atan(d.y, d.x);
        float a1 = ang * 9.0 + t * 0.1;
        float a2 = ang * 21.0 - t * 0.07 + 1.0;
        float a3 = ang * 37.0 + t * 0.04 + 2.0;
        float v1 = 0.2 + 0.8 * hash(vec2(floor(a1 / 3.14159), 3.0));
        float v2 = 0.2 + 0.8 * hash(vec2(floor(a2 / 3.14159), 7.0));
        float v3 = 0.2 + 0.8 * hash(vec2(floor(a3 / 3.14159), 11.0));
        float rays = pow(abs(sin(a1)), 10.0) * v1 * 0.5 * exp(-r * (1.2 + 2.5 * (1.0 - v1)))
          + pow(abs(sin(a2)), 14.0) * v2 * exp(-r * (1.6 + 3.0 * (1.0 - v2)))
          + pow(abs(sin(a3)), 30.0) * v3 * exp(-r * (2.5 + 4.0 * (1.0 - v3)));
        rays *= 0.15 * (1.0 + 0.8 * audio) * smoothstep(0.0, size * 3.0, r);
        float burst = exp(-r * 6.0) * 1.2;
        vec2 ghostC = (vec2(0.5) - sun) * 1.4 + vec2(0.5);
        vec2 gdd = (vUv - ghostC) * vec2(aspect, 1.0);
        float gr = length(gdd);
        float ring = exp(-pow(abs(gr - 0.42) / 0.06, 2.0)) * 0.22
          + exp(-(gr * gr) / 0.05) * 0.12;
        float flare = uSkyFlare * (rays + burst + ring) * (1.0 - ground * 0.7);
        light += mix(uColor3, vec3(1.0), 0.45) * flare;
      }

      color = 1.0 - exp(-light);

      // Soft vignette so the corners fall away and the eye settles on the light
      vec2 vq = (vUv - vec2(0.5, 0.45)) * vec2(aspect * 0.7, 1.1);
      color *= 1.0 - 0.32 * smoothstep(0.4, 1.1, length(vq));
    }

    if (uNeutral >= 0.0) {
      gl_FragColor = vec4(vec3(uNeutral), 1.0);
      return;
    }

    if (uBackgroundType != 0) {
      // Grain: static per-pixel texture, scaled with brightness so it reads as
      // texture in the lit areas and stays faint in the shadows. Deliberately not
      // animated: moving grain belongs to the global post-processing effect.
      if (uGrain > 0.0) {
        float g = pixelHash(gl_FragCoord.xy) - 0.5;
        color += g * uGrain * (0.012 + 0.25 * color);
      }
      // Sub-LSB dither so slow dark gradients don't band on the 8-bit framebuffer
      color += (pixelHash(gl_FragCoord.xy) - 0.5) / 255.0;
    }

    // Fade pass only (see renderBackgroundFade): uFadeAlpha is the uniform fade
    float fade = uFadeAlpha;
    if (uBlendMode != 0) {
      // fb is the visualizer drawn over the mode's neutral color (black for
      // every mode below 11 that needs it, see BLEND_NEUTRAL)
      vec3 fb = texture2D(uFramebuffer, gl_FragCoord.xy / uResolution).rgb;
      vec3 blended;
      if (uBlendMode == 11) {
        // Luma key: the visualizer's brightness is its alpha. Dark pixels vanish,
        // bright ones sit on the background at their true color, and the
        // background is never brightened or washed out.
        float key = smoothstep(0.0, 0.7, luma(fb));
        blended = color * (1.0 - key) + fb;
      } else if (uBlendMode == 12) {
        // Glow: add the visualizer as light in linear space, then roll off with
        // the same soft tonemap the sky uses, so cores drift to cream instead of
        // clipping to white. The background is pre-inverted so it passes through
        // unchanged where the visualizer is dark.
        vec3 bgLin = toLinear(color);
        vec3 light = -log(1.0 - min(bgLin, vec3(0.985))) + toLinear(fb) * 1.6;
        blended = toSrgb(1.0 - exp(-light));
      } else if (uBlendMode == 13) {
        // Luminosity: the visualizer sculpts brightness in the background's own
        // hue and saturation, so there is no palette clash by construction.
        float l = luma(color);
        float target = 1.0 - (1.0 - l) * (1.0 - luma(fb));
        blended = setLuma(color, target);
      } else if (uBlendMode == 14) {
        // Palette lock: visualizer brightness maps from the background color at
        // this pixel toward its lit color (the accent when set, otherwise the
        // background screened with itself)
        vec3 lit = max(uColor3, max(uColor2, 1.0 - (1.0 - color) * (1.0 - color)));
        blended = mix(color, lit, smoothstep(0.0, 1.0, luma(fb)));
      } else {
        blended = applyBlend(color, fb, uBlendMode);
      }
      gl_FragColor = vec4(mix(blended, color, fade), 1.0);
      return;
    }
    gl_FragColor = vec4(color, fade);
  }
`;

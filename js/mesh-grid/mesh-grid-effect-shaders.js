/**
 * Mesh Grid effects adapted from Vizz.fm with the user's confirmed permission.
 * Original: vizz.fm (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-3ced9d0c98830ef9.js
 * Release: 1b2b169. Retrieved: 2026-09-20. No additional license is granted.
 */

// Original GLSL, preserved verbatim from the published bundle.
export const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const feedbackFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tFeedback;
  uniform vec2 resolution;
  uniform float decayFrame;
  uniform float injectFrame;
  uniform float zoomFrame;
  uniform float rotateFrame;
  uniform vec2 offsetFrame;
  uniform float hueFrame;
  uniform float centerX;
  uniform float centerY;
  uniform int blendModeInt;
  uniform float opacity;

  varying vec2 vUv;

  // Rotate color about the gray axis (Rodrigues rotation): cheap hue shift
  vec3 hueRotate(vec3 c, float a) {
    const vec3 k = vec3(0.57735026919);
    float cosA = cos(a);
    return c * cosA + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cosA);
  }

  void main() {
    vec4 current = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Inverse-transform this pixel to find where it lived in the previous
    // frame: un-rotate and un-zoom around the center (aspect-corrected so the
    // motion is circular), then back out the drift
    vec2 p = vUv - center;
    p.x *= aspect;
    float c = cos(-rotateFrame);
    float s = sin(-rotateFrame);
    p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    p /= zoomFrame;
    p.x /= aspect;
    vec2 fuv = p + center - offsetFrame;

    // Outside the previous frame there is no trail; zero it instead of
    // letting the edge clamp smear inward
    float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
    vec3 prev = texture2D(tFeedback, fuv).rgb * inside;

    if (hueFrame != 0.0) {
      prev = hueRotate(prev, hueFrame);
    }

    vec3 result;
    if (blendModeInt == 1) {
      // Add accumulates toward current / (1 - decay). Scaling the injected
      // current by injectFrame keeps that equilibrium identical across frame
      // rates, so frame-time jitter can't pulse the trail brightness.
      result = current.rgb * injectFrame + prev * decayFrame;
    } else if (blendModeInt == 2) {
      result = mix(current.rgb, prev, decayFrame);
    } else {
      result = max(current.rgb, prev * decayFrame);
    }

    gl_FragColor = vec4(mix(current.rgb, result, opacity), current.a);
  }
`;

export const gradientMapFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform float colorCount;
  uniform vec3 color1;
  uniform vec3 color2;
  uniform vec3 color3;
  uniform vec3 color4;
  uniform float paletteCount;
  uniform vec3 paletteColor1;
  uniform vec3 paletteColor2;
  uniform vec3 paletteColor3;
  uniform vec3 paletteColor4;
  uniform float shift;
  uniform float cycleSpeed;
  uniform bool cyclic;
  uniform float posterize;
  uniform float opacity;

  varying vec2 vUv;

  // A named palette lives in its own uniforms because the control-backed
  // color1..4 uniforms are re-stamped from the pickers every frame
  vec3 getStop(int i) {
    if (paletteCount >= 2.0) {
      if (i <= 0) return paletteColor1;
      if (i == 1) return paletteColor2;
      if (i == 2) return paletteColor3;
      return paletteColor4;
    }
    if (i <= 0) return color1;
    if (i == 1) return color2;
    if (i == 2) return color3;
    return color4;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    // Rec. 709 luminance
    float l = dot(original.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Quantize into flat bands before mapping (screen-print look)
    if (posterize >= 2.0) {
      l = clamp(floor(l * posterize) / (posterize - 1.0), 0.0, 1.0);
    }

    float t = l + shift + time * cycleSpeed;
    float activeCount = paletteCount >= 2.0 ? paletteCount : colorCount;
    int count = int(activeCount + 0.5);
    vec3 mapped;

    if (cyclic) {
      float pos = fract(t) * float(count);
      int i = int(min(pos, float(count) - 0.001));
      float f = pos - float(i);
      int j = i + 1 >= count ? 0 : i + 1;
      mapped = mix(getStop(i), getStop(j), f);
    } else {
      float pos = clamp(t, 0.0, 1.0) * (float(count) - 1.0);
      int i = int(min(pos, float(count) - 1.001));
      float f = pos - float(i);
      mapped = mix(getStop(i), getStop(i + 1), f);
    }

    gl_FragColor = vec4(mix(original.rgb, mapped, opacity), original.a);
  }
`;

export const gammaCorrectionFragmentShader = `
  uniform float gamma;
  uniform bool decode;
  uniform float hueShift;
  uniform float hueSpeed;
  uniform float time;
  uniform float opacity;
  uniform sampler2D tDiffuse;

  varying vec2 vUv;

  vec3 hueRotate(vec3 c, float angle) {
    // RGB → YIQ
    const mat3 rgb2yiq = mat3(
      0.299,  0.587,  0.114,
      0.596, -0.274, -0.322,
      0.211, -0.523,  0.312
    );
    const mat3 yiq2rgb = mat3(
      1.0,  0.956,  0.621,
      1.0, -0.272, -0.647,
      1.0, -1.106,  1.703
    );
    vec3 yiq = c * rgb2yiq;
    float ca = cos(angle);
    float sa = sin(angle);
    vec2 iq = vec2(yiq.y * ca - yiq.z * sa, yiq.y * sa + yiq.z * ca);
    return vec3(yiq.x, iq.x, iq.y) * yiq2rgb;
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    vec3 rotated = hueRotate(color.rgb, hueShift + time * hueSpeed);

    vec3 corrected;
    if (decode) {
      corrected = pow(max(rotated, 0.0), vec3(gamma));
    } else {
      corrected = pow(max(rotated, 0.0), vec3(1.0 / gamma));
    }

    gl_FragColor = vec4(mix(color.rgb, corrected, opacity), color.a);
  }
`;

export const swirlFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float angle;
  uniform float radius;
  uniform float falloff;
  uniform float centerX;
  uniform float centerY;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);

    // Get position relative to center
    vec2 delta = vUv - center;
    float dist = length(delta);

    // Calculate swirl amount based on distance from center
    // Closer to center = more rotation
    float normalizedDist = dist / radius;

    // Apply falloff curve - creates smooth transition
    float swirlAmount = 0.0;
    if (normalizedDist < 1.0) {
      // Smooth falloff using power function
      float falloffFactor = 1.0 - pow(normalizedDist, falloff);
      swirlAmount = angle * falloffFactor;
    }

    // Apply rotation
    float s = sin(swirlAmount);
    float c = cos(swirlAmount);

    vec2 rotated = vec2(
      c * delta.x - s * delta.y,
      s * delta.x + c * delta.y
    );

    vec2 swirlUV = rotated + center;

    // Clamp to valid UV range
    swirlUV = clamp(swirlUV, 0.0, 1.0);

    vec4 swirlColor = texture2D(tDiffuse, swirlUV);

    gl_FragColor = mix(original, swirlColor, opacity);
  }
`;

export const kaleidoscopeFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float segmentCount;
  uniform bool rotateCopies;
  uniform float rotation;
  uniform float spin;
  uniform float twist;
  uniform float zoom;
  uniform float centerX;
  uniform float centerY;
  uniform float blend;
  uniform float opacity;

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TWO_PI 6.28318530718

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave).
  // Lets the kaleidoscope tile the source infinitely with no edge smear.
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  // Sample the source at a folded wedge angle, reconstructing the UV by
  // undoing the aspect correction and recentering, with seamless
  // mirror-repeat so the pattern continues cleanly past the edges.
  vec4 sampleWedge(float angle, float radius, float aspect, vec2 center) {
    vec2 uv = vec2(cos(angle), sin(angle)) * radius;
    uv.x /= aspect;
    uv += center;
    return texture2D(tDiffuse, mirrorRepeat(uv));
  }

  void main() {
    // Sample original color first
    vec4 original = texture2D(tDiffuse, vUv);

    // Define the center point (can be controlled by uniforms)
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Centered, aspect-corrected coordinates so wedges aren't stretched by 16:9
    vec2 p = vUv - center;
    p.x *= aspect;
    p /= zoom;

    // Convert to polar coordinates
    float radius = length(p);
    float angle = atan(p.y, p.x);

    // Static rotation + animated spin + radius-dependent twist (vortex)
    angle += rotation + time * spin + radius * twist;

    // Fold the angle into a single mirrored wedge -> the kaleidoscope reflection
    // Rotate Copies repeats the wedge by rotation instead of reflection, so
    // each copy is upside-down relative to its neighbor (with one segment the
    // bottom half is the top half turned 180 degrees, left becoming right).
    float segmentAngle = TWO_PI / segmentCount;
    vec4 kaleidoscoped;
    if (rotateCopies) {
      float wedge = segmentAngle * 0.5;
      float t = mod(angle, wedge);
      kaleidoscoped = sampleWedge(t, radius, aspect, center);

      // Crossfade the end of each wedge into the start of the next copy to
      // soften the seam (mirror mode is seamless by construction)
      if (blend > 0.001) {
        float w = smoothstep(1.0 - blend, 1.0, t / wedge);
        if (w > 0.0) {
          kaleidoscoped = mix(kaleidoscoped, sampleWedge(t - wedge, radius, aspect, center), w);
        }
      }
    } else {
      angle = mod(angle, segmentAngle);
      angle = abs(angle - segmentAngle * 0.5);
      kaleidoscoped = sampleWedge(angle, radius, aspect, center);
    }

    // Mix between original and effect based on opacity
    gl_FragColor = mix(original, kaleidoscoped, opacity);
  }
`;

export const gridTileFragmentShader = `
  uniform sampler2D tDiffuse;
  // Viewport-adapted grid counts, derived from the authored columns/rows by
  // updateGridTile. The authored values stay JS-side so slider drags survive.
  uniform float effColumns;
  uniform float effRows;
  uniform float zoom;
  uniform float centerX;
  uniform float centerY;
  uniform float gap;
  uniform float overlap;
  uniform bool mirror;
  uniform float rotationStep;
  uniform int rotationModeInt;
  uniform float opacity;
  uniform vec2 resolution;

  varying vec2 vUv;

  float tileAngle(vec2 tileIdx) {
    float stepRad = radians(rotationStep);
    if (rotationModeInt == 1) {
      vec2 centerTile = vec2((effColumns - 1.0) * 0.5, (effRows - 1.0) * 0.5);
      return stepRad * length(tileIdx - centerTile);
    }
    if (rotationModeInt == 2) {
      // hash for deterministic per-tile randomness; *4 so a small step still spans a wide range
      float h = fract(sin(dot(tileIdx, vec2(12.9898, 78.233))) * 43758.5453);
      return stepRad * h * 4.0;
    }
    return stepRad * (tileIdx.x + tileIdx.y * effColumns);
  }

  // Sample a tile's contribution at a given local UV
  vec4 sampleTile(vec2 localUV, vec2 tileIdx, vec2 tileSize, vec2 sampleSize, vec2 center) {
    vec2 uv = localUV;
    // Each axis flip reverses the visual sense of rotation; track parity so
    // mirrored neighbors rotate in the same visual direction.
    float angleSign = 1.0;
    if (mirror) {
      if (mod(tileIdx.x, 2.0) >= 1.0) { uv.x = 1.0 - uv.x; angleSign = -angleSign; }
      if (mod(tileIdx.y, 2.0) >= 1.0) { uv.y = 1.0 - uv.y; angleSign = -angleSign; }
    }

    float a = tileAngle(tileIdx) * angleSign;
    if (a != 0.0) {
      // Rotate in cell-pixel space so the rotation stays circular regardless of tile aspect.
      vec2 cellPx = vec2(resolution.x / effColumns, resolution.y / effRows);
      float c = cos(a), s = sin(a);
      vec2 p = (uv - 0.5) * cellPx;
      vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      uv = rp / cellPx + 0.5;
      // Discard rotated corners that fall outside the tile so they don't smear
      // against the source-edge clamp below.
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4(0.0);
      }
    }

    vec2 sampleUV = center + (uv - 0.5) * sampleSize;
    sampleUV = clamp(sampleUV, 0.0, 1.0);
    return texture2D(tDiffuse, sampleUV);
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 tileSize = vec2(1.0 / effColumns, 1.0 / effRows);
    vec2 center = vec2(centerX, centerY);

    // ---- Fast path: no overlap (original behavior with gap support) ----
    if (overlap <= 0.001) {
      vec2 tileIndex = floor(vUv / tileSize);
      vec2 tileUV = fract(vUv / tileSize);

      // Gap: show black in gap region
      vec2 gapUV = gap / tileSize;
      vec2 halfGapUV = gapUV * 0.5;

      if (tileUV.x < halfGapUV.x || tileUV.x > 1.0 - halfGapUV.x ||
          tileUV.y < halfGapUV.y || tileUV.y > 1.0 - halfGapUV.y) {
        gl_FragColor = mix(original, vec4(0.0, 0.0, 0.0, 1.0), opacity);
        return;
      }

      // Remap to exclude gap
      tileUV = (tileUV - halfGapUV) / (1.0 - gapUV);

      vec2 sampleSize = tileSize / zoom;
      vec4 tiled = sampleTile(tileUV, tileIndex, tileSize, sampleSize, center);
      gl_FragColor = mix(original, tiled, opacity);
      return;
    }

    // ---- Overlap blending path ----
    // Each tile extends beyond its grid cell by overlap * tileSize on each side.
    // We check a 3x3 neighborhood and additively blend all contributions.
    // With dark backgrounds, only bright content (objects) accumulates.

    vec4 accumulated = vec4(0.0);
    vec2 homeTile = floor(vUv / tileSize);

    // The expanded tile shows proportionally more source content
    vec2 expandedTileSize = (1.0 + 2.0 * overlap) * tileSize;
    vec2 sampleSize = expandedTileSize / zoom;
    vec2 overlapSize = overlap * tileSize;

    for (int iy = -1; iy <= 1; iy++) {
      for (int ix = -1; ix <= 1; ix++) {
        vec2 tileIdx = homeTile + vec2(float(ix), float(iy));

        // Skip tiles outside the grid. Real branches beat step() math here:
        // the texture fetch dominates cost, and adjacent pixels branch the
        // same way, so skipped iterations are nearly free.
        if (tileIdx.x < 0.0 || tileIdx.y < 0.0 ||
            tileIdx.x > effColumns - 1.0 || tileIdx.y > effRows - 1.0) {
          continue;
        }

        // Core tile boundaries (without overlap)
        vec2 coreTileStart = tileIdx * tileSize;
        vec2 coreTileEnd = coreTileStart + tileSize;

        // Expanded tile boundaries
        vec2 expandedStart = coreTileStart - overlapSize;
        vec2 expandedEnd = coreTileEnd + overlapSize;

        // Skip tiles whose expanded footprint doesn't reach this pixel
        if (vUv.x < expandedStart.x || vUv.x > expandedEnd.x ||
            vUv.y < expandedStart.y || vUv.y > expandedEnd.y) {
          continue;
        }

        // Edge fade: smooth falloff in the overlap zone
        // Inside core tile → weight 1, in overlap fringe → smooth fade to 0
        // This prevents hard cutoffs at expanded tile edges

        // Distance outside core, normalized to overlap size (0 = at core edge, 1 = at expanded edge)
        vec2 distOutside = vec2(0.0);
        distOutside.x = max(coreTileStart.x - vUv.x, vUv.x - coreTileEnd.x);
        distOutside.x = max(distOutside.x, 0.0) / max(overlapSize.x, 0.001);
        distOutside.y = max(coreTileStart.y - vUv.y, vUv.y - coreTileEnd.y);
        distOutside.y = max(distOutside.y, 0.0) / max(overlapSize.y, 0.001);

        float fadeX = 1.0 - smoothstep(0.0, 1.0, distOutside.x);
        float fadeY = 1.0 - smoothstep(0.0, 1.0, distOutside.y);
        float fade = fadeX * fadeY;

        // Local UV within the expanded tile [0, 1]
        vec2 localUV = (vUv - expandedStart) / (expandedEnd - expandedStart);

        accumulated += sampleTile(localUV, tileIdx, tileSize, sampleSize, center) * fade;
      }
    }

    vec4 tiled = clamp(accumulated, 0.0, 1.0);
    gl_FragColor = mix(original, tiled, opacity);
  }
`;

export const concentricTileFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float time;
  uniform float scaleFactor;
  uniform float baseRadius;
  uniform float zoom;
  uniform float centerX;
  uniform float centerY;
  uniform float twist;
  uniform float spin;
  uniform bool mirror;
  uniform float blend;
  uniform float innerRings;
  uniform float opacity;

  varying vec2 vUv;

  // Fold any coordinate into [0,1] with seamless reflections (triangle wave),
  // same trick as the kaleidoscope, so out-of-frame samples don't smear.
  vec2 mirrorRepeat(vec2 p) {
    return abs(mod(p - 1.0, 2.0) - 1.0);
  }

  // Sample one ring band. t in [0,1] picks the radius within the source band;
  // f is the unwrapped log-radius, kept continuous so twist spirals smoothly
  // across ring boundaries instead of stepping.
  vec4 sampleRing(float t, float f, float angle, float aspect, vec2 center) {
    float r = baseRadius * pow(scaleFactor, t - 1.0);
    float a = angle + radians(twist) * f + time * spin;
    vec2 uv = vec2(cos(a), sin(a)) * r / zoom;
    uv.x /= aspect;
    uv += center;
    return texture2D(tDiffuse, mirrorRepeat(uv));
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);
    float aspect = resolution.x / resolution.y;

    // Aspect-corrected polar coordinates so rings stay circular on 16:9
    vec2 p = vUv - center;
    p.x *= aspect;
    float radius = length(p);
    float angle = atan(p.y, p.x);

    // Unwrapped ring position: f = 0 at the outer edge of the source band,
    // +1 per ring outward, -1 per ring inward
    float f = log(max(radius, 1e-5) / baseRadius) / log(scaleFactor);

    // Wrap into the source band. Sawtooth repeats it outright; the mirror
    // option uses a triangle wave so adjacent rings reflect into each other,
    // which removes the seam entirely.
    float t;
    if (mirror) {
      float m = mod(f, 2.0);
      t = m > 1.0 ? 2.0 - m : m;
    } else {
      t = fract(f);
    }

    vec4 tiled = sampleRing(t, f, angle, aspect, center);

    // Crossfade the top of each band into the next ring to soften the seam
    // (unnecessary in mirror mode, which is seamless by construction)
    if (!mirror && blend > 0.001) {
      float w = smoothstep(1.0 - blend, 1.0, t);
      if (w > 0.0) {
        tiled = mix(tiled, sampleRing(t - 1.0, f, angle, aspect, center), w);
      }
    }

    // log(radius) diverges at the center, so the innermost copies collapse to
    // sub-pixel shimmer. Fade back to the original image after innerRings
    // inward repetitions.
    float innerFade = smoothstep(-innerRings - 1.0, -innerRings, f);

    gl_FragColor = mix(original, tiled, opacity * innerFade);
  }
`;

export const radialBlurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float strength;
  uniform float samples;
  uniform float centerX;
  uniform float centerY;
  uniform float innerRadius;
  uniform float falloff;
  uniform float opacity;

  varying vec2 vUv;

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec2 center = vec2(centerX, centerY);

    // Direction from current pixel toward center
    vec2 toCenter = center - vUv;
    float dist = length(toCenter);

    // Normalize direction
    vec2 direction = dist > 0.0 ? toCenter / dist : vec2(0.0);

    // Calculate blur amount based on distance from center
    // Inner radius creates a clear zone in the middle
    float blurAmount = 0.0;
    if (dist > innerRadius) {
      float normalizedDist = (dist - innerRadius) / (1.0 - innerRadius);
      blurAmount = pow(normalizedDist, falloff) * strength;
    }

    // Accumulate samples along the radial direction
    vec4 color = vec4(0.0);
    float sampleCount = max(4.0, samples);

    // Per-pixel jitter (interleaved gradient noise) offsets each pixel's
    // sample positions along the streak, turning the discrete ghost images
    // of a regular sample grid into a smooth blur at low sample counts
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

    for (float i = 0.0; i < 32.0; i++) {
      if (i >= sampleCount) break;

      float t = (i + jitter) / sampleCount;
      // Sample from current position toward center
      vec2 sampleUV = vUv + direction * blurAmount * t;
      sampleUV = clamp(sampleUV, 0.0, 1.0);
      color += texture2D(tDiffuse, sampleUV);
    }

    color /= sampleCount;

    gl_FragColor = mix(original, color, opacity);
  }
`;

export const tiltShiftFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float focusPosition;
  uniform float focusWidth;
  uniform float blurAmount;
  uniform float falloff;
  uniform float opacity;
  uniform vec2 resolution;

  varying vec2 vUv;

  // Calculate blur factor using gaussian-style continuous falloff
  // No hard edges - blur grows organically from focus position
  float getBlurFactor(float y) {
    float distFromFocus = abs(y - focusPosition);

    // Subtract focus width to create a "plateau" of sharpness in the center
    // but use a soft threshold so there's no hard edge
    float effectiveDist = max(0.0, distFromFocus - focusWidth * 0.5);

    // Gaussian-like falloff: blur grows with square of distance
    // The falloff parameter controls how spread out the transition is
    // Higher falloff = more gradual transition
    float sigma = max(0.01, falloff * 0.5 + 0.05);
    float gaussianFactor = 1.0 - exp(-(effectiveDist * effectiveDist) / (2.0 * sigma * sigma));

    // Apply an additional smoothing curve for even more organic feel
    // This makes the very beginning of the blur nearly imperceptible
    float smoothed = gaussianFactor * gaussianFactor * (3.0 - 2.0 * gaussianFactor);

    return smoothed;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    float blurFactor = getBlurFactor(vUv.y);
    float radius = blurFactor * blurAmount * 0.014;

    // If blur is negligible, mix with original based on opacity
    if (radius < 0.0002) {
      gl_FragColor = original;
      return;
    }

    // Disc blur via golden-angle spiral: circular bokeh-like defocus with no
    // directional streaking. Per-pixel rotation (interleaved gradient noise)
    // breaks the spiral's ring pattern into fine grain.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float rot = jitter * 6.2831853;
    float cr = cos(rot);
    float sr = sin(rot);

    // Aspect correction so the disc is circular in screen space, not UV space
    vec2 aspect = vec2(resolution.y / resolution.x, 1.0);

    vec4 sum = original;
    const float TAPS = 24.0;
    const float GOLDEN = 2.3999632;
    for (float i = 0.0; i < TAPS; i++) {
      // sqrt gives uniform area density across the disc
      float r = sqrt((i + 0.5) / TAPS) * radius;
      float theta = i * GOLDEN;
      vec2 dir = vec2(cos(theta), sin(theta));
      dir = vec2(dir.x * cr - dir.y * sr, dir.x * sr + dir.y * cr);
      sum += texture2D(tDiffuse, vUv + dir * r * aspect);
    }
    sum /= TAPS + 1.0;

    // Mix between original and effect based on opacity
    gl_FragColor = mix(original, sum, opacity);
  }
`;

export const sepiaFragmentShader = `
  uniform float amount;
  uniform float opacity;
  uniform sampler2D tDiffuse;

  varying vec2 vUv;

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    vec3 c = color.rgb;

    // Sepia color matrix
    vec3 sepia;
    sepia.r = dot(c, vec3(1.0 - 0.607 * amount, 0.769 * amount, 0.189 * amount));
    sepia.g = dot(c, vec3(0.349 * amount, 1.0 - 0.314 * amount, 0.168 * amount));
    sepia.b = dot(c, vec3(0.272 * amount, 0.534 * amount, 1.0 - 0.869 * amount));

    // Clamp to prevent over-saturation
    sepia = min(vec3(1.0), sepia);

    // Mix between original and sepia based on opacity
    gl_FragColor = vec4(mix(color.rgb, sepia, opacity), color.a);
  }
`;

export const bleachBypassFragmentShader = `
  uniform float amount;
  uniform float opacity;
  uniform sampler2D tDiffuse;

  varying vec2 vUv;

  // Calculate luminance using standard weights
  float getLuminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);

    // Get luminance as the blend layer
    float lum = getLuminance(base.rgb);
    vec3 blend = vec3(lum);

    // Calculate blend factor based on luminance
    // This creates the characteristic contrasty look
    float L = min(1.0, max(0.0, 10.0 * (lum - 0.45)));

    // Blend modes: multiply for darks, screen for lights
    vec3 result1 = 2.0 * base.rgb * blend;
    vec3 result2 = 1.0 - 2.0 * (1.0 - blend) * (1.0 - base.rgb);

    // Mix between the two blend modes
    vec3 newColor = mix(result1, result2, L);

    // Apply amount (how much of the effect to apply)
    float A2 = amount * base.a;
    vec3 bleached = A2 * newColor.rgb + (1.0 - A2) * base.rgb;

    // Mix between original and bleached based on opacity
    gl_FragColor = vec4(mix(base.rgb, bleached, opacity), base.a);
  }
`;

export const crtFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform float curvature;
  uniform float scanlineIntensity;
  uniform float rgbOffset;
  uniform float vignette;
  uniform vec2 resolution;
  uniform float opacity;

  varying vec2 vUv;

  // Apply CRT screen curvature
  vec2 curveUV(vec2 uv) {
    vec2 centered = uv * 2.0 - 1.0;

    // Apply barrel distortion for curved screen effect
    float r2 = centered.x * centered.x + centered.y * centered.y;
    centered *= 1.0 + curvature * r2;

    return centered * 0.5 + 0.5;
  }

  void main() {
    vec4 original = texture2D(tDiffuse, vUv);

    // Apply screen curvature
    vec2 curvedUV = curveUV(vUv);

    // Check if we're outside the curved screen area
    if (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0) {
      gl_FragColor = mix(original, vec4(0.0, 0.0, 0.0, 1.0), opacity);
      return;
    }

    // Sample with RGB offset for chromatic aberration
    float r = texture2D(tDiffuse, curvedUV + vec2(rgbOffset, 0.0)).r;
    float g = texture2D(tDiffuse, curvedUV).g;
    float b = texture2D(tDiffuse, curvedUV - vec2(rgbOffset, 0.0)).b;

    vec3 color = vec3(r, g, b);

    // Apply scanlines
    float scanline = sin(curvedUV.y * resolution.y * 3.14159) * 0.5 + 0.5;
    scanline = pow(scanline, 1.5);
    color *= 1.0 - scanlineIntensity * (1.0 - scanline);

    // Apply vignette (darken edges)
    vec2 vignetteUV = curvedUV * 2.0 - 1.0;
    float vignetteAmount = 1.0 - dot(vignetteUV, vignetteUV) * vignette;
    vignetteAmount = clamp(vignetteAmount, 0.0, 1.0);
    color *= vignetteAmount;

    // Slight brightness boost to compensate for scanlines
    color *= 1.0 + scanlineIntensity * 0.2;

    gl_FragColor = mix(original, vec4(color, 1.0), opacity);
  }
`;

export const asciiFragmentShader = `
  // Samples per axis when averaging a cell (NxN box filter). A single center
  // sample flickers as the scene moves; averaging the cell stabilises it.
  #define ASCII_CELL_SAMPLES 3

  uniform sampler2D tDiffuse;
  uniform sampler2D uAtlas;
  uniform vec2 resolution;
  uniform float dprScale;
  uniform float cellSize;
  uniform float glyphCount;
  uniform int colorModeInt;
  uniform vec3 monoColor;
  uniform float opacity;

  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    // Grid in reference-DPR pixels, so a cell keeps its apparent size on
    // displays with a different device pixel ratio.
    vec2 gridRes = resolution * dprScale;
    vec2 pixel = vUv * gridRes;
    vec2 cell = floor(pixel / cellSize);
    vec2 frac = fract(pixel / cellSize);

    // Average the whole cell rather than a single center texel, so the glyph
    // tracks the cell's overall brightness and changes smoothly as the
    // visualizer moves, instead of snapping when features cross the sample point.
    vec3 cellColor = vec3(0.0);
    for (int sy = 0; sy < ASCII_CELL_SAMPLES; sy++) {
      for (int sx = 0; sx < ASCII_CELL_SAMPLES; sx++) {
        vec2 off = (vec2(float(sx), float(sy)) + 0.5) / float(ASCII_CELL_SAMPLES);
        cellColor += texture2D(tDiffuse, (cell + off) * cellSize / gridRes).rgb;
      }
    }
    cellColor /= float(ASCII_CELL_SAMPLES * ASCII_CELL_SAMPLES);

    float l = luma(cellColor);
    float gi = floor(clamp(l, 0.0, 0.999) * glyphCount);

    vec2 atlasUv = vec2((gi + frac.x) / glyphCount, 1.0 - frac.y);
    float glyph = texture2D(uAtlas, atlasUv).r;

    vec3 base = colorModeInt == 1 ? monoColor : cellColor;
    vec3 ascii = base * glyph;

    vec4 original = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(mix(original.rgb, ascii, opacity), original.a);
  }
`;

export const ledScreenFragmentShader = `
  // Samples per axis when averaging a cell (NxN box filter). A single center
  // sample flickers as the scene moves; averaging the cell stabilises it.
  #define LED_CELL_SAMPLES 3
  // Neighbor cells (per side) contributing glow bleed.
  #define LED_GLOW_SPAN 2

  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float dprScale;
  uniform float cellSize;
  uniform float dotSize;
  uniform float softness;
  uniform float glow;
  uniform float glowRadius;
  uniform float panelGlow;
  uniform vec3 tint;
  uniform float tintAmount;
  uniform float opacity;

  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  // Soft-edged disc in cell-local units (cell spans 1.0, center at 0).
  float dotMask(vec2 local, float radius, float soft) {
    float edge = max(radius * soft, 0.01);
    return 1.0 - smoothstep(radius - edge, radius, length(local));
  }

  void main() {
    // Grid in reference-DPR pixels, so a cell keeps its apparent size on
    // displays with a different device pixel ratio.
    vec2 gridRes = resolution * dprScale;
    vec2 pixel = vUv * gridRes;
    vec2 cell = floor(pixel / cellSize);
    vec2 local = fract(pixel / cellSize) - 0.5;

    vec3 cellColor = vec3(0.0);
    for (int sy = 0; sy < LED_CELL_SAMPLES; sy++) {
      for (int sx = 0; sx < LED_CELL_SAMPLES; sx++) {
        vec2 off = (vec2(float(sx), float(sy)) + 0.5) / float(LED_CELL_SAMPLES);
        cellColor += texture2D(tDiffuse, (cell + off) * cellSize / gridRes).rgb;
      }
    }
    cellColor /= float(LED_CELL_SAMPLES * LED_CELL_SAMPLES);
    float l = luma(cellColor);

    // Lit LED: grows and sharpens with luminance; near-black cells stay off
    // so the unlit panel grid shows through instead of dim noise.
    float radius = 0.5 * dotSize * mix(0.3, 0.95, smoothstep(0.0, 1.0, l));
    float lit = dotMask(local, radius, softness) * smoothstep(0.02, 0.12, l);
    vec3 led = cellColor * lit * (0.7 + 0.6 * l);

    // Unlit panel: every cell carries a faint small dot, the detail that
    // makes the effect read as a physical screen rather than a halftone.
    float panelMask = dotMask(local, 0.5 * dotSize * 0.4, 0.6);
    led += mix(vec3(1.0), normalize(tint + 0.001) * 1.7, 0.6) * panelGlow * panelMask;

    // Glow bleed: bright neighbor cells halo across their gutters. One tap
    // per neighbor at its cell center, Gaussian falloff in cell units.
    vec3 glowAcc = vec3(0.0);
    float sigma2 = glowRadius * glowRadius;
    for (int dy = -LED_GLOW_SPAN; dy <= LED_GLOW_SPAN; dy++) {
      for (int dx = -LED_GLOW_SPAN; dx <= LED_GLOW_SPAN; dx++) {
        vec2 offset = vec2(float(dx), float(dy)) - local;
        vec3 nColor = texture2D(tDiffuse, (cell + vec2(float(dx), float(dy)) + 0.5) * cellSize / gridRes).rgb;
        float nl = luma(nColor);
        glowAcc += nColor * nl * exp(-dot(offset, offset) / sigma2);
      }
    }
    led += glowAcc * glow * 0.15;

    // Tint: colorize while preserving luminance (single-color LED panel).
    vec3 tinted = tint * (luma(led) / max(luma(tint), 0.001));
    led = mix(led, tinted, tintAmount);

    vec4 original = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(mix(original.rgb, led, opacity), original.a);
  }
`;


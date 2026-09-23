import * as THREE from 'three';

// Seeded three-dimensional wisps. Their world coordinates stay stable across
// seeks; the invisible ends of the volume hide particle recycling.
const PARTICLE_COUNT = 61440;
const STREAM_COUNT = 3;
const DEPTH = 5200;
const EMPTY_BANDS = new Float32Array(32);

function randomSequence(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const vertexShader = /* glsl */`
  attribute vec4 aParticle;
  attribute vec4 aStyle;
  uniform float uPhase;
  uniform float uRibbon;
  uniform float uDistance;
  uniform float uPixelRatio;
  uniform float uDensity;
  uniform float uBrightness;
  uniform float uWidth;
  uniform float uResponse;
  uniform float uBass;
  uniform float uMids;
  uniform float uHighs;
  uniform float uEnergy;
  uniform float uBreath;
  uniform float uLight;
  uniform float uLevels[32];
  uniform vec3 uLowColor;
  uniform vec3 uHighColor;
  varying vec3 vColor;
  varying float vFlux;
  varying float vMote;
  varying float vAngle;
  varying vec3 vWisp;
  varying vec3 vViewPosition;

  void main() {
    float river = aParticle.y;
    float seed = river * 2.39996 + 0.7;
    float travel = uDistance + uPhase * 9.0;
    float world = uRibbon > 0.5
      ? floor(travel / 32.5) * 32.5 + aParticle.x
      : aParticle.x + ceil((travel - aParticle.x) / 5200.0) * 5200.0;
    float depth = world - travel;
    float path = world * 0.00155;
    float flow = uPhase * 0.055;
    float cross = position.x;
    float layer = position.y;
    float branch = aParticle.z;

    float bass = smoothstep(0.12, 0.82, min(1.4, uBass * uResponse)) * 1.1;
    float mids = min(1.4, uMids * uResponse);
    float highs = min(1.4, uHighs * uResponse);
    float energy = min(1.4, uEnergy * uResponse);
    // Adjacent parts of a bank sample overlapping frequency regions; there are
    // no discrete spectral lanes to separate or vibrate against one another.
    float bandPosition = clamp(5.0 + river * 7.0 + cross * 3.5, 0.0, 30.99);
    int lowerBand = int(floor(bandPosition));
    int upperBand = int(min(31.0, floor(bandPosition) + 1.0));
    float voice = min(1.4, mix(uLevels[lowerBand], uLevels[upperBand],
      smoothstep(0.0, 1.0, fract(bandPosition))) * uResponse);

    // Three asymmetric courses leave an open central passage. Unequal bends
    // and thickness give each current a different silhouette and depth.
    vec2 centre = vec2(-290.0, -135.0);
    if (river > 0.5) centre = vec2(350.0, 185.0);
    if (river > 1.5) centre = vec2(260.0, 330.0);
    centre += vec2(sin(path * 0.83 + seed) * (145.0 + river * 27.0),
      cos(path * 0.57 + seed * 1.4) * (85.0 + river * 18.0));
    if (river > 1.5) centre += vec2(sin(path * 0.73 + 1.7) * 170.0,
      cos(path * 0.94 + 0.6) * 65.0);
    centre += vec2(sin(path * 1.31 + seed - flow),
      cos(path * 0.96 + seed + flow * 0.7)) * mids * 47.0;
    float angle = -0.42 + river * 0.49 + sin(path * 0.62 + seed) * 0.6;
    vec2 across = vec2(cos(angle), sin(angle));
    vec2 normal = vec2(-across.y, across.x);
    float opening = 0.55 + 0.45 * sin(path * 1.14 + seed);
    float width = (78.0 + river * 14.0 + opening * 78.0)
      * uWidth * (1.0 + bass * 0.46 + uBreath * 0.08);
    width *= river > 1.5 ? 0.53 : 1.0;
    float fold = sin(path * 1.88 + cross * 2.15 + seed - flow) * (24.0 + mids * 36.0)
      + sin(path * 3.43 - cross * 1.75 + seed + flow * 0.4) * 11.0
      + sin(path * 5.2 + seed + cross * 0.65 - flow * 0.4) * (18.0 + mids * 12.0);
    float thickness = (13.0 + opening * 18.0) * uWidth * (1.0 + bass * 0.24);
    // Sparse offshoots peel away along the same tangent, then settle back into
    // their bank. They are not independent random point clouds.
    float split = sin(path * 1.18 + seed + 0.7);
    float offshoot = branch * (30.0 + 90.0 * split * split) * uWidth;
    vec2 section = across * (cross * width + offshoot)
      + normal * (layer * thickness + fold + branch * 26.0 * sin(path * 1.9 + seed));
    vec3 p = vec3(centre + section, -depth - 3.0);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    float cameraDepth = max(1.0, -view.z);
    float perspective = clamp(820.0 / cameraDepth, 0.2, 4.0);
    float fade = smoothstep(28.0, 170.0, depth)
      * (1.0 - smoothstep(2850.0, 5100.0, depth));

    // Long, overlapping folds taper into thin edges and interrupted pockets.
    // A gentle ridged field adds filament detail without screen-space noise.
    float ridge = sin(path * 3.1 + cross * 4.1 + sin(path * 1.2 + seed) * 1.7);
    float filament = pow(0.5 + 0.5 * ridge, 2.0);
    float pocket = smoothstep(-0.7, 0.8,
      sin(path * 2.1 + cross * 1.4 + seed) + sin(path * 4.3 - cross * 2.1) * 0.35);
    float bank = exp(-cross * cross * 1.18 - layer * layer * 0.27);
    float structure = (0.08 + filament * 0.62) * (0.16 + pocket * 0.84) * bank;
    float highlight = pow(0.5 + 0.5 * sin(path * 4.6 + cross * 2.7 - flow * 5.5 + seed), 6.0);
    float illumination = 0.15 + uLight * (energy * 0.40 + voice * 0.51
      + highs * highlight * 0.42);
    float attenuation = min(1.4, pow(900.0 / max(180.0, depth), 1.55));
    vMote = step(0.91, aStyle.x);
    float softSize = (8.0 + aStyle.y * 10.0) * sqrt(perspective);
    float moteSize = (1.2 + aStyle.y * 1.8) * sqrt(perspective);
    gl_PointSize = clamp(mix(softSize, moteSize, vMote) * uPixelRatio,
      1.5, 28.0 * uPixelRatio);
    vFlux = illumination * structure * fade * attenuation * uBrightness
      * mix(0.06 + aStyle.z * 0.07, 0.24, vMote);
    vec3 cool = mix(uLowColor, vec3(0.17, 0.49, 0.76), 0.66);
    vec3 violet = vec3(0.45, 0.34, 0.73);
    cool = mix(cool, violet, smoothstep(0.5, 1.0, sin(path * 0.67 + seed))
      * (0.10 + uLight * energy * 0.17));
    vColor = mix(cool, uHighColor, min(0.68, 0.10 + vMote * 0.31
      + uLight * highs * highlight * 0.18));
    vAngle = angle + aStyle.w * 0.4;
    vWisp = vec3(path, cross, branch);
    vViewPosition = view.xyz;
    if (uRibbon > 0.5) {
      // The soft foundation joins nearby grains into a continuous luminous
      // fold. Its bank and individual fibres are shaded in the fragment stage.
      vFlux = fade * attenuation * uBrightness * pow(uDensity / 0.7, 0.65)
        * (0.05 + illumination * 0.31);
    }
    gl_Position = projectionMatrix * view;
    // Only points may be moved offscreen. Mesh triangles must retain their
    // real homogeneous coordinates so the GPU clips mixed front/behind
    // vertices at the near plane without creating stretched triangular fans.
    if (uRibbon < 0.5 && (view.z >= -0.1 || aParticle.w > uDensity)) {
      vFlux = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vColor;
  varying float vFlux;
  varying float vMote;
  varying float vAngle;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float c = cos(vAngle), s = sin(vAngle);
    vec2 q = mat2(c, -s, s, c) * p;
    q.y *= mix(1.55, 1.0, vMote);
    float radius2 = dot(q, q);
    float soft = exp(-radius2 * mix(3.8, 7.0, vMote));
    float edge = 1.0 - smoothstep(0.55, 1.0, dot(p, p));
    float light = soft * edge * vFlux;
    if (light < 0.000025) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
  }
`;

// A transparent, ridged density field supplies the fine continuous fibres that
// points alone cannot resolve without looking like confetti at full HD. Each
// bank is a folded 3D surface with a tapered, broken boundary, never a solid tube.
const ribbonFragment = /* glsl */`
  uniform float uPhase;
  uniform float uEnergy;
  uniform float uHighs;
  uniform float uLight;
  varying vec3 vColor;
  varying float vFlux;
  varying vec3 vWisp;
  varying vec3 vViewPosition;
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
      mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + 1.0), f.x), f.y);
  }
  void main() {
    float path = vWisp.x;
    float across = vWisp.y;
    float branch = vWisp.z;
    vec2 field = vec2(path * 1.85, across * 1.8);
    float broad = noise(field + vec2(13.7, 2.6));
    float curl = sin(path * 1.8 + broad * 3.8) * 0.23;
    vec2 uv = vec2(path * 6.2, (across + curl) * 4.5);
    float folds = noise(uv) * 0.58 + noise(uv * 2.13 + 8.4) * 0.28
      + noise(uv * 4.17 + 3.1) * 0.14;
    float bank = exp(-pow((across + curl * 0.55) / (0.46 + broad * 0.29), 2.0) * 1.9);
    float interruptions = smoothstep(0.26, 0.72, broad);
    // The body is patchy smoke, not contours of a noise field: contour ridges
    // make diamond lattices when several folds overlap in perspective.
    float smoke = smoothstep(0.27, 0.77, folds);
    float detail = noise(uv * 6.7 + vec2(folds * 3.0, broad * 4.0));
    float corePath = sin(path * 2.37 + broad * 1.6) * 0.19
      + cos(path * 1.14 + 1.2) * 0.10;
    float coreWidth = 0.018 + noise(vec2(path * 3.7, 8.9)) * 0.028;
    float fibre = exp(-pow((across - corePath) / coreWidth, 2.0));
    float sisterPath = corePath + 0.20 + sin(path * 1.83 + 2.4) * 0.11;
    float sister = exp(-pow((across - sisterPath) / (coreWidth * 0.68), 2.0))
      * smoothstep(0.36, 0.74, noise(vec2(path * 4.1, 21.7))) * 0.45;
    float strandTaper = smoothstep(0.25, 0.69, noise(vec2(path * 2.3, 6.4)));
    float strands = (fibre + sister) * strandTaper;
    float density = bank * interruptions * (0.045 + smoke * (0.68 + detail * 0.18))
      + strands * 0.26;
    density *= mix(1.0, 0.30, abs(branch));
    float traveling = pow(0.5 + 0.5 * sin(path * 4.6 + across * 2.7
      - uPhase * 0.29), 8.0);
    float peak = smoothstep(0.18, 0.74, uEnergy) * uLight;
    vec3 violet = vec3(0.43, 0.24, 0.82);
    float violetPocket = smoothstep(0.55, 0.86, noise(vec2(path * 1.8, 13.2)));
    vec3 color = mix(vColor, violet, violetPocket * (0.16 + peak * 0.57));
    color = mix(color, vec3(0.74, 0.88, 1.0),
      min(0.85, strands * (0.24 + peak * 0.70) + traveling * uHighs * uLight * 0.24));
    // A gauzy bank has no solid silhouette. Grazing surface folds dissolve
    // into their neighbouring offset layer instead of creating a razor edge.
    vec3 surfaceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    float facing = abs(dot(surfaceNormal, normalize(-vViewPosition)));
    float softFold = smoothstep(0.015, 0.23, facing);
    float flux = vFlux * density * softFold * (1.0 + traveling * uHighs * uLight * 0.7);
    if (flux < 0.000025) discard;
    gl_FragColor = vec4(color * flux, 1.0);
  }
`;

function createWispFoundation(uniforms) {
  const positions = [], particles = [], styles = [], indices = [];
  const columns = 17, rows = 161;
  for (let river = 0; river < STREAM_COUNT; river++) {
    for (let sheet = 0; sheet < 3; sheet++) {
      const start = positions.length / 3;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const cross = (column / (columns - 1) - 0.5) * 4.2;
          const branch = sheet === 2 ? (river === 1 ? -1 : 1) : 0;
          positions.push(cross * (sheet === 2 ? 0.62 : 1), sheet === 0 ? -0.38 : 0.38, 0);
          particles.push(row * 32.5, river, branch, 0);
          styles.push(0.3, 0.5, 0.5, 0.5);
          if (row < rows - 1 && column < columns - 1) {
            const a = start + row * columns + column;
            indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aParticle', new THREE.Float32BufferAttribute(particles, 4));
  geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(styles, 4));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uRibbon: { value: 1 } }, vertexShader, fragmentShader: ribbonFragment,
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    depthWrite: false, depthTest: true, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Deep Drift · continuous wisp fibres';
  mesh.userData.wispDepthStep = 32.5;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return { mesh, geometry, material };
}

/** Coherent organic wisps, exclusive to Deep Drift's foreground. */
export function createDustRivers({ scene, settings }) {
  const random = randomSequence(0x4d3f8201);
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const particles = new Float32Array(PARTICLE_COUNT * 4);
  const styles = new Float32Array(PARTICLE_COUNT * 4);
  for (let index = 0; index < PARTICLE_COUNT; index++) {
    const offset = index * 4;
    const radius = Math.min(2.8, Math.sqrt(-2 * Math.log(Math.max(0.005, random()))));
    const angle = random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius * 0.72;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
    particles[offset] = random() * DEPTH;
    particles[offset + 1] = index % STREAM_COUNT;
    particles[offset + 2] = random() > 0.85 ? (random() > 0.5 ? 1 : -1) : 0;
    particles[offset + 3] = random();
    styles[offset] = random();
    styles[offset + 1] = random();
    styles[offset + 2] = random();
    styles[offset + 3] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aParticle', new THREE.BufferAttribute(particles, 4));
  geometry.setAttribute('aStyle', new THREE.BufferAttribute(styles, 4));
  const uniforms = {
    uRibbon: { value: 0 }, uPhase: { value: 0 }, uDistance: { value: 0 }, uPixelRatio: { value: 1 },
    uDensity: { value: 0.7 }, uBrightness: { value: 1 }, uWidth: { value: 1 },
    uResponse: { value: 1 }, uLight: { value: 1 },
    uBass: { value: 0 }, uMids: { value: 0 }, uHighs: { value: 0 },
    uEnergy: { value: 0 }, uBreath: { value: 0 }, uLevels: { value: new Float32Array(32) },
    uLowColor: { value: new THREE.Color(settings.colorLow || '#527fa7') },
    uHighColor: { value: new THREE.Color(settings.colorHigh || '#e5efff') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, toneMapped: false,
  });
  const dust = new THREE.Points(geometry, material);
  dust.name = 'Deep Drift · organic dust wisps';
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  const foundation = createWispFoundation(uniforms);
  scene.add(foundation.mesh, dust);
  let lowColor = settings.colorLow;
  let highColor = settings.colorHigh;
  let time = 0;
  let phaseOffset = 0;
  let flowRate = Math.max(0, Number(settings.dustFlow ?? 1));
  const numericKeys = ['uPhase', 'uDistance', 'uBass', 'uMids', 'uHighs', 'uEnergy', 'uBreath', 'uLight'];

  function applySettings() {
    dust.visible = settings.dustRivers !== false;
    foundation.mesh.visible = dust.visible;
    uniforms.uDensity.value = Math.max(0, Math.min(1, Number(settings.dustDensity ?? 0.7)));
    uniforms.uBrightness.value = Math.max(0, Number(settings.dustBrightness ?? 1));
    uniforms.uWidth.value = Math.max(0.15, Number(settings.dustWidth ?? 1));
    uniforms.uResponse.value = Math.max(0, Number(settings.dustResponse ?? 1));
    const nextFlow = Math.max(0, Number(settings.dustFlow ?? 1));
    if (nextFlow !== flowRate) {
      phaseOffset += time * (flowRate - nextFlow);
      flowRate = nextFlow;
    }
    if (lowColor !== settings.colorLow) {
      lowColor = settings.colorLow;
      uniforms.uLowColor.value.set(lowColor || '#527fa7');
    }
    if (highColor !== settings.colorHigh) {
      highColor = settings.colorHigh;
      uniforms.uHighColor.value.set(highColor || '#e5efff');
    }
  }
  function present({ time: nextTime = 0, distance = 0, features = {}, light = 1 } = {}) {
    time = nextTime;
    applySettings();
    uniforms.uPhase.value = time * flowRate + phaseOffset;
    uniforms.uDistance.value = distance;
    uniforms.uBass.value = features.bass || 0;
    uniforms.uMids.value = features.mids || 0;
    uniforms.uHighs.value = features.highs || 0;
    uniforms.uEnergy.value = features.energy || 0;
    uniforms.uBreath.value = features.breath || 0;
    uniforms.uLight.value = Math.max(0, Math.min(1, light));
    uniforms.uLevels.value.set(features.levels || EMPTY_BANDS);
  }
  applySettings();

  return {
    update: present,
    present,
    resize(_width, _height, dpr = 1) { uniforms.uPixelRatio.value = dpr; },
    reset({ preserveFlow = false } = {}) {
      for (const key of numericKeys) uniforms[key].value = 0;
      uniforms.uLight.value = 1;
      uniforms.uLevels.value.fill(0);
      time = 0;
      if (!preserveFlow) {
        phaseOffset = 0;
        flowRate = Math.max(0, Number(settings.dustFlow ?? 1));
      }
    },
    saveState() {
      const state = { time, phaseOffset, flowRate, levels: Array.from(uniforms.uLevels.value) };
      for (const key of numericKeys) state[key] = uniforms[key].value;
      return state;
    },
    restoreState(saved) {
      if (!saved) return;
      time = saved.time ?? 0;
      phaseOffset = saved.phaseOffset ?? 0;
      flowRate = saved.flowRate ?? Math.max(0, Number(settings.dustFlow ?? 1));
      for (const key of numericKeys) uniforms[key].value = saved[key] ?? (key === 'uLight' ? 1 : 0);
      uniforms.uLevels.value.set(saved.levels || EMPTY_BANDS);
      applySettings();
      uniforms.uPhase.value = time * flowRate + phaseOffset;
    },
    getStats() {
      return {
        dustParticles: Math.round(PARTICLE_COUNT * uniforms.uDensity.value),
        dustStreams: STREAM_COUNT,
        dustActive: dust.visible,
        dustDrawCalls: dust.visible ? 2 : 0,
        dustPhase: uniforms.uPhase.value,
        dustExcitation: Math.max(uniforms.uBass.value, uniforms.uMids.value, uniforms.uHighs.value)
          * uniforms.uResponse.value,
      };
    },
    dispose() {
      scene.remove(dust, foundation.mesh);
      geometry.dispose(); material.dispose();
      foundation.geometry.dispose(); foundation.material.dispose();
    },
  };
}

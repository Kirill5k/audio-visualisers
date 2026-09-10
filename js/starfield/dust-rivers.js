import * as THREE from 'three';

// These are real particles in two broad 3D dust currents. The sheets are evaluated
// from an absolute world coordinate, so a seek visits exactly the same space.
const PARTICLE_COUNT = 98304;
const STREAM_COUNT = 2;
const SPECTRAL_ZONES = 8;
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
  uniform float uTime;
  uniform float uDistance;
  uniform float uPixelRatio;
  uniform float uDensity;
  uniform float uBrightness;
  uniform float uWidth;
  uniform float uFlow;
  uniform float uResponse;
  uniform float uBass;
  uniform float uMids;
  uniform float uHighs;
  uniform float uEnergy;
  uniform float uLevels[32];
  uniform vec3 uLowColor;
  uniform vec3 uHighColor;
  varying vec3 vColor;
  varying float vFlux;
  varying float vCore;
  varying float vSize;

  void main() {
    float river = aParticle.y;
    float lane = aParticle.z;
    float phase = river * 1.6180339 + 0.7;
    // Each particle follows the same world-space flow sheet as its neighbours.
    // Only the unseen depth wrap changes its identity; fade at both ends hides
    // the recycling boundary. Flow remains continuous at every camera angle.
    float travel = uDistance + uTime * uFlow * 11.0;
    float world = aParticle.x + ceil((travel - aParticle.x) / 5200.0) * 5200.0;
    float depth = world - travel;
    float path = world * 0.0012;
    float transverse = position.x;
    vec2 centre = mix(vec2(-85.0, -145.0), vec2(160.0, 290.0), river);
    centre += vec2(sin(path * 0.67 + phase) * 135.0,
      cos(path * 0.81 + phase * 1.7) * 115.0);
    // Each current is a broad, folded volume with continuously populated width.
    // It has no narrow cylindrical centre, helical strand or terminal knot.
    float orientation = -0.42 + river * 0.18 + sin(path * 0.46 + phase) * 0.14;
    vec2 across = vec2(cos(orientation), sin(orientation));
    vec2 normal = vec2(-across.y, across.x);
    float pocket = 0.5 + 0.5 * sin(path * 1.31 + transverse * 3.8 + phase);
    float spread = (780.0 + river * 170.0) * (0.83 + pocket * 0.24);

    int band = int(mod(river * 17.0 + lane * 2.0 + 3.0, 32.0));
    float voice = min(1.25, uLevels[band] * uResponse);
    float bass = min(1.4, uBass * uResponse);
    float mids = min(1.4, uMids * uResponse);
    float highs = min(1.4, uHighs * uResponse);
    float energy = min(1.4, uEnergy * uResponse);
    // Bass opens the volume; mids bend broad spectral regions independently.
    // The transverse term makes several tributaries curl within the current,
    // without collapsing the field into a set of isolated luminous pipes.
    float width = uWidth * (0.88 + bass * 0.34);
    float wave = path * 1.63 + transverse * 3.1 - uTime * uFlow * 0.22 + phase;
    float fold = sin(path * 1.27 + transverse * 4.2 + phase) * (42.0 + pocket * 46.0)
      + sin(path * 2.41 - transverse * 2.9 + phase) * 25.0;
    fold += sin(wave) * (mids * 52.0 + voice * 25.0);
    // Treble makes small travelling transverse ripples; individual grains keep
    // their stable offset in the stream, with no randomized screen-space jitter.
    float ripple = sin(world * 0.025 + transverse * 19.0 - uTime * uFlow * 1.15 + phase);
    fold += ripple * highs * (6.0 + pocket * 8.0);
    float thickness = (24.0 + pocket * 59.0 + aStyle.z * 22.0) * (1.0 + bass * 0.65);
    vec2 crossSection = across * transverse * spread * width
      + normal * (fold + position.y * thickness * width);
    vec3 p = vec3(centre + crossSection, -depth - 3.0);
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    float distanceToCamera = max(1.0, -view.z);
    float perspective = clamp(720.0 / distanceToCamera, 0.35, 3.8);
    float fade = smoothstep(12.0, 105.0, depth) * (1.0 - smoothstep(3000.0, 5150.0, depth));
    // The bright travelling packets are shaped by actual spectral energy. At
    // silence only faint dust remains; the rhythmic deformation settles to zero.
    float packet = pow(0.5 + 0.5 * sin(world * 0.014 + transverse * 9.0
      - uTime * uFlow * 1.5 + phase), 5.0);
    float light = 0.085 + voice * 0.78 + energy * 0.20 + highs * packet * 0.65;
    // Spatial density pockets interrupt the wisps into tributaries and leave
    // darker gaps. Their coordinates belong to the volume, never the screen.
    float curl = sin(path * 2.18 + transverse * 7.3 + sin(path * 0.71 - transverse * 3.0));
    float filaments = pow(1.0 - abs(curl), 1.7);
    float interruptions = smoothstep(-0.72, 0.63,
      sin(path * 3.83 + transverse * 5.7) * cos(path * 1.29 - transverse * 8.1 + phase));
    float structure = 0.14 + filaments * (0.30 + interruptions * 0.86);
    float softBank = 1.0 - smoothstep(0.68, 1.0, abs(transverse));
    float variation = 0.3 + pow(aStyle.x, 2.8) * 1.5;
    vCore = (0.23 + aStyle.x * 0.15 + voice * 0.06) * uPixelRatio * sqrt(perspective);
    gl_PointSize = clamp(vCore * 6.5, 2.0, 9.0 * uPixelRatio);
    vSize = gl_PointSize;
    // Perspective compresses progressively more grains into each far pixel.
    // Distance attenuation prevents that accumulation from making a bright cap
    // at the far end. The distant river disperses softly into the nebula while
    // nearby grains remain individually legible, without a depth-of-field blur.
    float attenuation = min(1.5, pow(780.0 / max(120.0, depth), 1.8));
    vFlux = light * variation * fade * uBrightness * attenuation * structure * softBank * 3.1;
    // A cool luminous weave distinguishes the dust from neutral stars. Sparse
    // warm grains retain a natural mix without turning the stream into a tube.
    vec3 cool = mix(uLowColor, vec3(0.30, 0.71, 0.91), 0.46);
    vColor = mix(cool, uHighColor, 0.12 + aStyle.y * 0.25 + voice * 0.1);
    vColor = mix(vColor, vec3(0.87, 0.68, 0.37), step(0.94, aStyle.y) * 0.38);
    gl_Position = projectionMatrix * view;
    if (view.z >= -0.1 || aParticle.w > uDensity) {
      vFlux = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vColor;
  varying float vFlux;
  varying float vCore;
  varying float vSize;
  void main() {
    float radius = length((gl_PointCoord - 0.5) * vSize);
    float aa = max(0.42, fwidth(radius) * 0.58);
    float core = 1.0 - smoothstep(max(0.0, vCore - aa), vCore + aa, radius);
    float halo = exp(-radius / max(0.25, vCore * 1.2)) * 0.018;
    float edge = 1.0 - smoothstep(vSize * 0.38, vSize * 0.5, radius);
    float light = (core + halo) * vFlux * edge;
    if (light < 0.00008) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
  }
`;

/** Fine spectral dust streams, exclusive to Deep Drift's foreground. */
export function createDustRivers({ scene, settings }) {
  const random = randomSequence(0x4d3f8201);
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const particles = new Float32Array(PARTICLE_COUNT * 4);
  const styles = new Float32Array(PARTICLE_COUNT * 4);
  for (let index = 0; index < PARTICLE_COUNT; index++) {
    const offset = index * 4;
    // Uniform transverse coverage produces a broad volume. Only its thickness
    // uses a truncated Gaussian; spectral zones meet without geometric seams.
    const radius = Math.min(3.1, Math.sqrt(-2 * Math.log(Math.max(0.005, random()))));
    const angle = random() * Math.PI * 2;
    const zone = Math.floor(index / STREAM_COUNT) % SPECTRAL_ZONES;
    positions[index * 3] = ((zone + random()) / SPECTRAL_ZONES) * 2 - 1;
    positions[index * 3 + 1] = Math.sin(angle) * radius;
    particles[offset] = random() * DEPTH;
    particles[offset + 1] = index % STREAM_COUNT;
    particles[offset + 2] = zone;
    particles[offset + 3] = random();
    styles[offset] = random();
    styles[offset + 1] = random();
    styles[offset + 2] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aParticle', new THREE.BufferAttribute(particles, 4));
  geometry.setAttribute('aStyle', new THREE.BufferAttribute(styles, 4));
  const uniforms = {
    uTime: { value: 0 }, uDistance: { value: 0 }, uPixelRatio: { value: 1 },
    uDensity: { value: 0.7 }, uBrightness: { value: 1 }, uWidth: { value: 1 },
    uFlow: { value: 1 }, uResponse: { value: 1 },
    uBass: { value: 0 }, uMids: { value: 0 }, uHighs: { value: 0 }, uEnergy: { value: 0 },
    uLevels: { value: new Float32Array(32) },
    uLowColor: { value: new THREE.Color(settings.colorLow || '#527fa7') },
    uHighColor: { value: new THREE.Color(settings.colorHigh || '#e5efff') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true, toneMapped: false,
  });
  const dust = new THREE.Points(geometry, material);
  dust.name = 'Deep Drift · spectral dust rivers';
  dust.frustumCulled = false;
  dust.renderOrder = 1;
  scene.add(dust);
  let lowColor = settings.colorLow;
  let highColor = settings.colorHigh;

  const numericKeys = ['uTime', 'uDistance', 'uBass', 'uMids', 'uHighs', 'uEnergy'];
  function applySettings() {
    dust.visible = settings.dustRivers !== false;
    uniforms.uDensity.value = Math.max(0, Math.min(1, Number(settings.dustDensity ?? 0.7)));
    uniforms.uBrightness.value = Math.max(0, Number(settings.dustBrightness ?? 1));
    uniforms.uWidth.value = Math.max(0.15, Number(settings.dustWidth ?? 1));
    uniforms.uFlow.value = Math.max(0, Number(settings.dustFlow ?? 1));
    uniforms.uResponse.value = Math.max(0, Number(settings.dustResponse ?? 1));
    if (lowColor !== settings.colorLow) {
      lowColor = settings.colorLow;
      uniforms.uLowColor.value.set(lowColor || '#527fa7');
    }
    if (highColor !== settings.colorHigh) {
      highColor = settings.colorHigh;
      uniforms.uHighColor.value.set(highColor || '#e5efff');
    }
  }
  applySettings();

  return {
    update({ time = 0, frame, distance = 0, features = {}, playing = false } = {}) {
      // Pausing advances the app's presentation clock to let light decay. Flow
      // follows the fixed audio frame instead, so resume cannot rewind particles.
      uniforms.uTime.value = Number.isFinite(frame) ? frame / 60 : time;
      uniforms.uDistance.value = distance;
      const active = playing && (features.rms ?? 0) > 0.00001;
      uniforms.uBass.value = active ? (features.bass || 0) : 0;
      uniforms.uMids.value = active ? (features.mids || 0) : 0;
      uniforms.uHighs.value = active ? (features.highs || 0) : 0;
      uniforms.uEnergy.value = active ? (features.energy || 0) : 0;
      uniforms.uLevels.value.set(active ? (features.levels || EMPTY_BANDS) : EMPTY_BANDS);
      applySettings();
    },
    resize(_width, _height, dpr = 1) { uniforms.uPixelRatio.value = dpr; },
    reset() {
      for (const key of numericKeys) uniforms[key].value = 0;
      uniforms.uLevels.value.fill(0);
    },
    saveState() {
      const state = { levels: Array.from(uniforms.uLevels.value) };
      for (const key of numericKeys) state[key] = uniforms[key].value;
      return state;
    },
    restoreState(saved) {
      if (!saved) return;
      for (const key of numericKeys) uniforms[key].value = saved[key] ?? 0;
      uniforms.uLevels.value.set(saved.levels || EMPTY_BANDS);
      applySettings();
    },
    getStats() {
      return {
        dustParticles: Math.round(PARTICLE_COUNT * uniforms.uDensity.value),
        dustStreams: STREAM_COUNT,
        dustActive: dust.visible,
        dustExcitation: Math.max(uniforms.uBass.value, uniforms.uMids.value, uniforms.uHighs.value)
          * uniforms.uResponse.value,
      };
    },
    dispose() { scene.remove(dust); geometry.dispose(); material.dispose(); },
  };
}

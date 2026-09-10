import * as THREE from 'three';
import { createNebulaActivity, MAX_NEBULA_WAVES } from './nebula-activity.js';
import { createDustRivers } from './dust-rivers.js';

// The volume is shared with Living Constellations. Translation is evaluated from
// absolute travel distance, so seeking and offline rendering need no simulation.
const STAR_COUNT = 131072;
const DEPTH = 2600;
const EMPTY_BANDS = new Float32Array(32);
const MAX_LIGHT_EVENTS = 6;

function frameHash(value) {
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// A seamless, deterministic density map, built once. Fine cloud detail is stored
// separately from absorption; no screen-space grain or animated noise is used.
function createNebulaTexture() {
  const width = 2048;
  const height = 1024;
  const data = new Uint8Array(width * height * 4);
  const random = seededRandom(0x57a4f13);
  const grids = [];
  for (let octave = 0; octave < 9; octave++) {
    const size = 4 << octave;
    const values = new Float32Array(size * (size / 2 + 1));
    for (let i = 0; i < values.length; i++) values[i] = random();
    grids.push({ size, values });
  }
  const smooth = t => t * t * (3 - 2 * t);
  function noise(u, v, octave) {
    const { size, values } = grids[octave];
    const x = ((u % 1 + 1) % 1) * size;
    const y = Math.max(0, Math.min(0.999999, v)) * (size / 2);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const nx = (ix + 1) % size;
    const a = values[iy * size + ix];
    const b = values[iy * size + nx];
    const c = values[(iy + 1) * size + ix];
    const d = values[(iy + 1) * size + nx];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const bend = noise(u, v, 0) - 0.5;
      const shear = (noise(u + 0.37, v, 1) - 0.5) * 0.1;
      const uWarp = u + bend * 0.095 + (noise(u, v, 2) - 0.5) * 0.022;
      const vWarp = v + shear + (noise(u, v, 3) - 0.5) * 0.019;
      let fractal = 0;
      let amplitude = 0.27;
      let weight = 0;
      for (let octave = 2; octave < 9; octave++) {
        fractal += noise(uWarp, vWarp, octave) * amplitude;
        weight += amplitude;
        amplitude *= 0.72;
      }
      fractal /= weight;
      const latitude = 0.5 + 0.13 * Math.sin(u * Math.PI * 2 + 0.8)
        + 0.035 * Math.sin(u * Math.PI * 6 - 0.5);
      const envelope = Math.exp(-Math.pow((v - latitude) / 0.075, 2));
      const ridge = Math.max(0, (fractal - 0.38) * 4.0);
      const cloud = Math.min(1, Math.pow(ridge, 1.5) * envelope);
      // Ridged, sheared turbulence supplies branching absorption lanes at three
      // distinct scales. Fine curls survive the broad envelope instead of being
      // averaged away into smooth, repetitive clouds.
      const dustLarge = 1 - Math.abs(noise(uWarp + 0.07, vWarp, 2) * 2 - 1);
      const dustMedium = 1 - Math.abs(noise(uWarp + shear * 0.7, vWarp, 4) * 2 - 1);
      const dustFine = noise(uWarp, vWarp, 7);
      const dust = Math.min(1, Math.pow(dustLarge * 0.58 + dustMedium * 0.42, 4) * 1.65
        + Math.max(0, dustFine - 0.57) * 0.5);
      const filamentRidge = Math.pow(Math.max(0, 1 - Math.abs(fractal - 0.56) * 19), 2);
      const filament = Math.min(1, filamentRidge * (0.35 + noise(uWarp, vWarp, 6) * 0.65));
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(cloud * 255);
      data[offset + 1] = Math.round(filament * cloud * 255);
      data[offset + 2] = Math.round(dust * 255);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// The same smooth coordinate deformation is used for cloud emission and stellar
// extinction. Dust lanes therefore continue to obscure the correct distant
// stars as the gas opens and curls. Detail comes from the original texture;
// there is no temporal feedback, grain, or smoothing of the resulting image.
const nebulaMotion = /* glsl */`
  uniform float uMotionTime;
  uniform float uBreath;
  uniform float uBreathDepth;
  uniform float uBreathSpeed;
  uniform float uTurbulence;
  vec2 cloudCoordinates(vec2 uv) {
    float phase = uMotionTime * 0.31 * uBreathSpeed;
    vec2 curl = vec2(
      sin(uv.y * 27.0 + sin(uv.x * 18.849556 - phase) * 1.45),
      cos(uv.x * 25.132741 + sin(uv.y * 18.0 + phase) * 1.2)
    );
    vec2 ripples = vec2(sin(uv.y * 61.0 - phase * 2.7),
      cos(uv.x * 56.548668 + phase * 2.2));
    float polarFade = smoothstep(0.03, 0.2, uv.y) * (1.0 - smoothstep(0.8, 0.97, uv.y));
    return uv + (curl * uBreath * 0.013 + ripples * uTurbulence * 0.0018)
      * uBreathDepth * polarFade;
  }
`;

const starVertex = /* glsl */`
  ${nebulaMotion}
  attribute vec4 aStyle;
  attribute vec2 aFrequency;
  uniform float uDistance;
  uniform float uDensity;
  uniform float uPixelRatio;
  uniform float uStarSize;
  uniform float uBrightness;
  uniform float uGain;
  uniform float uPulse;
  uniform float uBass;
  uniform float uHighs;
  uniform float uKick;
  uniform float uPlaying;
  uniform float uDeepDynamics;
  uniform vec4 uLightEvents[6];
  uniform float uEventStrength[6];
  uniform float uLevels[32];
  uniform float uOnsets[32];
  uniform sampler2D uSpectrum;
  uniform sampler2D uCloud;
  uniform vec3 uLowColor;
  uniform vec3 uHighColor;
  varying vec3 vColor;
  varying float vFlux;
  varying float vCore;
  varying float vSize;
  varying float vSpikes;

  void main() {
    vec3 p = position;
    p.z = -mod(-position.z - uDistance, 2600.0) - 3.0;
    vec4 view = modelViewMatrix * vec4(p, 1.0);
    float depth = max(1.0, -view.z);
    float wrapFade = smoothstep(3.0, 28.0, -p.z)
      * (1.0 - smoothstep(2500.0, 2600.0, -p.z));
    float density = step(aStyle.w, uDensity);
    int band = int(aFrequency.y);
    float bin = aFrequency.x;
    vec2 spectrumUv = vec2(mod(bin, 256.0) + 0.5, floor(bin / 256.0) + 0.5)
      / vec2(256.0, 64.0);
    float frequency = texture2D(uSpectrum, spectrumUv).r * uPlaying * uGain;
    float attack = uOnsets[band];
    float sustained = uLevels[band];
    // Neighbouring world cells share an attack band. This produces local groups
    // illuminating together rather than an indiscriminate full-screen flash.
    vec3 cell = position / vec3(210.0, 170.0, 360.0);
    float cellHash = fract(sin(dot(floor(cell), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float bassGroup = step(0.81, cellHash);
    vec3 local = fract(cell) - 0.5;
    float cluster = exp(-dot(local, local) * 8.0);
    float cohort = step(0.65, aStyle.z) * step(0.70, cellHash) * cluster;
    float nearWeight = 0.35 + 0.65 * (1.0 - smoothstep(200.0, 1800.0, -p.z));
    // Feature envelopes have already received the user's gain in the app. Only
    // the raw FFT sample above needs gain here. Limit excitation to star groups
    // so unaffected space stays dark through even the loudest musical attacks.
    float reaction = min(2.7, (attack * 2.4 + frequency * 0.3 + sustained * 0.2
      + (uKick * 2.9 + uBass * 0.25) * bassGroup * nearWeight) * cohort * uPulse);
    float burst = 0.0;
    if (uDeepDynamics > 0.5) {
      for (int i = 0; i < 6; i++) {
        vec3 localOffset = (p - uLightEvents[i].xyz) / max(1.0, uLightEvents[i].w);
        // A stellar neighbourhood, with a smooth falloff in real world space.
        // Every illuminated point remains an actual moving star in the field.
        burst += exp(-dot(localOffset, localOffset) * 2.2) * uEventStrength[i];
      }
    }
    float proximity = clamp(650.0 / depth, 0.45, 3.2);
    float prominent = smoothstep(0.98, 1.0, aStyle.x);
    float hero = smoothstep(0.9975, 1.0, aStyle.x);
    float core = (0.29 + prominent * 0.67 + hero * 0.35 + min(0.8, burst * 0.6)) * uPixelRatio * uStarSize
      * sqrt(proximity) * (1.0 + min(0.18, reaction * 0.07));
    float haloSize = mix(4.5, 13.0, hero);
    gl_PointSize = clamp(core * haloSize, 2.0, 38.0 * uPixelRatio);
    vSize = gl_PointSize;
    vCore = core;
    vSpikes = hero * 0.65;
    float luminosity = 0.0006 + pow(aStyle.x, 9.0) * 0.022
      + prominent * prominent * 0.62 + hero * 0.65;
    vec3 direction = normalize(p);
    vec2 skyUv = vec2(fract(atan(direction.z, -direction.x) / 6.2831853 + 1.0),
      0.5 + asin(direction.y) / 3.14159265);
    vec3 dust = texture2D(uCloud, cloudCoordinates(skyUv)).rgb;
    float extinction = mix(1.0, exp(-dust.b * dust.r * 7.0), smoothstep(900.0, 2350.0, -p.z));
    float excitation = reaction * (0.12 + pow(aStyle.x, 3.0) * 0.42)
      + burst * (0.62 + pow(aStyle.x, 3.0) * 1.25);
    vFlux = min(1.75 + min(0.6, burst * 0.35), luminosity + excitation) * wrapFade * density * uBrightness
      * extinction * mix(0.65, 1.1, proximity / 3.2);
    vec3 stellarColor = mix(uLowColor, uHighColor, 0.3 + aStyle.y * 0.66);
    stellarColor = mix(stellarColor, vec3(1.0, 0.67, 0.36),
      step(0.96, aStyle.z) * 0.44);
    vColor = mix(stellarColor, vec3(1.0), min(0.16, reaction * 0.06));
    gl_Position = projectionMatrix * view;
    if (view.z >= -0.1 || density < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const starFragment = /* glsl */`
  varying vec3 vColor;
  varying float vFlux;
  varying float vCore;
  varying float vSize;
  varying float vSpikes;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * vSize;
    float radius = length(p);
    float aa = max(0.45, fwidth(radius) * 0.65);
    float core = 1.0 - smoothstep(max(0.0, vCore - aa), vCore + aa, radius);
    float halo = exp(-radius / max(0.4, vCore * 1.45)) * 0.035;
    float horizontal = exp(-abs(p.y) / max(0.22, vCore * 0.19))
      * exp(-abs(p.x) / max(0.5, vCore * 2.8));
    float vertical = exp(-abs(p.x) / max(0.22, vCore * 0.19))
      * exp(-abs(p.y) / max(0.5, vCore * 2.8));
    float diffraction = (horizontal + vertical) * vSpikes * 0.12;
    float edge = 1.0 - smoothstep(vSize * 0.4, vSize * 0.5, radius);
    float light = (core + halo + diffraction) * vFlux * edge;
    if (light < 0.00012) discard;
    gl_FragColor = vec4(vColor * light, 1.0);
  }
`;

const nebulaVertex = /* glsl */`
  varying vec2 vUv;
  varying vec3 vDirection;
  void main() {
    vUv = uv;
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nebulaFragment = /* glsl */`
  ${nebulaMotion}
  uniform sampler2D uCloud;
  uniform float uNebula;
  uniform float uGain;
  uniform float uMids;
  uniform float uKick;
  uniform float uDeepDynamics;
  uniform vec4 uLightEvents[6];
  uniform float uEventStrength[6];
  uniform vec4 uWaveOrigins[6];
  uniform float uWaveStrength[6];
  uniform float uWaveWidth;
  uniform float uLevels[32];
  uniform float uOnsets[32];
  uniform vec3 uLowColor;
  varying vec2 vUv;
  varying vec3 vDirection;
  void main() {
    vec3 cloud = texture2D(uCloud, cloudCoordinates(vUv)).rgb;
    vec3 d = normalize(vDirection);
    float absorption = exp(-cloud.b * 3.1);
    float density = cloud.r * absorption;
    float filament = cloud.g * absorption;
    // Spatially overlapping emissive pockets avoid revealing the analysis grid.
    float pocketA = pow(max(0.0, dot(d, normalize(vec3(-0.7, 0.22, -1.0)))), 18.0);
    float pocketB = pow(max(0.0, dot(d, normalize(vec3(0.85, -0.25, -1.0)))), 24.0);
    float pocketC = pow(max(0.0, dot(d, normalize(vec3(0.18, 0.52, -1.0)))), 35.0);
    float illumination = min(1.25, pocketA * (uLevels[10] * 0.6 + uOnsets[10] * 0.9)
      + pocketB * (uLevels[18] * 0.7 + uOnsets[18] * 0.9)
      + pocketC * (uMids * 0.65 + uKick * 0.5));
    vec3 blue = mix(vec3(0.023, 0.073, 0.155), uLowColor * 0.32, 0.35);
    vec3 violet = vec3(0.072, 0.034, 0.105);
    vec3 gas = mix(blue, violet, smoothstep(0.3, 0.9, cloud.b) * 0.35);
    vec3 color = gas * density * (0.75 + illumination * 0.95)
      + vec3(0.052, 0.13, 0.23) * filament * (0.36 + illumination * 0.75);
    if (uDeepDynamics > 0.5) {
      float burstEmission = 0.0;
      for (int i = 0; i < 6; i++) {
        vec3 pocketDirection = normalize(uLightEvents[i].xyz + vec3(0.0, 0.0, -0.001));
        float pocket = pow(max(0.0, dot(d, pocketDirection)), 95.0);
        burstEmission += pocket * uEventStrength[i];
      }
      // Only existing emission filaments light up; the surrounding black sky
      // stays black. These accents share the stars' real musical event envelope.
      color += vec3(0.072, 0.21, 0.43) * (filament * 2.5 + density * 0.22) * burstEmission;
      float waveEmission = 0.0;
      for (int i = 0; i < 6; i++) {
        // A wave crosses the curved cloud surface at a finite speed. Absorption
        // and density bend the front and delay its arrival through deeper gas;
        // filaments break it into luminous arcs instead of a screen-space ring.
        vec3 fromOrigin = d - uWaveOrigins[i].xyz;
        float curvedDistance = length(fromOrigin * vec3(1.0, 1.13, 1.0));
        curvedDistance += (cloud.b - 0.5) * 0.052 + (1.0 - cloud.r) * 0.028;
        float width = 0.015 * uWaveWidth + fwidth(curvedDistance) * 1.1;
        float frontDistance = curvedDistance - uWaveOrigins[i].w;
        float front = exp(-pow(frontDistance / width, 2.0));
        // A fainter wake sits behind the sharp arrival rather than blurring it.
        float wake = exp(-pow((frontDistance + width * 2.0) / (width * 2.7), 2.0)) * 0.19;
        waveEmission += (front + wake) * uWaveStrength[i];
      }
      color += vec3(0.115, 0.37, 0.67) * (filament * 2.7 + density * 0.32)
        * min(2.4, waveEmission);
    }
    // A minute blue-black floor retains clean blacks without a gradient band.
    gl_FragColor = vec4(vec3(0.00013, 0.00022, 0.00042) + color * uNebula, 1.0);
  }
`;

export function createDeepDrift({ scene, camera, spectrumTexture, settings }) {
  const random = seededRandom(0xdecafbad);
  const positions = new Float32Array(STAR_COUNT * 3);
  const styles = new Float32Array(STAR_COUNT * 4);
  const frequencies = new Float32Array(STAR_COUNT * 2);
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (random() - 0.5) * 3000;
    const y = (random() - 0.5) * 2200;
    const z = -random() * DEPTH;
    positions.set([x, y, z], i * 3);
    styles.set([random(), random(), random(), random()], i * 4);
    // 25% linear samples ensure every part of the complete 16,384-bin spectrum
    // contributes; the remainder follows human logarithmic pitch perception.
    const bin = i % 4 === 0 ? (i / 4) % 16384 : Math.floor(Math.exp(random() * Math.log(16384)) - 1);
    const cellX = Math.floor(x / 210);
    const cellY = Math.floor(y / 170);
    const cellZ = Math.floor(z / 360);
    const band = ((cellX * 13 + cellY * 7 + cellZ * 19) % 32 + 32) % 32;
    frequencies.set([bin, band], i * 2);
  }
  const uniforms = {
    uDistance: { value: 0 },
    uDensity: { value: 1 },
    uPixelRatio: { value: 1 },
    uStarSize: { value: 1 },
    uBrightness: { value: 1 },
    uGain: { value: 1.25 },
    uPulse: { value: 1.3 },
    uBass: { value: 0 },
    uHighs: { value: 0 },
    uMids: { value: 0 },
    uKick: { value: 0 },
    uPlaying: { value: 0 },
    uDeepDynamics: { value: settings.backgroundOnly ? 0 : 1 },
    uLightEvents: { value: Array.from({ length: MAX_LIGHT_EVENTS }, () => new THREE.Vector4(0, 0, -1000, 1)) },
    uEventStrength: { value: new Float32Array(MAX_LIGHT_EVENTS) },
    uMotionTime: { value: 0 },
    uBreath: { value: 0 },
    uBreathDepth: { value: 1 },
    uBreathSpeed: { value: 1 },
    uTurbulence: { value: 0 },
    uWaveOrigins: { value: Array.from({ length: MAX_NEBULA_WAVES }, () => new THREE.Vector4(0, 0, -1, 0)) },
    uWaveStrength: { value: new Float32Array(MAX_NEBULA_WAVES) },
    uWaveWidth: { value: 1 },
    uNebula: { value: 1 },
    uLevels: { value: new Float32Array(32) },
    uOnsets: { value: new Float32Array(32) },
    uSpectrum: { value: spectrumTexture },
    uCloud: { value: createNebulaTexture() },
    uLowColor: { value: new THREE.Color(settings.colorLow || '#527fa7') },
    uHighColor: { value: new THREE.Color(settings.colorHigh || '#e5efff') },
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aStyle', new THREE.BufferAttribute(styles, 4));
  geometry.setAttribute('aFrequency', new THREE.BufferAttribute(frequencies, 2));
  const starMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: starVertex,
    fragmentShader: starFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(geometry, starMaterial);
  stars.name = 'Deep Drift · 131,072 spectral stars';
  stars.frustumCulled = false;
  stars.renderOrder = 1;
  const skyGeometry = new THREE.SphereGeometry(4200, 64, 32);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: nebulaVertex,
    fragmentShader: nebulaFragment,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.name = 'Deep Drift · interstellar dust and emission';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky, stars);
  const dustRivers = settings.backgroundOnly ? null : createDustRivers({ scene, camera, settings });
  let state = { time: 0, distance: 0 };
  let events = [];
  let lastEventFrame = -1000;
  let lastProcessedFrame = -1;
  const heldOnsets = new Float32Array(32);
  const projected = new THREE.Vector3();
  const projection = new THREE.Matrix4();
  let lowColor = settings.colorLow;
  let highColor = settings.colorHigh;
  const nebulaActivity = createNebulaActivity(settings, (frame, band) => {
    const star = chooseVisibleAnchor(frame + 197, band + 7, state.distance);
    if (star < 0) return null;
    const offset = star * 3;
    const z = -(((-positions[offset + 2] - state.distance) % DEPTH + DEPTH) % DEPTH) - 3;
    return [positions[offset], positions[offset + 1], z];
  });

  function uploadNebulaActivity(activity) {
    uniforms.uMotionTime.value = activity.time;
    uniforms.uBreath.value = activity.breath;
    uniforms.uTurbulence.value = activity.turbulence;
    uniforms.uBreathDepth.value = Math.max(0, Number(settings.breathDepth ?? 1));
    uniforms.uBreathSpeed.value = Math.max(0.1, Number(settings.breathSpeed ?? 1));
    uniforms.uWaveWidth.value = Math.max(0.25, Number(settings.waveWidth ?? 1));
    uniforms.uWaveStrength.value.fill(0);
    for (let i = 0; i < activity.waves.length; i++) {
      const wave = activity.waves[i];
      uniforms.uWaveOrigins.value[i].set(...wave.origin, wave.radius);
      uniforms.uWaveStrength.value[i] = wave.intensity;
    }
  }

  function chooseVisibleAnchor(frame, band, distance) {
    camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const targetX = (frameHash(frame * 137 + band * 29 + 43) - 0.5) * 1.38;
    const targetY = (frameHash(frame * 73 + band * 91 + 257) - 0.5) * 1.25;
    let chosen = -1;
    let score = Infinity;
    // A fixed sparse catalogue is sufficient to find a real visible star without
    // projecting the full 131k-star volume on the CPU.
    for (let candidate = 0; candidate < 1024; candidate++) {
      const index = (candidate * 127 + 43) % STAR_COUNT;
      const offset = index * 3;
      const z = -(((-positions[offset + 2] - distance) % DEPTH + DEPTH) % DEPTH) - 3;
      if (z > -280 || z < -2100) continue;
      projected.set(positions[offset], positions[offset + 1], z).applyMatrix4(projection);
      if (Math.abs(projected.x) > 0.88 || Math.abs(projected.y) > 0.83 || projected.z < -1 || projected.z > 1) continue;
      const candidateScore = (projected.x - targetX) ** 2 + (projected.y - targetY) ** 2;
      if (candidateScore < score) { score = candidateScore; chosen = index; }
    }
    return chosen;
  }

  function uploadEvents(time, distance) {
    uniforms.uEventStrength.value.fill(0);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const offset = event.star * 3;
      const z = -(((-positions[offset + 2] - distance) % DEPTH + DEPTH) % DEPTH) - 3;
      const age = Math.max(0, time - event.born);
      const envelope = Math.min(1, age / 0.035) * Math.exp(-Math.max(0, age - 0.07) / 0.20);
      uniforms.uLightEvents.value[i].set(positions[offset], positions[offset + 1], z, event.radius);
      uniforms.uEventStrength.value[i] = envelope * event.strength;
    }
  }

  function updateActivity({ time, delta, distance, features, frame, playing }) {
    const active = !settings.backgroundOnly;
    uniforms.uDeepDynamics.value = active ? 1 : 0;
    if (!active) return;
    const decay = Math.exp(-Math.max(0, delta) / 0.26);
    let strongest = 0;
    let strongestBand = 0;
    for (let band = 0; band < 32; band++) {
      const onset = playing ? (features.onsets?.[band] || 0) : 0;
      const held = Math.max(onset, heldOnsets[band] * decay);
      heldOnsets[band] = held > 0.002 ? held : 0;
      if (onset > strongest) { strongest = onset; strongestBand = band; }
    }
    events = events.filter(event => time >= event.born && time - event.born < 0.85);
    // Births require an actual detected spectral attack. The finite event lifetime
    // and envelope cutoff fit comfortably inside the app's 8-second seek rebuild.
    if (playing && frame !== lastProcessedFrame && Math.floor(frame / 6) !== Math.floor(lastEventFrame / 6)
      && strongest > 0.065 && (features.rms || 0) > 0.00001) {
      const star = chooseVisibleAnchor(frame, strongestBand, distance);
      if (star >= 0) {
        const z = -(((-positions[star * 3 + 2] - distance) % DEPTH + DEPTH) % DEPTH) - 3;
        events.push({
          star, born: time, frame, band: strongestBand,
          radius: Math.max(105, Math.min(225, -z * 0.15)),
          strength: Math.min(2.15, (0.72 + strongest * 2.0 + (features.energy || 0) * 0.45)
            * Number(settings.pulse ?? 1.3)),
        });
        if (events.length > MAX_LIGHT_EVENTS) events.shift();
        lastEventFrame = frame;
      }
    }
    if (playing) lastProcessedFrame = frame;
    uniforms.uOnsets.value.set(heldOnsets);
    uploadEvents(time, distance);
  }

  function reset() {
    dustRivers?.reset();
    state = { time: 0, distance: 0 };
    events = [];
    lastEventFrame = -1000;
    lastProcessedFrame = -1;
    heldOnsets.fill(0);
    uniforms.uEventStrength.value.fill(0);
    nebulaActivity.reset();
    uploadNebulaActivity(nebulaActivity.sample());
    uniforms.uDistance.value = 0;
    uniforms.uLevels.value.fill(0);
    uniforms.uOnsets.value.fill(0);
    for (const key of ['uBass', 'uHighs', 'uMids', 'uKick', 'uPlaying']) uniforms[key].value = 0;
  }

  return {
    update({ time = 0, delta = 1 / 60, distance = 0, features = {}, frame = Math.round(time * 60), playing = false }) {
      dustRivers?.update({ time, delta, distance, features, frame, playing });
      state.time = time;
      state.distance = distance;
      const background = settings.backgroundOnly ? 0.76 : 1;
      uniforms.uDistance.value = distance;
      uniforms.uDensity.value = Math.max(0, Math.min(1, Number(settings.density ?? 1)));
      uniforms.uBrightness.value = Number(settings.brightness ?? 1) * background;
      uniforms.uStarSize.value = Number(settings.starSize ?? 1);
      uniforms.uGain.value = Number(settings.gain ?? 1.25);
      uniforms.uPulse.value = Number(settings.pulse ?? 1.3);
      uniforms.uNebula.value = Number(settings.nebula ?? 1) * (settings.backgroundOnly ? 0.65 : 1);
      uniforms.uPlaying.value = playing ? 1 : 0;
      uniforms.uLevels.value.set(playing ? (features.levels || EMPTY_BANDS) : EMPTY_BANDS);
      uniforms.uOnsets.value.set(playing ? (features.onsets || EMPTY_BANDS) : EMPTY_BANDS);
      uniforms.uBass.value = playing ? (features.bass || 0) : 0;
      uniforms.uHighs.value = playing ? (features.highs || 0) : 0;
      uniforms.uMids.value = playing ? (features.mids || 0) : 0;
      uniforms.uKick.value = playing ? (features.kick || 0) : 0;
      updateActivity({ time, delta, distance, features, frame, playing });
      uploadNebulaActivity(nebulaActivity.update({ time, frame, features, playing }));
      if (lowColor !== settings.colorLow) {
        lowColor = settings.colorLow;
        uniforms.uLowColor.value.set(lowColor || '#527fa7');
      }
      if (highColor !== settings.colorHigh) {
        highColor = settings.colorHigh;
        uniforms.uHighColor.value.set(highColor || '#e5efff');
      }
      sky.position.copy(camera.position);
    },
    resize(_width, _height, dpr = 1) {
      uniforms.uPixelRatio.value = dpr;
      dustRivers?.resize(_width, _height, dpr);
    },
    reset,
    saveState() {
      const featureUniforms = {};
      for (const key of ['uPlaying', 'uBass', 'uHighs', 'uMids', 'uKick']) featureUniforms[key] = uniforms[key].value;
      return {
        ...state, events: events.map(event => ({ ...event })), lastEventFrame, lastProcessedFrame,
        heldOnsets: Array.from(heldOnsets),
        levels: Array.from(uniforms.uLevels.value), onsets: Array.from(uniforms.uOnsets.value),
        featureUniforms,
        nebulaActivity: nebulaActivity.saveState(),
        dustRivers: dustRivers?.saveState() ?? null,
      };
    },
    restoreState(saved) {
      if (!saved) return;
      dustRivers?.restoreState(saved.dustRivers);
      state = { time: saved.time, distance: saved.distance };
      events = (saved.events || []).map(event => ({ ...event }));
      lastEventFrame = saved.lastEventFrame ?? -1000;
      lastProcessedFrame = saved.lastProcessedFrame ?? -1;
      heldOnsets.set(saved.heldOnsets || EMPTY_BANDS);
      uniforms.uLevels.value.set(saved.levels || EMPTY_BANDS);
      uniforms.uOnsets.value.set(saved.onsets || EMPTY_BANDS);
      for (const [key, value] of Object.entries(saved.featureUniforms || {})) uniforms[key].value = value;
      uniforms.uDistance.value = state.distance;
      uploadEvents(state.time, state.distance);
      nebulaActivity.restoreState(saved.nebulaActivity);
      uploadNebulaActivity(nebulaActivity.sample());
    },
    getStats() {
      return {
        stars: STAR_COUNT,
        visibleDensity: uniforms.uDensity.value,
        spectrumBins: 16384,
        volumeDepth: DEPTH,
        drawCalls: 2 + (dustRivers?.getStats().dustActive ? 1 : 0),
        ...dustRivers?.getStats(),
        distance: state.distance,
        activeLightEvents: events.length,
        peakLight: Math.max(...uniforms.uEventStrength.value),
        activeWavefronts: nebulaActivity.sample().waves.length,
        peakWavefront: Math.max(...uniforms.uWaveStrength.value),
        nebulaBreath: uniforms.uBreath.value,
      };
    },
    dispose() {
      dustRivers?.dispose();
      scene.remove(stars, sky);
      geometry.dispose();
      starMaterial.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      uniforms.uCloud.value.dispose();
    },
  };
}

import * as THREE from 'three';
import { createDeepDrift } from './deep-drift-scene.js';
import { ConstellationNetwork, CONSTELLATION_MAX_LINKS } from './constellation-network.js';

const lineVertex = /* glsl */ `
  attribute vec3 endpointA;
  attribute vec3 endpointB;
  attribute vec4 linkStyle;
  uniform vec2 resolution;
  uniform float pixelRatio;
  varying vec2 vUv;
  varying vec4 vStyle;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(endpointA, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(endpointB, 1.0);
    vec2 ndcA = a.xy / max(a.w, 0.001);
    vec2 ndcB = b.xy / max(b.w, 0.001);
    vec2 direction = (ndcB - ndcA) * resolution;
    float lengthPx = length(direction);
    vec2 normal = vec2(-direction.y, direction.x) / max(lengthPx, 0.001);
    vec4 clip = mix(a, b, position.x);
    clip.xy += normal * position.y * 4.0 * pixelRatio * 2.0 / resolution * clip.w;
    gl_Position = clip;
    vUv = position.xy;
    vStyle = linkStyle;
    if (a.w < 1.0 || b.w < 1.0 || lengthPx < 0.05) vStyle.x = 0.0;
  }
`;
const lineFragment = /* glsl */ `
  uniform vec3 connectionColor;
  uniform float strength;
  varying vec2 vUv;
  varying vec4 vStyle;
  void main() {
    float side = abs(vUv.y) * 4.0;
    float core = exp(-side * side / 0.36);
    float halo = exp(-side * side / 3.3) * 0.07;
    float draw = 1.0 - smoothstep(vStyle.y - 0.018, vStyle.y, vUv.x);
    float pulse = exp(-pow((vUv.x - vStyle.z) * 22.0, 2.0));
    float endFade = smoothstep(0.0, 0.016, vUv.x) * (1.0 - smoothstep(0.984, 1.0, vUv.x));
    float intensity = (core + halo) * draw * endFade * vStyle.x * strength;
    vec3 color = mix(connectionColor, vec3(1.0, 0.96, 0.82), 0.15 + pulse * 0.5);
    gl_FragColor = vec4(color * (0.85 + pulse * 1.0 + vStyle.w * 0.2), intensity);
  }
`;
const nodeVertex = /* glsl */ `
  attribute float nodeLight;
  attribute float nodeFade;
  attribute float starSeed;
  uniform float pixelRatio;
  uniform float starSize;
  uniform float brightness;
  varying float vLight;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    float perspectiveScale = clamp(1250.0 / max(50.0, -view.z), 0.75, 2.0);
    gl_PointSize = (6.0 + nodeLight * 15.0) * pixelRatio * starSize * perspectiveScale;
    vLight = nodeLight * brightness;
    vFade = nodeFade * step(1.0, -view.z);
    vSeed = starSeed;
  }
`;
const nodeFragment = /* glsl */ `
  uniform vec3 connectionColor;
  varying float vLight;
  varying float vFade;
  varying float vSeed;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float r2 = dot(p, p);
    float core = exp(-r2 * (48.0 + vLight * 6.0));
    float glow = exp(-r2 * 8.5) * 0.14;
    float cross = (exp(-abs(p.x) * 110.0) * exp(-abs(p.y) * 7.0)
      + exp(-abs(p.y) * 110.0) * exp(-abs(p.x) * 7.0)) * 0.065;
    float energy = (core + (glow + cross) * vLight) * vFade;
    vec3 color = mix(vec3(0.65, 0.76, 0.98), connectionColor, min(1.0, vLight * 2.0));
    gl_FragColor = vec4(color * (0.28 + vLight * 5.5), energy);
  }
`;

export function createLivingConstellations({ scene, camera, spectrumTexture, settings }) {
  const backgroundSettings = { ...settings, backgroundOnly: true };
  const background = createDeepDrift({ scene, camera, spectrumTexture, settings: backgroundSettings });
  const network = new ConstellationNetwork();
  const visible = new Uint8Array(network.count);
  const projected = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const resolution = new THREE.Vector2(1920, 1080);
  const linkGeometry = new THREE.InstancedBufferGeometry();
  linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -1, 0, 1, -1, 0, 0, 1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0,
  ], 3));
  const starts = new THREE.InstancedBufferAttribute(new Float32Array(CONSTELLATION_MAX_LINKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const ends = new THREE.InstancedBufferAttribute(new Float32Array(CONSTELLATION_MAX_LINKS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const styles = new THREE.InstancedBufferAttribute(new Float32Array(CONSTELLATION_MAX_LINKS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  linkGeometry.setAttribute('endpointA', starts);
  linkGeometry.setAttribute('endpointB', ends);
  linkGeometry.setAttribute('linkStyle', styles);
  linkGeometry.instanceCount = 0;
  const lineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      resolution: { value: resolution }, pixelRatio: { value: 1 },
      connectionColor: { value: new THREE.Color(settings.connectionColor ?? '#e8d2a0') },
      strength: { value: settings.connectionStrength ?? 1 },
    },
    vertexShader: lineVertex, fragmentShader: lineFragment,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, toneMapped: true,
  });
  const lines = new THREE.Mesh(linkGeometry, lineMaterial);
  lines.frustumCulled = false;
  lines.renderOrder = 4;
  scene.add(lines);

  const nodeGeometry = new THREE.BufferGeometry();
  const nodePositions = new THREE.BufferAttribute(network.positions, 3).setUsage(THREE.DynamicDrawUsage);
  const nodeLights = new THREE.BufferAttribute(network.nodeLight, 1).setUsage(THREE.DynamicDrawUsage);
  const nodeFades = new THREE.BufferAttribute(network.fades, 1).setUsage(THREE.DynamicDrawUsage);
  nodeGeometry.setAttribute('position', nodePositions);
  nodeGeometry.setAttribute('nodeLight', nodeLights);
  nodeGeometry.setAttribute('nodeFade', nodeFades);
  nodeGeometry.setAttribute('starSeed', new THREE.Float32BufferAttribute(
    Float32Array.from({ length: network.count }, (_, i) => (i * 0.61803398875) % 1), 1));
  const nodeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      pixelRatio: { value: 1 }, starSize: { value: 1 }, brightness: { value: 1 },
      connectionColor: lineMaterial.uniforms.connectionColor,
    },
    vertexShader: nodeVertex, fragmentShader: nodeFragment,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, toneMapped: true,
  });
  const nodes = new THREE.Points(nodeGeometry, nodeMaterial);
  nodes.frustumCulled = false;
  nodes.renderOrder = 5;
  scene.add(nodes);
  let lastUpdate = null;

  function update(input) {
    const { time = 0, distance = 0, features = {} } = input;
    Object.assign(backgroundSettings, settings, { backgroundOnly: true });
    background.update(input);
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    network.updatePositions(distance);
    for (let i = 0; i < network.count; i++) {
      projected.fromArray(network.positions, i * 3).applyMatrix4(matrix);
      visible[i] = Math.abs(projected.x) < 0.92 && Math.abs(projected.y) < 0.9 && projected.z > -1 && projected.z < 1 ? 1 : 0;
    }
    const links = network.update({ ...input, settings, visible });
    // Keep the bounded event history independent of rendering capacity so seeking
    // reconstructs the same topology even in unusually dense musical passages.
    const renderedLinks = links.filter(link => link.alpha > 0.004)
      .sort((a, b) => b.alpha - a.alpha || a.key - b.key)
      .slice(0, CONSTELLATION_MAX_LINKS);
    const levels = features.levels ?? [];
    let count = 0;
    for (const link of renderedLinks) {
      const a = link.a * 3;
      const b = link.b * 3;
      starts.setXYZ(count, network.positions[a], network.positions[a + 1], network.positions[a + 2]);
      ends.setXYZ(count, network.positions[b], network.positions[b + 1], network.positions[b + 2]);
      const age = time - link.born - link.delay;
      const pulse = ((Math.max(0, age) * 0.85) % 1.35) - 0.15;
      styles.setXYZW(count, link.alpha, link.reveal, pulse, levels[link.band] ?? 0);
      count++;
    }
    linkGeometry.instanceCount = count;
    starts.needsUpdate = true;
    ends.needsUpdate = true;
    styles.needsUpdate = true;
    nodePositions.needsUpdate = true;
    nodeLights.needsUpdate = true;
    nodeFades.needsUpdate = true;
    lineMaterial.uniforms.connectionColor.value.set(settings.connectionColor ?? '#e8d2a0');
    lineMaterial.uniforms.strength.value = (settings.connectionStrength ?? 1) * (settings.brightness ?? 1);
    nodeMaterial.uniforms.starSize.value = settings.starSize ?? 1;
    nodeMaterial.uniforms.brightness.value = settings.brightness ?? 1;
    lastUpdate = { time, distance, frame: input.frame };
  }

  return {
    update,
    resize(width, height, dpr = 1) {
      background.resize(width, height, dpr);
      resolution.set(width * dpr, height * dpr);
      lineMaterial.uniforms.pixelRatio.value = dpr;
      nodeMaterial.uniforms.pixelRatio.value = dpr;
    },
    reset() { network.reset(); background.reset(); linkGeometry.instanceCount = 0; lastUpdate = null; },
    saveState() { return { network: network.saveState(), background: background.saveState(), lastUpdate }; },
    restoreState(saved) {
      if (!saved) return;
      background.restoreState(saved.background);
      network.restoreState(saved.network);
      lastUpdate = saved.lastUpdate;
    },
    dispose() {
      background.dispose();
      scene.remove(lines, nodes);
      linkGeometry.dispose(); lineMaterial.dispose(); nodeGeometry.dispose(); nodeMaterial.dispose();
    },
    getStats() { return { ...background.getStats(), ...network.getStats(), scene: 'Living Constellations' }; },
  };
}

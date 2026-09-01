/**
 * Shared monochrome chart panels for monitor-suite visualisers.
 */
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { bandEnergy, logBarIndices, barValues } from "./audio-analysis.js";

export const WORLD_WIDTH = 100;
const GUTTER = 0.35;

export function worldHeight(aspect) {
  return WORLD_WIDTH / aspect;
}

export function rectToWorld(rect, aspect, inset = GUTTER) {
  const h = worldHeight(aspect);
  const left = -WORLD_WIDTH / 2 + rect.x * WORLD_WIDTH + inset;
  const right = -WORLD_WIDTH / 2 + (rect.x + rect.w) * WORLD_WIDTH - inset;
  const top = h / 2 - rect.y * h - inset;
  const bottom = h / 2 - (rect.y + rect.h) * h + inset;
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: top - bottom,
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
  };
}

export function pixelRect(rect, width, height, insetPx = 1) {
  const x = Math.floor(rect.x * width) + insetPx;
  const y = Math.floor(rect.y * height) + insetPx;
  const w = Math.floor(rect.w * width) - insetPx * 2;
  const h = Math.floor(rect.h * height) - insetPx * 2;
  return { x, y, w, h };
}

function makeLineMaterial(resolution, opacity = 0.55, linewidth = 1) {
  return new LineMaterial({
    color: 0xffffff,
    linewidth,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    resolution,
  });
}

export function createPanelGrid(scene, panels, resolution, options = {}) {
  const gridOpacity = options.gridOpacity ?? 0.22;
  const frameOpacity = options.frameOpacity ?? 0.85;
  const gridCell = options.gridCell ?? 2.5;
  const frameMaterial = makeLineMaterial(resolution, frameOpacity, 1.4);
  const gridMaterial = makeLineMaterial(resolution, gridOpacity, 1);
  const frames = new Line2(new LineGeometry(), frameMaterial);
  const grid = new Line2(new LineGeometry(), gridMaterial);
  frames.frustumCulled = false;
  grid.frustumCulled = false;
  frames.renderOrder = 10;
  grid.renderOrder = 9;
  scene.add(grid, frames);

  function rebuild(aspect) {
    const framePts = [];
    const gridPts = [];

    for (const panel of panels) {
      const box = rectToWorld(panel, aspect, GUTTER * 0.65);
      framePts.push(
        box.left, box.top, 0, box.right, box.top, 0,
        box.right, box.top, 0, box.right, box.bottom, 0,
        box.right, box.bottom, 0, box.left, box.bottom, 0,
        box.left, box.bottom, 0, box.left, box.top, 0,
      );

      for (let x = box.left; x <= box.right + 1e-6; x += gridCell) {
        gridPts.push(x, box.bottom, 0, x, box.top, 0);
      }
      for (let y = box.bottom; y <= box.top + 1e-6; y += gridCell) {
        gridPts.push(box.left, y, 0, box.right, y, 0);
      }
    }

    frames.geometry.dispose();
    grid.geometry.dispose();
    frames.geometry = new LineGeometry().setPositions(framePts);
    grid.geometry = new LineGeometry().setPositions(gridPts);
    frames.computeLineDistances();
    grid.computeLineDistances();
  }

  return {
    frames,
    grid,
    rebuild,
    setOpacity(frame, gridOp) {
      frameMaterial.opacity = frame;
      gridMaterial.opacity = gridOp;
      frames.visible = frame > 0;
      grid.visible = gridOp > 0;
    },
    setResolution(width, height) {
      frameMaterial.resolution.set(width, height);
      gridMaterial.resolution.set(width, height);
    },
  };
}

export function createSpectrumChart(scene, rect, resolution, options = {}) {
  const barCount = options.barCount ?? 80;
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const bars = [];
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const zoneMaterial = makeLineMaterial(resolution, 0.18, 1);
  const zones = new Line2(new LineGeometry(), zoneMaterial);
  zones.frustumCulled = false;
  zones.renderOrder = 19;
  group.add(zones);

  const playheadMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
  });
  const playhead = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 1), playheadMat);
  playhead.renderOrder = 25;
  playhead.visible = false;
  group.add(playhead);

  for (let i = 0; i < barCount; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(barGeo, mat);
    mesh.renderOrder = 21;
    bars.push(mesh);
    group.add(mesh);
  }

  let barIndices = null;
  let layoutBox = null;
  let zoneHz = options.zoneHz || [120, 500, 2000, 6000];

  function layout(aspect, sampleRate, fftSize) {
    layoutBox = rectToWorld(rect, aspect);
    barIndices = logBarIndices(barCount, sampleRate || 48000, fftSize || 2048);
    const gap = layoutBox.width / barCount;
    const barW = gap * 0.72;

    for (let i = 0; i < barCount; i++) {
      const mesh = bars[i];
      mesh.scale.set(barW, layoutBox.height * 0.02, 1);
      mesh.position.set(
        layoutBox.left + gap * (i + 0.5),
        layoutBox.bottom + layoutBox.height * 0.01,
        0,
      );
    }

    const zonePts = [];
    for (const hz of zoneHz) {
      const t = (Math.log10(hz) - Math.log10(30)) / (Math.log10((sampleRate || 48000) / 2) - Math.log10(30));
      const x = layoutBox.left + layoutBox.width * Math.max(0, Math.min(1, t));
      zonePts.push(x, layoutBox.bottom, 0, x, layoutBox.top, 0);
    }
    zones.geometry.dispose();
    zones.geometry = new LineGeometry().setPositions(zonePts);
    zones.computeLineDistances();

    playhead.scale.set(0.12, layoutBox.height, 1);
    playhead.position.set(layoutBox.left, layoutBox.cy, 0);
  }

  function update({ frequencyData, gain = 1, progress = null, demoPhase = 0, demo = false }) {
    if (!layoutBox || !barIndices) return;
    const values = demo
      ? demoSpectrum(barCount, demoPhase)
      : barValues(frequencyData, barIndices).map((v) => Math.min(1, v * gain * 1.35));

    const gap = layoutBox.width / barCount;
    for (let i = 0; i < barCount; i++) {
      const h = Math.max(0.015, values[i] * layoutBox.height * 0.92);
      const mesh = bars[i];
      mesh.scale.y = h;
      mesh.position.y = layoutBox.bottom + h / 2;
      mesh.material.opacity = 0.35 + values[i] * 0.6;
    }

    if (progress != null) {
      playhead.visible = true;
      playhead.position.x = layoutBox.left + layoutBox.width * progress;
    } else {
      playhead.visible = false;
    }
  }

  return {
    group,
    layout,
    update,
    setResolution(width, height) {
      zoneMaterial.resolution.set(width, height);
    },
  };
}

function demoSpectrum(barCount, phase) {
  const values = new Float32Array(barCount);
  for (let i = 0; i < barCount; i++) {
    const t = i / barCount;
    values[i] = Math.max(0, Math.sin(t * 8 + phase * 2.2) * 0.25 + 0.35
      + Math.exp(-Math.pow((t - 0.15 - (phase * 0.03) % 0.5) / 0.08, 2)) * 0.5);
  }
  return values;
}

export function createStereoMeters(scene, rect, resolution) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const labels = ["Lpk", "Lrms", "Rpk", "Rrms"];
  const tracks = [];
  const peakHold = [0, 0, 0, 0];
  const trackMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    depthTest: false,
  });
  const holdMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    depthTest: false,
  });
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const holdGeo = new THREE.PlaneGeometry(1, 0.12);

  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(barGeo, trackMat.clone());
    const hold = new THREE.Mesh(holdGeo, holdMat.clone());
    bar.renderOrder = 22;
    hold.renderOrder = 23;
    group.add(bar, hold);
    tracks.push({ bar, hold, label: labels[i] });
  }

  let layoutBox = null;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    const gap = layoutBox.width / 5;
    const barW = gap * 0.55;
    for (let i = 0; i < 4; i++) {
      const x = layoutBox.left + gap * (i + 1);
      tracks[i].bar.scale.set(barW, layoutBox.height * 0.02, 1);
      tracks[i].bar.position.set(x, layoutBox.bottom, 0);
      tracks[i].hold.scale.set(barW, 0.12, 1);
      tracks[i].hold.position.set(x, layoutBox.bottom, 0);
    }
  }

  function update({ levels, decay = 0.96, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    const values = demo
      ? [
        0.35 + Math.sin(demoPhase * 3.1) * 0.2,
        0.22 + Math.sin(demoPhase * 2.4) * 0.1,
        0.34 + Math.sin(demoPhase * 3.3 + 0.4) * 0.2,
        0.2 + Math.sin(demoPhase * 2.1 + 0.2) * 0.1,
      ]
      : [levels.lPeak, levels.lRms, levels.rPeak, levels.rRms];

    for (let i = 0; i < 4; i++) {
      const v = Math.min(1, values[i] * 1.1);
      peakHold[i] = Math.max(v, peakHold[i] * decay);
      const h = Math.max(0.02, v * layoutBox.height * 0.94);
      const bar = tracks[i].bar;
      bar.scale.y = h;
      bar.position.y = layoutBox.bottom + h / 2;

      const holdY = layoutBox.bottom + peakHold[i] * layoutBox.height * 0.94;
      tracks[i].hold.position.y = holdY;
    }
  }

  function resetPeaks() {
    peakHold.fill(0);
  }

  return { group, layout, update, resetPeaks };
}

export function createWaveformMinimap(scene, rect) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const uniforms = {
    uPeaks: { value: null },
    uProgress: { value: 0 },
    uPlayedDim: { value: 0.28 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uPeaks;
      uniform float uProgress;
      uniform float uPlayedDim;
      varying vec2 vUv;

      void main() {
        float peak = texture2D(uPeaks, vec2(vUv.x, 0.5)).r;
        float envelope = peak * 0.92;
        float top = 0.5 + envelope * 0.46;
        float bottom = 0.5 - envelope * 0.46;
        float inside = step(bottom, vUv.y) * step(vUv.y, top);
        float played = step(vUv.x, uProgress);
        float fill = inside * mix(1.0, uPlayedDim, played);
        float edge = smoothstep(0.0, 0.004, abs(vUv.y - top)) + smoothstep(0.0, 0.004, abs(vUv.y - bottom));
        float outline = edge * (1.0 - played * 0.35);
        float color = max(fill, outline * 0.85);
        gl_FragColor = vec4(vec3(color), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 21;
  group.add(mesh);

  const playheadMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
  });
  const playhead = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), playheadMat);
  playhead.renderOrder = 24;
  group.add(playhead);

  const markerGroup = new THREE.Group();
  markerGroup.renderOrder = 23;
  group.add(markerGroup);
  const markerGeo = new THREE.BufferGeometry();
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });

  let peaksTexture = null;
  let layoutBox = null;
  let onsets = [];

  function setPeaks(peaks) {
    if (peaksTexture) peaksTexture.dispose();
    peaksTexture = new THREE.DataTexture(
      peaks,
      peaks.length,
      1,
      THREE.RedFormat,
      THREE.FloatType,
    );
    peaksTexture.minFilter = THREE.LinearFilter;
    peaksTexture.magFilter = THREE.LinearFilter;
    peaksTexture.needsUpdate = true;
    uniforms.uPeaks.value = peaksTexture;
  }

  function setOnsets(positions) {
    onsets = positions || [];
    rebuildMarkers();
  }

  function rebuildMarkers() {
    while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);
    if (!layoutBox) return;
    const size = Math.min(layoutBox.width * 0.006, 0.35);
    for (const t of onsets) {
      const verts = new Float32Array([
        -size, size * 0.6, 0,
        size, size * 0.6, 0,
        0, -size * 0.6, 0,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geo.setIndex([0, 1, 2]);
      const tri = new THREE.Mesh(geo, markerMat);
      tri.position.set(
        layoutBox.left + layoutBox.width * t,
        layoutBox.top + size * 0.4,
        0,
      );
      markerGroup.add(tri);
    }
  }

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    mesh.scale.set(layoutBox.width, layoutBox.height, 1);
    mesh.position.set(layoutBox.cx, layoutBox.cy, 0);
    playhead.scale.set(0.14, layoutBox.height, 1);
    playhead.position.set(layoutBox.left, layoutBox.cy, 0);
    rebuildMarkers();
  }

  function update({ progress = 0 }) {
    uniforms.uProgress.value = progress;
    if (layoutBox) {
      playhead.position.x = layoutBox.left + layoutBox.width * progress;
    }
  }

  function dispose() {
    if (peaksTexture) peaksTexture.dispose();
  }

  return { group, layout, setPeaks, setOnsets, update, dispose };
}

export function createViewport3D(options = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 4.2);

  const geometry = new THREE.IcosahedronGeometry(1.1, 4);
  const position = geometry.attributes.position;
  const base = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    base[i * 3] = position.getX(i);
    base[i * 3 + 1] = position.getY(i);
    base[i * 3 + 2] = position.getZ(i);
  }

  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
    }),
  );
  scene.add(wire);

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.035,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  scene.add(points);

  let rotation = 0;

  function update({ bandEnergies = [0, 0, 0, 0], delta = 0.016, demo = false, demoPhase = 0 }) {
    rotation += delta * (options.spinSpeed ?? 0.22);
    const energies = demo
      ? [
        0.3 + Math.sin(demoPhase * 2) * 0.2,
        0.25 + Math.sin(demoPhase * 2.7 + 1) * 0.15,
        0.2 + Math.sin(demoPhase * 3.4 + 2) * 0.12,
        0.15 + Math.sin(demoPhase * 4.1 + 3) * 0.1,
      ]
      : bandEnergies;

    for (let i = 0; i < position.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];
      const len = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const nx = bx / len;
      const ny = by / len;
      const nz = bz / len;
      const band =
        (Math.abs(ny) < 0.35 ? energies[0] : 0)
        + (Math.abs(nx) > 0.6 ? energies[1] : 0)
        + (Math.abs(nz) > 0.6 ? energies[2] : 0)
        + (ny > 0.35 ? energies[3] : 0);
      const disp = 1 + band * 0.55 + Math.sin(rotation * 2 + i * 0.2) * 0.03;
      position.setXYZ(i, nx * disp, ny * disp, nz * disp);
    }
    position.needsUpdate = true;
    wire.geometry.dispose();
    wire.geometry = new THREE.WireframeGeometry(geometry);
    points.rotation.y = rotation * 0.6;
    points.rotation.x = rotation * 0.25;
    wire.rotation.copy(points.rotation);
  }

  function render(renderer, pixelRect) {
    const { x, y, w, h } = pixelRect;
    if (w <= 0 || h <= 0) return;
    const prevScissor = renderer.getScissor(new THREE.Vector4());
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    const prevScissorTest = renderer.getScissorTest();

    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    renderer.setScissorTest(prevScissorTest);
    renderer.setScissor(prevScissor);
    renderer.setViewport(prevViewport);
  }

  return { scene, camera, update, render, dispose() {
    geometry.dispose();
    wire.geometry.dispose();
  } };
}

export function createBandWaterfall(scene, rect, options = {}) {
  const historyWidth = options.historyWidth ?? 64;
  const historyHeight = options.historyHeight ?? 96;
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const history = new Uint8Array(historyWidth * historyHeight);
  history.fill(0);
  let head = 0;

  const texture = new THREE.DataTexture(
    history,
    historyWidth,
    historyHeight,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 21;
  group.add(mesh);

  const band = options.band || { min: 40, max: 120 };
  let layoutBox = null;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    mesh.scale.set(layoutBox.width, -layoutBox.height, 1);
    mesh.position.set(layoutBox.cx, layoutBox.cy, 0);
  }

  function pushValue(energy) {
    history.copyWithin(historyWidth, 0, historyWidth * (historyHeight - 1));
    const row = (historyHeight - 1) * historyWidth;
    const value = Math.max(0, Math.min(255, Math.round(energy * 255)));
    for (let x = 0; x < historyWidth; x++) {
      const falloff = 1 - Math.abs(x / (historyWidth - 1) - 0.5) * 0.35;
      history[row + x] = Math.round(value * falloff);
    }
    head++;
    texture.needsUpdate = true;
  }

  function update({ frequencyData, sampleRate, fftSize, gain = 1, demo = false, demoPhase = 0 }) {
    const energy = demo
      ? 0.25 + Math.sin(demoPhase * 3 + rect.x * 10) * 0.2 + Math.random() * 0.05
      : bandEnergy(frequencyData, band.min, band.max, sampleRate, fftSize, gain);
    pushValue(energy);
  }

  function reset() {
    history.fill(0);
    head = 0;
    texture.needsUpdate = true;
  }

  return { group, layout, update, reset, band };
}

export function createPhaseScope(scene, rect, resolution) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const maxPts = 256;
  const positions = new Float32Array(maxPts * 3);
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = makeLineMaterial(resolution, 0.82, 1.6);
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 22;
  group.add(line);

  const crossMat = makeLineMaterial(resolution, 0.15, 1);
  const cross = new Line2(new LineGeometry(), crossMat);
  cross.frustumCulled = false;
  cross.renderOrder = 21;
  group.add(cross);

  let layoutBox = null;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    const pts = [
      layoutBox.left, layoutBox.cy, 0, layoutBox.right, layoutBox.cy, 0,
      layoutBox.cx, layoutBox.bottom, 0, layoutBox.cx, layoutBox.top, 0,
    ];
    cross.geometry.dispose();
    cross.geometry = new LineGeometry().setPositions(pts);
    cross.computeLineDistances();
  }

  function update({ timeDomainData, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    const len = timeDomainData.length;
    const delay = Math.max(4, Math.floor(len * 0.02));
    const scale = Math.min(layoutBox.width, layoutBox.height) * 0.42;

    for (let i = 0; i < maxPts; i++) {
      let l;
      let r;
      if (demo) {
        const t = demoPhase * 2 + i * 0.08;
        l = Math.sin(t) * 0.7;
        r = Math.sin(t * 1.13 + 0.6) * 0.7;
      } else {
        const idx = Math.floor((i / maxPts) * len);
        l = (timeDomainData[idx] - 128) / 128;
        r = (timeDomainData[(idx + delay) % len] - 128) / 128;
      }
      positions[i * 3] = layoutBox.cx + l * scale;
      positions[i * 3 + 1] = layoutBox.cy + r * scale;
      positions[i * 3 + 2] = 0;
    }
    line.geometry.setPositions(positions);
    line.computeLineDistances();
  }

  return {
    group,
    layout,
    update,
    setResolution(width, height) {
      material.resolution.set(width, height);
      crossMat.resolution.set(width, height);
    },
  };
}

export function createLoudnessHistory(scene, rect, resolution, options = {}) {
  const historySize = options.historySize ?? 280;
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const values = new Float32Array(historySize);
  let head = 0;
  const positions = new Float32Array(historySize * 3);
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const material = makeLineMaterial(resolution, 0.88, 1.8);
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 22;
  group.add(line);

  let layoutBox = null;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
  }

  function push(rms) {
    values[head % historySize] = Math.min(1, rms * 2.2);
    head++;
  }

  function update({ rms, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    push(demo ? 0.25 + Math.sin(demoPhase * 2.5) * 0.18 + Math.sin(demoPhase * 0.7) * 0.1 : rms);

    for (let i = 0; i < historySize; i++) {
      const age = (historySize - 1 - i);
      const index = (head - 1 - age + historySize * 1000) % historySize;
      const v = values[index];
      const x = layoutBox.left + (i / (historySize - 1)) * layoutBox.width;
      const y = layoutBox.bottom + v * layoutBox.height * 0.9 + layoutBox.height * 0.05;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    }
    line.geometry.setPositions(positions);
    line.computeLineDistances();
  }

  function reset() {
    values.fill(0);
    head = 0;
  }

  return {
    group,
    layout,
    update,
    reset,
    setResolution(width, height) {
      material.resolution.set(width, height);
    },
  };
}

export function createBeatPulse(scene, rect) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55 + i * 0.35, 0.62 + i * 0.35, 64),
      ringMat.clone(),
    );
    ring.renderOrder = 22;
    rings.push(ring);
    group.add(ring);
  }

  let layoutBox = null;
  let pulse = 0;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    const radius = Math.min(layoutBox.width, layoutBox.height) * 0.22;
    for (const ring of rings) {
      ring.position.set(layoutBox.cx, layoutBox.cy, 0);
      ring.scale.set(radius, radius, 1);
    }
  }

  function trigger() {
    pulse = 1;
  }

  function update({ delta = 0.016, demo = false, demoPhase = 0 }) {
    if (demo && Math.sin(demoPhase * 6) > 0.96) pulse = 1;
    pulse = Math.max(0, pulse - delta * 2.8);
    if (!layoutBox) return;
    const radius = Math.min(layoutBox.width, layoutBox.height) * 0.22;
    for (let i = 0; i < rings.length; i++) {
      const boost = pulse * (1 - i * 0.22);
      const s = radius * (1 + boost * 0.35);
      rings[i].scale.set(s, s, 1);
      rings[i].material.opacity = 0.1 + boost * 0.6;
    }
  }

  return { group, layout, update, trigger };
}

export function collectBandEnergies(frequencyData, sampleRate, fftSize, gain = 1) {
  return [
    bandEnergy(frequencyData, 20, 80, sampleRate, fftSize, gain),
    bandEnergy(frequencyData, 80, 250, sampleRate, fftSize, gain),
    bandEnergy(frequencyData, 250, 2000, sampleRate, fftSize, gain),
    bandEnergy(frequencyData, 2000, 14000, sampleRate, fftSize, gain),
  ];
}

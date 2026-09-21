/**
 * Shared monochrome chart panels for monitor-suite visualisers.
 */
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
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

function disposeChartGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of [].concat(object.material)) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.removeFromParent();
}

// LineGeometry.setPositions allocates an interleaved buffer. Reuse it while the
// sample count is unchanged so oscilloscope updates do not generate garbage.
function updateLinePositions(geometry, positions) {
  const count = positions.length / 3 - 1;
  const start = geometry.getAttribute('instanceStart');
  if (!start || start.count !== count) {
    geometry.setPositions(positions);
    return;
  }
  const array = start.data.array;
  for (let i = 0; i < count; i++) {
    const source = i * 3;
    const target = i * 6;
    array[target] = positions[source];
    array[target + 1] = positions[source + 1];
    array[target + 2] = positions[source + 2];
    array[target + 3] = positions[source + 3];
    array[target + 4] = positions[source + 4];
    array[target + 5] = positions[source + 5];
  }
  start.data.needsUpdate = true;
}

export function createPanelGrid(scene, panels, resolution, options = {}) {
  const gridOpacity = options.gridOpacity ?? 0.22;
  const frameOpacity = options.frameOpacity ?? 0.85;
  const gridCell = options.gridCell ?? 2.5;
  const frameMaterial = makeLineMaterial(resolution, frameOpacity, 1.4);
  const gridMaterial = makeLineMaterial(resolution, gridOpacity, 1);
  const frames = new LineSegments2(new LineSegmentsGeometry(), frameMaterial);
  const grid = new LineSegments2(new LineSegmentsGeometry(), gridMaterial);
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
    frames.geometry = new LineSegmentsGeometry().setPositions(framePts);
    grid.geometry = new LineSegmentsGeometry().setPositions(gridPts);
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
    dispose() {
      scene.remove(frames, grid);
      frames.geometry.dispose();
      grid.geometry.dispose();
      frameMaterial.dispose();
      gridMaterial.dispose();
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

export function createStereoMeters(scene, rect, resolution, options = {}) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const stereo = options.mode === 'stereo';
  const labels = stereo ? ['L', 'R'] : ["Lpk", "Lrms", "Rpk", "Rrms"];
  const colors = options.colors || (stereo ? ['#84c5ca', '#c9a77a'] : ['#ffffff', '#ffffff']);
  const floorDb = Math.min(-1, options.minDecibels ?? -60);
  const tracks = [];
  const peakHold = new Float32Array(labels.length);
  const barGeo = new THREE.PlaneGeometry(1, 1);
  const holdGeo = new THREE.PlaneGeometry(1, 1);

  for (let i = 0; i < labels.length; i++) {
    const color = colors[stereo ? i : Math.floor(i / 2)] || colors[0];
    const bar = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: options.opacity ?? 0.88, depthWrite: false, depthTest: false,
    }));
    const hold = new THREE.Mesh(holdGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: stereo ? 0.75 : 0.55, depthWrite: false, depthTest: false,
    }));
    const peak = stereo ? new THREE.Mesh(holdGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false,
    })) : null;
    bar.renderOrder = 22;
    hold.renderOrder = 23;
    group.add(bar, hold);
    if (peak) { peak.renderOrder = 23; group.add(peak); }
    tracks.push({ bar, hold, peak, label: labels[i] });
  }

  let layoutBox = null;
  let viewportHeight = resolution?.y || 1080;
  let currentAspect = 16 / 9;

  function layout(aspect) {
    currentAspect = aspect;
    layoutBox = rectToWorld(rect, aspect);
    const gap = layoutBox.width / (tracks.length + 1);
    const barW = gap * (stereo ? 0.62 : 0.55);
    const markerHeight = stereo ? worldHeight(aspect) / viewportHeight * 1.3 : 0.0144;
    for (let i = 0; i < tracks.length; i++) {
      const x = layoutBox.left + gap * (i + 1);
      tracks[i].bar.scale.set(barW, layoutBox.height * 0.02, 1);
      tracks[i].bar.position.set(x, layoutBox.bottom, 0);
      tracks[i].hold.scale.set(barW, markerHeight, 1);
      tracks[i].hold.position.set(x, layoutBox.bottom, 0);
      if (tracks[i].peak) {
        tracks[i].peak.scale.set(barW, markerHeight * 0.7, 1);
        tracks[i].peak.position.set(x, layoutBox.bottom, 0);
      }
    }
  }

  function normalizedLevel(amplitude) {
    if (!(amplitude > 0)) return 0;
    return Math.max(0, Math.min(1, (20 * Math.log10(amplitude) - floorDb) / -floorDb));
  }

  function update({ levels = {}, decay = 0.96, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    for (let i = 0; i < tracks.length; i++) {
      const key = stereo ? (i === 0 ? 'lRms' : 'rRms') : ['lPeak', 'lRms', 'rPeak', 'rRms'][i];
      let value = levels[key] || 0;
      if (demo) {
        value = stereo
          ? 0.22 + Math.sin(demoPhase * (2.4 + i * 0.17)) * 0.1
          : [
            0.35 + Math.sin(demoPhase * 3.1) * 0.2,
            0.22 + Math.sin(demoPhase * 2.4) * 0.1,
            0.34 + Math.sin(demoPhase * 3.3 + 0.4) * 0.2,
            0.2 + Math.sin(demoPhase * 2.1 + 0.2) * 0.1,
          ][i];
      }
      const v = stereo ? normalizedLevel(value) : Math.max(0, Math.min(1, value * 1.1));
      const channel = i === 0 ? 'l' : 'r';
      const currentPeak = stereo ? normalizedLevel(demo ? value * 1.45 : levels[channel + 'Peak']) : v;
      const suppliedHold = stereo && Number.isFinite(levels[channel + 'Hold']);
      // An externally supplied hold is a timestamp-derived measurement. Repainting
      // a paused frame must not make it decay, unlike the legacy live follower.
      peakHold[i] = suppliedHold
        ? normalizedLevel(levels[channel + 'Hold'])
        : Math.max(currentPeak, peakHold[i] * decay);
      const h = Math.max(0.02, v * layoutBox.height * 0.94);
      const bar = tracks[i].bar;
      bar.scale.y = h;
      bar.position.y = layoutBox.bottom + h / 2;
      if (stereo) bar.visible = v > 0;

      const holdY = layoutBox.bottom + peakHold[i] * layoutBox.height * 0.94;
      tracks[i].hold.position.y = holdY;
      if (stereo) {
        tracks[i].hold.visible = peakHold[i] > 0;
        tracks[i].peak.visible = currentPeak > 0;
        tracks[i].peak.position.y = layoutBox.bottom + currentPeak * layoutBox.height * 0.94;
      }
    }
  }

  function resetPeaks() {
    peakHold.fill(0);
  }

  return {
    group, layout, update, resetPeaks,
    setResolution(width, height) {
      viewportHeight = height;
      if (layoutBox) layout(currentAspect);
    },
    dispose() { disposeChartGroup(group); },
  };
}

export function createWaveformMinimap(scene, rect, options = {}) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const uniforms = {
    uPeaks: { value: null },
    uEnergyPeaks: { value: null },
    uHasEnergy: { value: 0 },
    uPixelRatio: { value: options.pixelRatio || 1 },
    uProgress: { value: 0 },
    uColor: { value: new THREE.Color(options.color || '#ffffff') },
    uPlayedColor: { value: new THREE.Color(options.playedColor || '#909090') },
    uBackground: { value: new THREE.Color(options.backgroundColor || '#000000') },
    uBarCount: { value: 0 },
    uBarFill: { value: 1 },
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
      uniform sampler2D uEnergyPeaks;
      uniform float uHasEnergy;
      uniform float uPixelRatio;
      uniform float uProgress;
      uniform vec3 uColor;
      uniform vec3 uPlayedColor;
      uniform vec3 uBackground;
      uniform float uBarCount;
      uniform float uBarFill;
      varying vec2 vUv;

      void main() {
        float sampleX = vUv.x;
        float barCoverage = 1.0;
        if (uBarCount > 0.0) {
          float column = min(floor(vUv.x * uBarCount), uBarCount - 1.0);
          sampleX = (column + 0.5) / uBarCount;
          float edgeDistance = uBarFill * 0.5 - abs(fract(vUv.x * uBarCount) - 0.5);
          float aaX = max(fwidth(vUv.x * uBarCount) * 0.65, 0.0001);
          barCoverage = smoothstep(-aaX, aaX, edgeDistance);
        }
        float peak = clamp(texture2D(uPeaks, vec2(sampleX, 0.5)).r, 0.0, 1.0);
        float rms = clamp(texture2D(uEnergyPeaks, vec2(sampleX, 0.5)).r, 0.0, 1.0);
        float envelope = mix(peak, pow(rms, 0.85), uHasEnergy);
        float edgeDistance = envelope * 0.44 - abs(vUv.y - 0.5);
        float aaY = max(fwidth(vUv.y) * 0.65, 0.00001);
        float coverage = smoothstep(-aaY, aaY, edgeDistance) * step(0.000001, envelope);
        // Energy supplies the solid body; true peaks remain as a fine outline.
        // Peak transients stay visible without filling the track into a brick.
        float peakEdge = abs(abs(vUv.y - 0.5) - peak * 0.44);
        float halfStroke = max(fwidth(vUv.y) * uPixelRatio * 0.4, 0.00001);
        float peakOutline = (1.0 - smoothstep(halfStroke - aaY, halfStroke + aaY, peakEdge))
          * step(0.000001, peak) * uHasEnergy * 0.3;
        coverage = max(coverage, peakOutline) * barCoverage;
        float played = step(vUv.x, uProgress);
        vec3 color = mix(uColor, uPlayedColor, played);
        gl_FragColor = vec4(mix(uBackground, color, coverage), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = 21;
  group.add(mesh);

  const playheadMat = new THREE.MeshBasicMaterial({
    color: options.playheadColor || options.color || 0xffffff,
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
  const markerMat = new THREE.MeshBasicMaterial({
    color: options.color || 0xffffff,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });

  let peaksTexture = null;
  let energyTexture = null;
  let sourcePeaks = new Float32Array(1);
  let sourceEnergy = null;
  let layoutBox = null;
  let onsets = [];
  let viewportWidth = options.width || 1920;
  let pixelRatio = options.pixelRatio || 1;
  const barWidth = Math.max(0, options.barWidth || 0);
  const barGap = Math.max(0, options.barGap ?? 0.3);

  function rebuildPeaks() {
    const widthPixels = Math.max(1, (layoutBox?.width || rect.w * WORLD_WIDTH) / WORLD_WIDTH * viewportWidth);
    const barCount = barWidth > 0 ? Math.max(1, Math.floor(widthPixels / (barWidth + barGap))) : 0;
    // Every source bin contributes: MAX preserves brief peak transients, while
    // the quadratic mean preserves energy across each actual pixel/bar footprint.
    const count = barCount || Math.min(sourcePeaks.length, Math.ceil(widthPixels * pixelRatio));
    function aggregate(source, energy = false) {
      const displayed = new Float32Array(Math.max(1, count));
      if (!source) return displayed;
      for (let i = 0; i < displayed.length; i++) {
        const start = Math.min(source.length - 1, Math.floor(i * source.length / displayed.length));
        const end = Math.min(source.length, Math.max(start + 1, Math.ceil((i + 1) * source.length / displayed.length)));
        let value = 0;
        for (let sample = start; sample < end; sample++) {
          value = energy ? value + source[sample] * source[sample] : Math.max(value, source[sample]);
        }
        displayed[i] = energy ? Math.sqrt(value / Math.max(1, end - start)) : value;
      }
      return displayed;
    }
    function makeTexture(values) {
      const result = new THREE.DataTexture(values, values.length, 1, THREE.RedFormat, THREE.FloatType);
      result.minFilter = barCount ? THREE.NearestFilter : THREE.LinearFilter;
      result.magFilter = barCount ? THREE.NearestFilter : THREE.LinearFilter;
      result.generateMipmaps = false;
      result.needsUpdate = true;
      return result;
    }
    peaksTexture?.dispose();
    energyTexture?.dispose();
    peaksTexture = makeTexture(aggregate(sourcePeaks));
    energyTexture = makeTexture(aggregate(sourceEnergy, true));
    uniforms.uPeaks.value = peaksTexture;
    uniforms.uEnergyPeaks.value = energyTexture;
    uniforms.uHasEnergy.value = sourceEnergy ? 1 : 0;
    uniforms.uPixelRatio.value = pixelRatio;
    uniforms.uBarCount.value = barCount;
    uniforms.uBarFill.value = barWidth > 0 ? barWidth / (barWidth + barGap) : 1;
  }

  function setPeaks(peaks, rmsPeaks = null) {
    sourcePeaks = peaks?.length ? peaks : new Float32Array(1);
    sourceEnergy = rmsPeaks?.length ? rmsPeaks : null;
    rebuildPeaks();
  }

  function setOnsets(positions) {
    onsets = positions || [];
    rebuildMarkers();
  }

  function rebuildMarkers() {
    while (markerGroup.children.length) {
      const marker = markerGroup.children[0];
      marker.geometry.dispose();
      markerGroup.remove(marker);
    }
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
    playhead.scale.set(options.playheadWidth ?? 0.14, layoutBox.height, 1);
    playhead.position.set(layoutBox.left, layoutBox.cy, 0);
    rebuildPeaks();
    rebuildMarkers();
  }

  function update({ progress = 0 }) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    uniforms.uProgress.value = clamped;
    if (layoutBox) {
      playhead.position.x = layoutBox.left + layoutBox.width * clamped;
    }
  }

  function dispose() {
    peaksTexture?.dispose();
    energyTexture?.dispose();
    // No marker may exist, but this shared material still belongs to the chart.
    if (!markerGroup.children.length) markerMat.dispose();
    disposeChartGroup(group);
  }

  rebuildPeaks();
  return {
    group, layout, setPeaks, setOnsets, update, dispose,
    setColors({ color, playedColor, playheadColor } = {}) {
      if (color != null) {
        uniforms.uColor.value.set(color);
        markerMat.color.set(color);
      }
      if (playedColor != null) uniforms.uPlayedColor.value.set(playedColor);
      if (playheadColor != null) playheadMat.color.set(playheadColor);
    },
    setResolution(width, height, ratio = 1) {
      viewportWidth = width;
      pixelRatio = ratio;
      rebuildPeaks();
    },
  };
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

export function createPhaseScope(scene, rect, resolution, options = {}) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  scene.add(group);

  const pointMode = options.mode === 'points';
  const maxPts = Math.max(2, Math.floor(options.pointCount || (pointMode ? 8192 : 256)));
  const positions = new Float32Array(maxPts * 3);
  const geometry = pointMode ? new THREE.BufferGeometry() : new LineGeometry();
  let material;
  if (pointMode) {
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const sampleIndices = new Float32Array(maxPts);
    for (let i = 0; i < maxPts; i++) sampleIndices[i] = i;
    geometry.setAttribute('sampleIndex', new THREE.BufferAttribute(sampleIndices, 1));
    material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: {
        uColor: { value: new THREE.Color(options.color || '#84c5ca') },
        uOpacity: { value: options.opacity ?? 0.35 },
        uPointSize: { value: options.pointSize ?? 1.65 },
        uPixelRatio: { value: options.pixelRatio || 1 },
        uCount: { value: maxPts },
        uCentre: { value: new THREE.Vector2() },
        uRadius: { value: 1 },
      },
      vertexShader: `
        attribute float sampleIndex;
        uniform float uPointSize;
        uniform float uPixelRatio;
        uniform float uCount;
        uniform vec2 uCentre;
        uniform float uRadius;
        varying float vAge;
        varying float vRadius;
        void main() {
          vAge = sampleIndex / max(1.0, uCount - 1.0);
          vRadius = length((position.xy - uCentre) / uRadius);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, uPointSize * uPixelRatio);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAge;
        varying float vRadius;
        void main() {
          if (vRadius > 1.0) discard;
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          float aa = max(fwidth(radius), 0.03);
          float circle = 1.0 - smoothstep(1.0 - aa, 1.0, radius);
          float core = exp(-radius * radius * 3.0);
          float alpha = circle * mix(0.24, 1.0, vAge) * (0.55 + core * 0.45) * uOpacity;
          gl_FragColor = vec4(uColor * mix(0.72, 1.0, vAge), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  } else {
    geometry.setPositions(positions);
    material = makeLineMaterial(resolution, options.opacity ?? 0.82, options.lineWidth ?? 1.6);
    if (options.color) material.color.set(options.color);
  }
  const trace = pointMode ? new THREE.Points(geometry, material) : new Line2(geometry, material);
  trace.frustumCulled = false;
  trace.renderOrder = 22;
  group.add(trace);

  const crossMat = makeLineMaterial(resolution, 0.15, 1);
  const cross = new LineSegments2(new LineSegmentsGeometry(), crossMat);
  if (options.color) crossMat.color.set(options.color);
  cross.frustumCulled = false;
  cross.renderOrder = 21;
  cross.visible = options.axes !== false;
  group.add(cross);

  let layoutBox = null;

  function layout(aspect) {
    layoutBox = rectToWorld(rect, aspect);
    const pts = [
      layoutBox.left, layoutBox.cy, 0, layoutBox.right, layoutBox.cy, 0,
      layoutBox.cx, layoutBox.bottom, 0, layoutBox.cx, layoutBox.top, 0,
    ];
    cross.geometry.dispose();
    cross.geometry = new LineSegmentsGeometry().setPositions(pts);
    cross.computeLineDistances();
    if (pointMode) {
      material.uniforms.uCentre.value.set(layoutBox.cx, layoutBox.cy);
      material.uniforms.uRadius.value = Math.min(layoutBox.width, layoutBox.height) * 0.42;
    }
  }

  function update({ left, right, timeDomainData, gain = 1, correlation = null, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    const stereo = Boolean(left?.length);
    const rightChannel = right?.length ? right : left;
    const len = stereo ? Math.min(left.length, rightChannel.length) : timeDomainData?.length || 0;
    if (!demo && !len) { trace.visible = false; return; }
    trace.visible = true;
    const count = pointMode && !demo ? Math.min(maxPts, len) : maxPts;
    const delay = Math.max(4, Math.floor(len * 0.02));
    const scale = Math.min(layoutBox.width, layoutBox.height) * 0.42;

    for (let i = 0; i < count; i++) {
      let l;
      let r;
      if (demo) {
        const t = demoPhase * 2 + i * 0.08;
        l = Math.sin(t) * 0.7;
        r = Math.sin(t * 1.13 + 0.6) * 0.7;
      } else if (stereo) {
        // Float PCM preserves actual channel phase. Keep the newest complete
        // sample window; do not fabricate a right channel from a delayed left.
        const idx = pointMode ? len - count + i : Math.min(len - 1, Math.floor(i / maxPts * len));
        l = left[idx] * gain;
        r = rightChannel[idx] * gain;
      } else {
        const idx = Math.floor((i / count) * len);
        l = (timeDomainData[idx] - 128) / 128 * gain;
        r = (timeDomainData[(idx + delay) % len] - 128) / 128 * gain;
      }
      const rotated = stereo || pointMode;
      positions[i * 3] = layoutBox.cx + (rotated ? (l - r) * 0.5 : l) * scale;
      positions[i * 3 + 1] = layoutBox.cy + (rotated ? (l + r) * 0.5 : r) * scale;
      positions[i * 3 + 2] = 0;
    }
    if (pointMode) {
      geometry.setDrawRange(0, count);
      geometry.getAttribute('position').needsUpdate = true;
      material.uniforms.uCount.value = count;
    } else {
      updateLinePositions(geometry, positions);
    }
    group.userData.correlation = correlation;
  }

  return {
    group,
    layout,
    update,
    setResolution(width, height, pixelRatio = 1) {
      if (pointMode) material.uniforms.uPixelRatio.value = pixelRatio;
      else material.resolution.set(width, height);
      crossMat.resolution.set(width, height);
    },
    dispose() { disposeChartGroup(group); },
  };
}

/** A shared trigger keeps the two 30 ms PCM traces aligned in time and phase. */
export function createWaveformMicroscope(scene, rect, resolution, options = {}) {
  const group = new THREE.Group();
  group.renderOrder = 20;
  group.visible = false;
  scene.add(group);
  const colors = options.colors || ['#84c5ca', '#c9a77a'];
  const seconds = Math.max(0.001, options.windowSeconds ?? 0.03);
  const triggerSeconds = Math.max(0, options.triggerSeconds ?? 0.008);
  const channels = [0, 1].map(channel => {
    const geometry = new LineGeometry();
    const material = makeLineMaterial(resolution, options.opacity ?? 0.78, options.lineWidth ?? 1.1);
    material.color.set(colors[channel] || colors[0]);
    material.alphaToCoverage = true;
    const line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 22 + channel;
    group.add(line);
    return { geometry, material, line, positions: null };
  });
  let layoutBox = null;
  let count = 0;

  function layout(aspect) { layoutBox = rectToWorld(rect, aspect); }

  function allocate(sampleCount) {
    if (sampleCount === count) return;
    count = sampleCount;
    for (const channel of channels) {
      channel.positions = new Float32Array(count * 3);
      channel.geometry.setPositions(channel.positions);
      channel.geometry.getAttribute('instanceStart').data.setUsage(THREE.DynamicDrawUsage);
    }
  }

  function update({ buffer, time = 0, gain = 1, demo = false, demoPhase = 0 }) {
    if (!layoutBox) return;
    if (!buffer && !demo) { group.visible = false; return; }
    group.visible = true;
    const sampleRate = buffer?.sampleRate || 48000;
    allocate(Math.max(2, Math.round(sampleRate * seconds)));
    const left = buffer?.getChannelData(0);
    const right = buffer ? buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)) : null;
    const end = Math.floor(Math.max(0, Math.min(buffer?.duration || 0, time)) * sampleRate);
    const nominalStart = end - count;
    let start = nominalStart;

    if (buffer && nominalStart > 0 && triggerSeconds > 0) {
      const searchStart = Math.max(1, nominalStart - Math.round(triggerSeconds * sampleRate));
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let i = searchStart; i <= nominalStart; i++) {
        leftEnergy += left[i] ** 2;
        rightEnergy += right[i] ** 2;
      }
      // A right-only recording still obtains a stable trigger. Both traces use
      // exactly the same start sample, including anti-phase stereo material.
      const trigger = leftEnergy >= rightEnergy ? left : right;
      for (let i = nominalStart; i >= searchStart; i--) {
        if (trigger[i - 1] <= 0 && trigger[i] > 0) { start = i; break; }
      }
    }

    let windowPeak = 0;
    let displayGain = gain;
    if (buffer && options.autoScale) {
      const from = Math.max(0, start);
      const to = Math.min(left.length, start + count);
      for (let sample = from; sample < to; sample++) {
        windowPeak = Math.max(windowPeak, Math.abs(left[sample]), Math.abs(right[sample]));
      }
      // One gain follows the actual displayed window, so left/right balance and
      // phase survive seeking. The floor avoids amplifying silence or tiny noise.
      displayGain *= Math.min(8, 0.7 / Math.max(0.09, windowPeak));
    }

    for (let channel = 0; channel < 2; channel++) {
      const samples = channel ? right : left;
      const positions = channels[channel].positions;
      for (let i = 0; i < count; i++) {
        const at = start + i;
        const sample = buffer
          ? (at >= 0 && at < samples.length ? samples[at] : 0)
          : Math.sin(i / sampleRate * Math.PI * 2 * 180 + demoPhase + channel * 0.3) * 0.45
            + Math.sin(i / sampleRate * Math.PI * 2 * 720 + channel * 0.5) * 0.15;
        positions[i * 3] = layoutBox.left + i / (count - 1) * layoutBox.width;
        positions[i * 3 + 1] = layoutBox.cy + Math.max(-1, Math.min(1, sample * displayGain)) * layoutBox.height * 0.43;
        positions[i * 3 + 2] = 0;
      }
      updateLinePositions(channels[channel].geometry, positions);
    }
    group.userData.startSample = start;
    group.userData.sampleCount = count;
    group.userData.gain = displayGain;
    group.userData.windowPeak = windowPeak;
  }

  return {
    group, layout, update,
    setResolution(width, height) {
      for (const channel of channels) channel.material.resolution.set(width, height);
    },
    dispose() { disposeChartGroup(group); },
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

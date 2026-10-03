import * as THREE from 'three';
import { createWaveformMinimap, rectToWorld } from '../monitor-charts.js';
import { formatTrackTime } from '../atlas/signal-atlas-setlist.js';
import { scopeSpan, scopeTraces, scopeSamples, scopeAutoGain, SCOPE_MAX_POINTS, SCOPE_MAX_TRACES } from './phosphor-scope.js';
import {
  TELEMETRY_CHANNELS, TELEMETRY_SPARK_POINTS, telemetryNorm, telemetryReadout, readoutFrame, sparklineSamples, alertAge, alertFlash,
} from './phosphor-telemetry.js';

const FPS = 60, W = 1920, H = 1080;
const LEFT = .06 * W, RIGHT = .94 * W;
const HISTORY_SECONDS = 30;
const KEEP_FRAMES = HISTORY_SECONDS * FPS + 3 * FPS;
const BLACK = new THREE.Color('#000000');
const FONT = '"Inter", sans-serif';
const SCOPE = Object.freeze({ x: LEFT, y: 134, w: RIGHT - LEFT, h: 166 });
const SCOPE_COLUMNS = 20, SCOPE_ROWS = 6, SCOPE_AMPLITUDE = .92;
const WALL = Object.freeze({ top: 376, height: 170, cols: 6, gx: 14, gy: 12 });
const TILE_W = (RIGHT - LEFT - WALL.gx * (WALL.cols - 1)) / WALL.cols;
const TILE_H = (WALL.height - WALL.gy) / 2;
const TILE = Object.freeze({ pad: 14, label: 20, value: 54, valueSize: 24, textSize: 20, unit: TILE_H - 11,
  sparkLeft: .5, sparkTop: 30, sparkBottom: 12, dot: 16, radius: 6 });
const RECTS = Object.freeze({
  scope: { x: .06, y: SCOPE.y / H, w: .88, h: SCOPE.h / H },
  telemetry: { x: .06, y: WALL.top / H, w: .88, h: WALL.height / H },
  overview: { x: .06, y: .56, w: .88, h: .14 },
  textReserve: { x: 0, y: .75, w: 1, h: .25 },
});
const MAX_SPARK_POINTS = TELEMETRY_SPARK_POINTS + 2;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const colorSetting = (settings, key, fallback) => /^#[\da-f]{6}$/i.test(settings[key]) ? settings[key] : fallback;
const spaced = name => name.split(' ').map(word => word.split('').join(' ')).join('   ');

function tileOrigin(index) {
  return { x: LEFT + (index % WALL.cols) * (TILE_W + WALL.gx), y: WALL.top + Math.floor(index / WALL.cols) * (TILE_H + WALL.gy) };
}

function roundedPath(path, x, y, w, h, r) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** Reorderable phosphor scope and six-by-two telemetry wall above the shared reflected-bar overview.
 * Everything below 75% of the frame is protected by a hard scissor for titles. */
export function createPhosphorAtlasScene(stage, settings = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setClearColor(BLACK, 1);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Phosphor scope and twelve telemetry tiles above track overview; lower quarter reserved for titles');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 50 / (16 / 9), -50 / (16 / 9), -10, 10);
  camera.position.z = 5;
  const charts = new THREE.Group();
  scene.add(charts);
  let width = 1920, height = 1080, ratio = 1, aspect = 16 / 9;
  let disposed = false, sampleRate = 48000, colorsKey = '', latestFrame = -1, lastTime = 0;
  let labelState = null, scopeState = { windowMs: 0, span: 0, gain: 1, triggers: [], points: 0 }, telemetryState = [];
  let colors = resolveColors();
  const history = new Map();
  const resources = [];
  const scratch = new Float32Array(SCOPE_MAX_POINTS);
  const scope = { ...SCOPE };
  let sectionOrder = '', scopeHeaderY = 0, telemetryHeaderY = 0;

  function resolveColors() {
    return {
      low: colorSetting(settings, 'colorLow', '#68c8bd'), mid: colorSetting(settings, 'colorMid', '#e3ad73'),
      high: colorSetting(settings, 'colorHigh', '#aaa3d7'), text: colorSetting(settings, 'colorText', '#eee9df'),
      guides: colorSetting(settings, 'colorGuides', '#8f999a'),
    };
  }
  const bandColors = () => [colors.low, colors.mid, colors.high];

  function material(color, opacity, additive = false) {
    return new THREE.MeshBasicMaterial({ color, opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  }

  function addMesh(geometry, mat, order) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    charts.add(mesh);
    const resource = { mesh, geometry, material: mat };
    resources.push(resource);
    return resource;
  }

  /** Triangle strips with a dynamic index, so one mesh can hold several runs separated by gaps. */
  function makeStrip(maxPoints, color, opacity, order, additive = false) {
    const positions = new Float32Array(maxPoints * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(Math.max(1, maxPoints - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return { ...addMesh(geometry, material(color, opacity, additive), order), positions, maxPoints };
  }

  function writeRuns(resource, runs, { width: lineWidth = 0, baseline = 0 } = {}) {
    const { positions, geometry, maxPoints } = resource;
    const index = geometry.index.array;
    let vertex = 0, indices = 0;
    for (const run of runs) {
      if (run.length < 2 || vertex / 2 + run.length > maxPoints) continue;
      for (let i = 0; i < run.length; i++) {
        const [x, y] = run[i], k = (vertex + i * 2) * 3;
        if (lineWidth) {
          const before = run[Math.max(0, i - 1)], after = run[Math.min(run.length - 1, i + 1)];
          const dx = after[0] - before[0], dy = after[1] - before[1], length = Math.hypot(dx, dy) || 1;
          const px = -dy / length * lineWidth / 2, py = dx / length * lineWidth / 2;
          positions[k] = x + px; positions[k + 1] = y + py;
          positions[k + 3] = x - px; positions[k + 4] = y - py;
        } else {
          positions[k] = x; positions[k + 1] = y;
          positions[k + 3] = x; positions[k + 4] = baseline;
        }
      }
      for (let i = 0; i < run.length - 1; i++) {
        const j = vertex + i * 2;
        index[indices] = j; index[indices + 1] = j + 1; index[indices + 2] = j + 2;
        index[indices + 3] = j + 1; index[indices + 4] = j + 3; index[indices + 5] = j + 2;
        indices += 6;
      }
      vertex += run.length * 2;
    }
    geometry.setDrawRange(0, indices);
    geometry.attributes.position.needsUpdate = true;
    geometry.index.needsUpdate = true;
  }

  function makeDisk(color, opacity, order) {
    const positions = new Float32Array(36 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    return { ...addMesh(geometry, material(color, opacity), order), positions };
  }

  function writeDisk(resource, point, radius) {
    if (!point) { resource.geometry.setDrawRange(0, 0); return; }
    const [x, y] = point;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6, k = i * 9;
      resource.positions[k] = x; resource.positions[k + 1] = y;
      resource.positions[k + 3] = x + Math.cos(a) * radius; resource.positions[k + 4] = y + Math.sin(a) * radius;
      resource.positions[k + 6] = x + Math.cos(b) * radius; resource.positions[k + 7] = y + Math.sin(b) * radius;
    }
    resource.geometry.setDrawRange(0, 36);
    resource.geometry.attributes.position.needsUpdate = true;
  }

  const scopeGlow = makeStrip(SCOPE_MAX_POINTS, colors.low, .16, 40, true);
  const scopeCore = makeStrip(SCOPE_MAX_POINTS, colors.text, 1, 41);
  const phosphor = Array.from({ length: SCOPE_MAX_TRACES - 1 }, (_, k) => makeStrip(SCOPE_MAX_POINTS, colors.low, .5, 39 - k));

  const tiles = TELEMETRY_CHANNELS.map((channel, index) => {
    const { x, y } = tileOrigin(index);
    const fill = addMesh(new THREE.ShapeGeometry(roundedPath(new THREE.Shape(), x, y, TILE_W, TILE_H, TILE.radius), 6), material(colors.guides, .035), 20);
    const ring = roundedPath(new THREE.Shape(), x, y, TILE_W, TILE_H, TILE.radius);
    ring.holes.push(roundedPath(new THREE.Path(), x + 1, y + 1, TILE_W - 2, TILE_H - 2, TILE.radius - 1));
    const border = addMesh(new THREE.ShapeGeometry(ring, 6), material(colors.guides, .2), 21);
    const dot = makeDisk(colors.low, .7, 22);
    writeDisk(dot, [x + TILE_W - TILE.pad - 2, y + TILE.dot], 3.5);
    const series = (channel.series || [channel.value]).map(() => ({
      area: makeStrip(MAX_SPARK_POINTS, colors.low, .07, 23),
      line: makeStrip(MAX_SPARK_POINTS, colors.low, 1, 24),
      head: makeDisk(colors.low, 1, 25),
    }));
    return { channel, x, y, fill, border, dot, series };
  });

  const minimap = createWaveformMinimap(scene, RECTS.overview, {
    color: colors.text, playedColor: colors.low, playheadColor: colors.text,
    style: 'reflected-bars', barWidth: 2.3, barGap: .55,
  });

  const layers = [
    makeLabelLayer('charts', { x: .05, y: .032, w: .9, h: .5 }),
    makeLabelLayer('scopeMeta', { x: .4, y: .09, w: .545, h: .024 }),
    makeLabelLayer('values', { x: .06, y: WALL.top / H, w: .88, h: WALL.height / H }),
    makeLabelLayer('overviewHeader', { x: .06, y: .51, w: .88, h: .04 }),
    makeLabelLayer('overviewMarkers', { x: .05, y: .69, w: .9, h: .025 }),
    makeLabelLayer('overviewFooter', { x: .055, y: .704, w: .89, h: .037 }),
  ];

  function updateLayout() {
    const scopeFirst = settings.sectionOrder === 'scope-telemetry';
    const nextOrder = scopeFirst ? 'scope-telemetry' : 'telemetry-scope';
    if (nextOrder === sectionOrder) return;
    sectionOrder = nextOrder;
    scope.y = scopeFirst ? SCOPE.y : WALL.top;
    const telemetryTop = scopeFirst ? WALL.top : SCOPE.y;
    scopeHeaderY = scopeFirst ? .106 * H : 358.5;
    telemetryHeaderY = scopeFirst ? 358.5 : .106 * H;
    tiles.forEach((tile, index) => {
      tile.y = tileOrigin(index).y + telemetryTop - WALL.top;
      for (const part of [tile.fill, tile.border, tile.dot]) part.mesh.position.y = telemetryTop - WALL.top;
    });
    layers.find(layer => layer.name === 'scopeMeta').rect.y = scopeHeaderY / H - .016;
    layers.find(layer => layer.name === 'values').rect.y = telemetryTop / H;
    const description = scopeFirst ? 'Phosphor scope, then twelve telemetry tiles' : 'Twelve telemetry tiles, then phosphor scope';
    renderer.domElement.setAttribute('aria-label', `${description} above track overview; lower quarter reserved for titles`);
    resizeLabels();
  }

  function makeLabelLayer(name, rect) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 100;
    scene.add(mesh);
    return { name, rect, canvas, ctx, material: mat, mesh, texture: null, key: '', uploads: 0 };
  }

  function resizeLabels() {
    for (const layer of layers) {
      const { canvas, rect, mesh, material: mat } = layer;
      const w = Math.max(1, Math.round(width * ratio * rect.w));
      const h = Math.max(1, Math.round(height * ratio * rect.h));
      if (w !== canvas.width || h !== canvas.height || !layer.texture) {
        canvas.width = w; canvas.height = h;
        layer.texture?.dispose();
        layer.texture = new THREE.CanvasTexture(canvas);
        layer.texture.colorSpace = THREE.SRGBColorSpace;
        layer.texture.minFilter = THREE.LinearFilter;
        layer.texture.generateMipmaps = false;
        mat.map = layer.texture;
        mat.needsUpdate = true;
      }
      const box = rectToWorld(rect, aspect, 0);
      mesh.scale.set(box.width, box.height, 1);
      mesh.position.set(box.cx, box.cy, 0);
      layer.key = '';
    }
  }

  function text(ctx, label, x, y, { size = 13, color = colors.guides, align = 'left', weight = 500 } = {}) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x, y);
  }

  function rule(ctx, x1, y1, x2, y2, alpha = settings.gridOpacity ?? .24, color = colors.guides, lineWidth = .75) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  const showLabels = () => settings.labels !== false;
  const header = (number, name) => `${settings.sectionNumbers === false ? '' : `${number}   `}${name}`;
  const windowMs = () => [23, 46, 93].includes(settings.scopeWindow) ? settings.scopeWindow : 46;
  const sparkSeconds = () => clamp(Math.round(Number(settings.sparkSeconds) || 10), 5, HISTORY_SECONDS);

  function drawChartLabels(ctx, hasAudio) {
    const grid = settings.gridOpacity ?? .24;
    rule(ctx, LEFT, .073 * H, RIGHT, .073 * H);
    const p = scope, cy = p.y + p.h / 2;
    for (let i = 0; i <= SCOPE_COLUMNS; i++) rule(ctx, p.x + i * p.w / SCOPE_COLUMNS, p.y, p.x + i * p.w / SCOPE_COLUMNS, p.y + p.h, grid * (i * 2 === SCOPE_COLUMNS ? 1.25 : .46));
    for (let j = 0; j <= SCOPE_ROWS; j++) rule(ctx, p.x, p.y + j * p.h / SCOPE_ROWS, p.x + p.w, p.y + j * p.h / SCOPE_ROWS, grid * (j * 2 === SCOPE_ROWS ? 1.25 : .46));
    for (let i = 0; i <= SCOPE_COLUMNS * 5; i++) {
      const x = p.x + i * p.w / (SCOPE_COLUMNS * 5);
      rule(ctx, x, cy - 4, x, cy + 4, grid * 1.25);
    }
    if (!showLabels()) return;
    text(ctx, spaced('PHOSPHOR ATLAS'), LEFT, .052 * H, { color: colors.text, size: 18 });
    text(ctx, hasAudio ? `SCOPE + TELEMETRY  /  ${(sampleRate / 1000).toFixed(1)} kHz` : 'AN AUDIOVISUAL INSTRUMENT', RIGHT, .051 * H, { align: 'right', size: 10 });
    if (settings.headers !== false) {
      text(ctx, header(sectionOrder === 'scope-telemetry' ? '01' : '02', 'PHOSPHOR SCOPE'), LEFT, scopeHeaderY, { color: colors.text, size: 18 });
      text(ctx, header(sectionOrder === 'scope-telemetry' ? '02' : '01', 'TELEMETRY WALL'), LEFT, telemetryHeaderY, { color: colors.text, size: 18 });
    }
    text(ctx, `${TELEMETRY_CHANNELS.length} CHANNELS · ${sparkSeconds()}-SECOND SPARKLINES`, RIGHT, telemetryHeaderY, { size: 10, align: 'right' });
    text(ctx, '+1', p.x + 6, p.y + 14, { size: 9 });
    text(ctx, '−1', p.x + 6, p.y + p.h - 6, { size: 9 });
    const ms = windowMs(), step = ms > 60 ? 10 : 5;
    for (let m = 0; m < ms - step * .6; m += step) text(ctx, m ? `${m}` : '0 ms', p.x + m / ms * p.w, p.y + p.h + 20, { size: 10, align: m ? 'center' : 'left' });
    text(ctx, `${ms} ms`, p.x + p.w, p.y + p.h + 20, { size: 10, align: 'right' });
    for (const tile of tiles) {
      text(ctx, tile.channel.label, tile.x + TILE.pad, tile.y + TILE.label, { size: 10 });
      text(ctx, tile.channel.unit, tile.x + TILE.pad, tile.y + TILE.unit, { size: 9 });
    }
  }

  function scopeMetaText() {
    const gain = `${settings.scopeAutoGain === false ? 'MANUAL' : 'AUTO'} GAIN ×${scopeState.gain.toFixed(1)}`;
    return `RISING-EDGE TRIGGER · ${windowMs()} ms · ${Math.round(settings.scopeTraces ?? 10)} TRACES · ${gain}`;
  }

  function drawLabels(time, analysis, readouts) {
    const hasAudio = Boolean(analysis?.buffer || analysis?.duration > 0);
    const duration = hasAudio ? analysis.duration : 0;
    const timeOptions = { forceHours: duration >= 3600 };
    const elapsedText = formatTrackTime(hasAudio ? time : 0, timeOptions);
    const remainingText = `−${formatTrackTime(hasAudio ? duration - time : 0, timeOptions)}`;
    const progressText = hasAudio ? `${(clamp(time / duration) * 100).toFixed(1)}%` : '—';
    const markers = settings.setlist || [];
    let active = -1;
    for (let i = 0; i < markers.length; i++) if (markers[i].time <= time) active = i;
    const settingsKey = `${sectionOrder}|${settings.labels}|${settings.headers}|${settings.sectionNumbers}|${settings.gridOpacity}|${colorsKey}|${windowMs()}|${sparkSeconds()}`;
    const markerKey = markers.map(marker => marker.time).join(',');
    const markerSize = Math.max(4, Math.min(24, Number.isFinite(settings.markerSize) ? settings.markerSize : 10));
    const metaText = scopeMetaText();
    labelState = { time, duration, hasAudio, elapsedText, remainingText, progressText, scopeMeta: metaText,
      markerCount: hasAudio ? markers.length : 0, activeMarker: active, markerSize };
    for (const layer of layers) {
      const key = layer.name === 'charts' ? `${settingsKey}|${sampleRate}|${hasAudio}`
        : layer.name === 'scopeMeta' ? `${settingsKey}|${metaText}`
        : layer.name === 'values' ? `${settingsKey}|${readouts.join('|')}`
        : layer.name === 'overviewHeader' ? `${settingsKey}|${progressText}`
        : layer.name === 'overviewFooter' ? `${settingsKey}|${elapsedText}|${remainingText}`
        : `${settingsKey}|${duration}|${markerKey}|${active}|${markerSize}`;
      if (key === layer.key) continue;
      layer.key = key;
      const { ctx, canvas, rect } = layer;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(canvas.width / (rect.w * W), canvas.height / (rect.h * H));
      ctx.translate(-rect.x * W, -rect.y * H);
      if (layer.name === 'charts') drawChartLabels(ctx, hasAudio);
      else if (layer.name === 'scopeMeta') {
        if (showLabels()) text(ctx, metaText, RIGHT, scopeHeaderY, { size: 10, align: 'right' });
      } else if (layer.name === 'values') {
        if (showLabels()) tiles.forEach((tile, i) => text(ctx, readouts[i], tile.x + TILE.pad, tile.y + TILE.value,
          { size: tile.channel.text ? TILE.textSize : TILE.valueSize, color: colors.text }));
      } else if (layer.name === 'overviewHeader') {
        if (showLabels()) {
          if (settings.headers !== false) text(ctx, header('03', 'TRACK OVERVIEW'), LEFT, .538 * H, { color: colors.text, size: 18 });
          text(ctx, progressText, RIGHT, .538 * H, { color: colors.text, size: 18, align: 'right' });
        }
      } else if (layer.name === 'overviewFooter') {
        if (showLabels()) {
          text(ctx, elapsedText, LEFT, .73 * H, { color: colors.text, size: 18 });
          text(ctx, remainingText, RIGHT, .73 * H, { color: colors.text, size: 18, align: 'right' });
        }
      } else if (hasAudio && markers.length) {
        // Track-start carets remain visible even with text labels hidden.
        const box = rectToWorld(RECTS.overview, 16 / 9);
        const tipY = (RECTS.overview.y + RECTS.overview.h) * H - 5;
        const halfWidth = markerSize / 2, markerHeight = markerSize * .65;
        for (let i = 0; i < markers.length; i++) {
          const marker = markers[i];
          if (marker.time < 0 || marker.time >= duration) continue;
          const x = (box.left + 50 + marker.time / duration * box.width) * 19.2;
          ctx.globalAlpha = i === active ? 1 : marker.time < time ? .65 : .9;
          ctx.fillStyle = i === active ? colors.text : colors.low;
          ctx.beginPath();
          ctx.moveTo(x, tipY);
          ctx.lineTo(x + halfWidth, tipY + markerHeight);
          ctx.lineTo(x - halfWidth, tipY + markerHeight);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
      layer.texture.needsUpdate = true;
      layer.uploads++;
    }
  }

  function updateScope(time, analysis) {
    const channels = analysis?.channels;
    const hide = () => {
      for (const strip of [scopeGlow, scopeCore, ...phosphor]) strip.geometry.setDrawRange(0, 0);
      scopeState = { windowMs: windowMs(), span: 0, gain: 1, triggers: [], points: 0 };
    };
    if (!channels?.length || !analysis.sampleRate) { hide(); return; }
    const left = channels[0], right = channels[1] || channels[0], rate = analysis.sampleRate;
    const span = scopeSpan(windowMs(), rate);
    const count = clamp(Math.round(settings.scopeTraces ?? 10), 1, SCOPE_MAX_TRACES);
    const traces = scopeTraces(left, right, rate, time, { span, traces: count });
    const gain = settings.scopeAutoGain === false ? clamp(Number(settings.scopeGain) || 1, .25, 16) : scopeAutoGain(left, right, Math.round(time * rate), rate);
    const cy = scope.y + scope.h / 2, amplitude = scope.h / 2 * SCOPE_AMPLITUDE, thickness = clamp(Number(settings.scopeThickness) || 1.7, .5, 6);
    for (const strip of [scopeGlow, scopeCore, ...phosphor]) strip.geometry.setDrawRange(0, 0);
    let points = 0;
    for (const trace of traces) {
      const { values, count: n, step } = scopeSamples(left, right, trace.start, span, scratch);
      const run = new Array(n);
      for (let i = 0; i < n; i++) run[i] = [scope.x + i * step / span * scope.w, cy - clamp(values[i] * gain, -1.05, 1.05) * amplitude];
      points = Math.max(points, n);
      if (trace.age === 0) {
        writeRuns(scopeCore, [run], { width: thickness });
        const glow = clamp(Number(settings.scopeGlow ?? .16), 0, 1);
        scopeGlow.mesh.visible = glow > 0;
        scopeGlow.material.opacity = glow;
        writeRuns(scopeGlow, [run], { width: thickness * 4.1 });
      } else {
        const strip = phosphor[trace.age - 1];
        strip.material.opacity = .55 * (1 - trace.age / count) ** 2;
        writeRuns(strip, [run], { width: 1.2 });
      }
    }
    scopeState = { windowMs: windowMs(), span, gain, triggers: traces.map(trace => trace.start), points, traces: traces.length };
  }

  function updateTelemetry(time, analysis) {
    const frame = Math.min(latestFrame, Math.max(0, Math.floor(time * FPS + 1e-7)));
    const seconds = sparkSeconds(), span = seconds * FPS;
    const context = { bpm: analysis?.bpm };
    const readRow = readoutFrame(frame);
    const readouts = [];
    const grid = (settings.gridOpacity ?? .24) / .24;
    telemetryState = [];
    tiles.forEach(tile => {
      const { channel } = tile;
      const row = history.get(readRow) || history.get(frame) || null;
      readouts.push(latestFrame >= 0 ? telemetryReadout(channel, row) : '—');
      const sx0 = tile.x + TILE_W * TILE.sparkLeft, sx1 = tile.x + TILE_W - TILE.pad;
      const sy0 = tile.y + TILE.sparkTop, sy1 = tile.y + TILE_H - TILE.sparkBottom;
      const sources = channel.series || [channel.value];
      const palette = channel.series ? bandColors() : [colors[channel.color] || colors.text];
      sources.forEach((source, s) => {
        const valueAt = f => { const r = history.get(f); return r ? source(r) : NaN; };
        const samples = latestFrame >= 0 ? sparklineSamples(valueAt, frame, seconds, { reduce: channel.reduce }) : [];
        const runs = [];
        let run = [];
        for (const sample of samples) {
          if (!Number.isFinite(sample.value)) { if (run.length) runs.push(run); run = []; continue; }
          run.push([sx1 - (frame - sample.frame) / span * (sx1 - sx0), sy1 - telemetryNorm(channel, sample.value, context) * (sy1 - sy0)]);
        }
        if (run.length) runs.push(run);
        const series = tile.series[s];
        writeRuns(series.area, runs, { baseline: sy1 });
        writeRuns(series.line, runs, { width: channel.series ? 1.4 : 1.6 });
        const last = samples.at(-1);
        writeDisk(series.head, last && Number.isFinite(last.value) ? runs.at(-1).at(-1) : null, 2.6);
        for (const part of [series.area, series.line, series.head]) part.material.color.set(palette[s]);
      });
      const age = settings.alerts === false || latestFrame < 0 ? Infinity
        : alertAge(channel, f => { const r = history.get(f); return r ? channel.value(r) : NaN; }, frame);
      const flash = alertFlash(age), alerting = flash > .05;
      tile.fill.material.color.set(alerting ? colors.mid : colors.guides);
      tile.fill.material.opacity = .035 + .08 * flash;
      tile.border.material.color.set(alerting ? colors.mid : colors.guides);
      tile.border.material.opacity = clamp(.2 * grid + .8 * flash);
      tile.dot.material.color.set(alerting ? colors.mid : colors.low);
      tile.dot.material.opacity = .5 + .5 * Math.max(flash, .4);
      telemetryState.push({ id: channel.id, readout: readouts.at(-1), flash });
    });
    return { readouts, readRow };
  }

  function updateColors() {
    const nextKey = [settings.colorLow, settings.colorMid, settings.colorHigh, settings.colorText, settings.colorGuides].join('|');
    if (nextKey === colorsKey) return;
    colorsKey = nextKey;
    colors = resolveColors();
    minimap.setColors({ color: colors.text, playedColor: colors.low, playheadColor: colors.text });
    scopeGlow.material.color.set(colors.low);
    scopeCore.material.color.set(colors.text);
    for (const strip of phosphor) strip.material.color.set(colors.low);
  }

  function resize(w, h, pixelRatio = Math.max(1, window.devicePixelRatio || 1)) {
    width = Math.max(2, Math.round(w)); height = Math.max(2, Math.round(h)); ratio = Math.max(.1, pixelRatio);
    aspect = width / height;
    renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    camera.top = 50 / aspect; camera.bottom = -50 / aspect; camera.updateProjectionMatrix();
    charts.position.set(-50, 50 / aspect, 0);
    charts.scale.set(100 / W, -100 / aspect / H, 1);
    minimap.layout(aspect); minimap.setResolution(width, height, ratio);
    resizeLabels();
  }

  function render({ time = 0, analysis = null } = {}) {
    if (disposed) return;
    lastTime = Math.max(0, Number.isFinite(time) ? time : 0);
    sampleRate = analysis?.sampleRate || sampleRate;
    updateLayout();
    updateColors();
    updateScope(lastTime, analysis);
    const { readouts } = updateTelemetry(lastTime, analysis);
    drawLabels(lastTime, analysis, readouts);
    minimap.update({ progress: analysis?.duration ? clamp(lastTime / analysis.duration) : 0 });
    renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(BLACK, 1); renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    renderer.setScissor(0, height * .25, width, height * .75);
    renderer.clearDepth(); renderer.render(scene, camera); renderer.setScissorTest(false);
  }

  function setHistoryFrames(rows) {
    for (const row of rows || []) {
      if (!Number.isFinite(row?.frame) || !Array.isArray(row.bands) || !('loudness' in row)) continue;
      history.set(row.frame, row);
      latestFrame = Math.max(latestFrame, row.frame);
    }
    const first = latestFrame - KEEP_FRAMES;
    for (const frame of history.keys()) if (frame < first) history.delete(frame);
  }

  function resetHistory() {
    history.clear();
    latestFrame = -1;
  }

  function dispose() {
    disposed = true;
    minimap.dispose();
    for (const { geometry, material: mat } of resources) { geometry.dispose(); mat.dispose(); }
    for (const layer of layers) { layer.mesh.geometry.dispose(); layer.material.dispose(); layer.texture?.dispose(); }
    renderer.dispose(); renderer.domElement.remove(); history.clear();
  }

  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  minimap.setPeaks(new Float32Array(1));
  return {
    canvas: renderer.domElement, resize, render, setHistoryFrames, resetHistory, dispose,
    setOverview(peaks, rmsPeaks) { minimap.setPeaks(peaks, rmsPeaks); for (const layer of layers) layer.key = ''; },
    setSampleRate(value) { if (Number.isFinite(value) && value > 0) sampleRate = value; },
    getInfo: () => ({
      canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio,
      sectionOrder, rectangles: { ...RECTS, scope: { ...RECTS.scope, y: scope.y / H },
        telemetry: { ...RECTS.telemetry, y: tiles[0].y / H } }, reservedTextFraction: .25, background: '#000000',
      historyFrames: history.size, latestFrame, lastTime, retainedHistorySeconds: HISTORY_SECONDS,
      scope: { ...scopeState, triggers: [...scopeState.triggers] }, telemetry: telemetryState.map(tile => ({ ...tile })),
      sparkSeconds: sparkSeconds(), colors: { ...colors }, drawCalls: renderer.info.render.calls,
      labelFont: 'Inter', fontLoaded: document.fonts.check('500 11px "Inter"'), labelState,
      labelLayers: layers.map(layer => ({ name: layer.name, width: layer.canvas.width, height: layer.canvas.height, uploads: layer.uploads })),
    }),
  };
}

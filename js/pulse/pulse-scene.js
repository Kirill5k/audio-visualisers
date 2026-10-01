import * as THREE from 'three';
import { createWaveformMinimap, rectToWorld } from '../monitor-charts.js';
import { formatTrackTime } from '../atlas/signal-atlas-setlist.js';
import { createCardiogramPath, pulseHistorySeconds, pulseTraceSettings } from './pulse-trace-math.js';

const FPS = 60;
const HISTORY_SECONDS = 60;
const SMOOTH_RADIUS = 12;
const KEEP_FRAMES = HISTORY_SECONDS * FPS + SMOOTH_RADIUS * 2 + FPS;
const MAX_POINTS = HISTORY_SECONDS * FPS + 4;
const BLACK = new THREE.Color('#000000');
const FONT = '"Inter", sans-serif';
const RECTS = Object.freeze({
  rhythm: { x: .06, y: .10, w: .416, h: .37 },
  energy: { x: .524, y: .10, w: .416, h: .37 },
  overview: { x: .06, y: .56, w: .88, h: .14 },
  textReserve: { x: 0, y: .75, w: 1, h: .25 },
});
const RHYTHM = { x: .124 * 1920, y: .158 * 1080, w: .352 * 1920, h: .284 * 1080 };
const ENERGY = { x: .55 * 1920, y: .166 * 1080, w: .39 * 1920, h: .276 * 1080 };
const clamp = value => Math.max(0, Math.min(1, value));
const valueOf = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const colorSetting = (settings, key, fallback) => /^#[\da-f]{6}$/i.test(settings[key]) ? settings[key] : fallback;
const DEFAULT_BANDS = [{ min: 40, max: 120 }, { min: 180, max: 1200 }, { min: 6000, max: 14000 }];

/** Two live charts and a reflected bar waveform. All drawing shares
 * the capture canvas; the last quarter is also protected by a hard scissor. */
export function createPulseAtlasScene(stage, settings = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setClearColor(BLACK, 1);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Rhythm lanes and energy ribbons above track overview; lower quarter reserved for titles');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 50 / (16 / 9), -50 / (16 / 9), -10, 10);
  camera.position.z = 5;
  // Chart geometry uses a fixed 1920 × 1080 design coordinate system.
  const charts = new THREE.Group();
  scene.add(charts);
  let width = 1920, height = 1080, ratio = 1, aspect = 16 / 9;
  let disposed = false, sampleRate = 48000, colorsKey = '', latestFrame = -1;
  let historyVersion = 0, renderedVersion = -1, lastGeometryKey = '', lastTime = 0;
  let labelState = null, pathChecksums = { rhythm: [0, 0, 0], energy: [0, 0, 0] };
  let headPositions = [], analysisBands = null;
  let colors = resolveColors();
  const history = new Map();
  const smoothed = new Map();
  const meshResources = [];
  let visibleHistoryFrames = 0;

  function resolveColors() {
    return {
      bands: [colorSetting(settings, 'colorLow', '#68c8bd'), colorSetting(settings, 'colorMid', '#e3ad73'), colorSetting(settings, 'colorHigh', '#aaa3d7')],
      text: colorSetting(settings, 'colorText', '#eee9df'),
      guides: colorSetting(settings, 'colorGuides', '#8f999a'),
      overview: colorSetting(settings, 'colorText', '#eee9df'), played: colorSetting(settings, 'colorLow', '#68c8bd'),
    };
  }

  function makeMesh(vertexCount, color, opacity, order, indexed = false) {
    const positions = new Float32Array(vertexCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    if (indexed) {
      const indices = new Uint16Array((vertexCount / 2 - 1) * 6);
      for (let i = 0; i < vertexCount / 2 - 1; i++) {
        const j = i * 2, k = i * 6;
        indices.set([j, j + 1, j + 2, j + 1, j + 3, j + 2], k);
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({ color, opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    charts.add(mesh);
    const resource = { mesh, geometry, positions, material };
    meshResources.push(resource);
    return resource;
  }

  const rhythm = colors.bands.map(color => ({
    glow: makeMesh(MAX_POINTS * 2, color, .14, 11, true),
    line: makeMesh(MAX_POINTS * 2, color, .96, 12, true),
    headHalo: makeMesh(36, color, .07, 13),
    headGlow: makeMesh(36, color, .22, 14),
    head: makeMesh(36, color, 1, 15),
    headCore: makeMesh(36, '#ffffff', .95, 16),
  }));
  for (const lane of rhythm) lane.glow.material.blending = THREE.AdditiveBlending;
  const energy = colors.bands.map(color => ({
    fill: makeMesh(MAX_POINTS * 2, color, .10, 15, true),
    line: makeMesh(MAX_POINTS * 2, color, .97, 16, true),
    dot: makeMesh(36, color, 1, 17),
  }));
  const minimap = createWaveformMinimap(scene, RECTS.overview, {
    color: colors.overview, playedColor: colors.played, playheadColor: colors.overview,
    style: 'reflected-bars', barWidth: 2.3, barGap: .55,
  });

  // Only these narrow overlays ever upload canvas textures. Neither curves nor
  // the waveform use a canvas upload during playback, including at 4K.
  const layers = [
    makeLabelLayer('charts', { x: .05, y: .032, w: .9, h: .455 }),
    makeLabelLayer('overviewHeader', { x: .06, y: .51, w: .88, h: .04 }),
    makeLabelLayer('overviewMarkers', RECTS.overview),
    makeLabelLayer('overviewFooter', { x: .055, y: .704, w: .89, h: .037 }),
  ];

  function makeLabelLayer(name, rect) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = 100;
    scene.add(mesh);
    return { name, rect, canvas, ctx, material, mesh, texture: null, key: '', uploads: 0 };
  }

  function resizeLabels() {
    for (const layer of layers) {
      const { canvas, rect, mesh, material } = layer;
      const w = Math.max(1, Math.round(width * ratio * rect.w));
      const h = Math.max(1, Math.round(height * ratio * rect.h));
      if (w !== canvas.width || h !== canvas.height || !layer.texture) {
        canvas.width = w; canvas.height = h;
        layer.texture?.dispose();
        layer.texture = new THREE.CanvasTexture(canvas);
        layer.texture.colorSpace = THREE.SRGBColorSpace;
        layer.texture.minFilter = THREE.LinearFilter;
        layer.texture.generateMipmaps = false;
        material.map = layer.texture;
        material.needsUpdate = true;
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

  function rule(ctx, x1, y1, x2, y2, color = colors.guides, alpha = settings.gridOpacity ?? .24, lineWidth = .75) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function displayedBands() {
    return analysisBands || settings.bands || DEFAULT_BANDS;
  }

  function formatBand(band) {
    const { min, max } = displayedBands()[band] || DEFAULT_BANDS[band];
    const upper = Math.min(max, sampleRate / 2);
    const khz = value => (value / 1000).toFixed(1).replace(/\.0$/, '');
    return min < 1000 ? `${min}–${upper} Hz` : `${khz(min)}–${khz(upper)} kHz`;
  }

  function timeGrid(ctx, plot, seconds, head = 1) {
    for (let tick = 0; tick <= 5; tick++) {
      const ago = seconds * (1 - tick / 5);
      const x = plot.x + tick / 5 * plot.w * head;
      rule(ctx, x, plot.y, x, plot.y + plot.h, colors.guides, (settings.gridOpacity ?? .24) * (ago === 0 ? 1.25 : .7));
      if (settings.labels !== false) text(ctx, ago === 0 ? 'NOW' : `−${Number(ago.toFixed(1))}s`, x, .469 * 1080, {
        size: 11, align: ago === seconds ? 'left' : ago === 0 ? 'right' : 'center',
        color: ago === 0 ? colors.text : colors.guides,
      });
    }
  }

  function drawChartLabels(ctx, hasAudio) {
    const seconds = pulseHistorySeconds(settings);
    const trace = pulseTraceSettings(settings);
    rule(ctx, .06 * 1920, .073 * 1080, .94 * 1920, .073 * 1080);
    timeGrid(ctx, RHYTHM, seconds, trace.head);
    timeGrid(ctx, ENERGY, seconds);
    for (let percent = 0; percent <= 100; percent += 25) {
      const y = ENERGY.y + ENERGY.h * (1 - percent / 100);
      rule(ctx, ENERGY.x, y, ENERGY.x + ENERGY.w, y, colors.guides, (settings.gridOpacity ?? .24) * (percent ? .7 : 1));
      if (settings.labels !== false) text(ctx, `${percent}`, ENERGY.x - 12, y + 4, { size: 10, align: 'right' });
    }
    ['LOW', 'MID', 'HIGH'].forEach((name, band) => {
      const top = RHYTHM.y + band * RHYTHM.h / 3;
      const baseline = top + RHYTHM.h / 3 * (.5 - trace.baseline * .42);
      rule(ctx, RHYTHM.x, baseline, RHYTHM.x + RHYTHM.w, baseline, colors.bands[band], (settings.gridOpacity ?? .24) * .84);
      if (band < 2) rule(ctx, .06 * 1920, top + RHYTHM.h / 3, .476 * 1920, top + RHYTHM.h / 3, colors.guides, (settings.gridOpacity ?? .24) * .6);
      if (settings.labels === false) return;
      text(ctx, name, .06 * 1920, top + 34, { color: colors.bands[band], size: 13 });
      text(ctx, formatBand(band), .06 * 1920, top + 53, { size: 9.2 });
      const x = ENERGY.x + band * 145;
      rule(ctx, x, .14 * 1080 - 4, x + 17, .14 * 1080 - 4, colors.bands[band], 1, 2);
      text(ctx, name, x + 25, .14 * 1080, { color: colors.bands[band], size: 11 });
    });
    if (settings.labels === false) return;
    text(ctx, 'P U L S E   A T L A S', .06 * 1920, .052 * 1080, { color: colors.text, size: 18 });
    text(ctx, hasAudio ? `STEREO STUDY  /  ${(sampleRate / 1000).toFixed(1)} kHz` : 'AN AUDIOVISUAL INSTRUMENT', .94 * 1920, .051 * 1080, { align: 'right', size: 10 });
    if (settings.headers !== false) {
      text(ctx, `${settings.sectionNumbers === false ? '' : '01   '}RHYTHM LANES`, .06 * 1920, .106 * 1080, { color: colors.text });
      text(ctx, `${settings.sectionNumbers === false ? '' : '02   '}ENERGY RIBBONS`, .524 * 1920, .106 * 1080, { color: colors.text });
    }
    text(ctx, `${seconds}-SECOND HISTORY`, .476 * 1920, .106 * 1080, { size: 10, align: 'right' });
    text(ctx, `${seconds}-SECOND HISTORY`, .94 * 1920, .106 * 1080, { size: 10, align: 'right' });
    text(ctx, 'RHYTHM TRACES', .06 * 1920, .14 * 1080, { size: 10 });
    text(ctx, 'BAND ENERGY', .94 * 1920, .14 * 1080, { size: 10, align: 'right' });
  }

  function drawLabels(time, analysis) {
    const hasAudio = Boolean(analysis?.buffer || analysis?.duration > 0);
    const duration = hasAudio ? analysis.duration : 0;
    const timeOptions = { forceHours: duration >= 3600 };
    const elapsedText = formatTrackTime(hasAudio ? time : 0, timeOptions);
    const remainingText = `−${formatTrackTime(hasAudio ? duration - time : 0, timeOptions)}`;
    const progressText = hasAudio ? `${(clamp(time / duration) * 100).toFixed(1)}%` : '—';
    const markers = settings.setlist || [];
    let active = -1;
    for (let i = 0; i < markers.length; i++) if (markers[i].time <= time) active = i;
    const settingsKey = `${settings.labels}|${settings.headers}|${settings.sectionNumbers}|${settings.gridOpacity}|${colorsKey}|${pulseHistorySeconds(settings)}|${settings.head}|${settings.baseline}|${JSON.stringify(displayedBands())}`;
    const markerKey = markers.map(marker => marker.time).join(',');
    labelState = { time, duration, hasAudio, elapsedText, remainingText, markerCount: hasAudio ? markers.length : 0, activeMarker: active };
    for (const layer of layers) {
      const key = layer.name === 'charts' ? `${settingsKey}|${sampleRate}|${hasAudio}`
        : layer.name === 'overviewHeader' ? `${settingsKey}|${progressText}`
        : layer.name === 'overviewFooter' ? `${settingsKey}|${elapsedText}|${remainingText}`
        : `${settingsKey}|${duration}|${markerKey}|${active}`;
      if (key === layer.key) continue;
      layer.key = key;
      const { ctx, canvas, rect } = layer;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(canvas.width / (rect.w * 1920), canvas.height / (rect.h * 1080));
      ctx.translate(-rect.x * 1920, -rect.y * 1080);
      if (layer.name === 'charts') drawChartLabels(ctx, hasAudio);
      else if (layer.name === 'overviewHeader') {
        if (settings.labels !== false) {
          if (settings.headers !== false) text(ctx, `${settings.sectionNumbers === false ? '' : '03   '}TRACK OVERVIEW`, .06 * 1920, .538 * 1080, { color: colors.text });
          text(ctx, progressText, .94 * 1920, .538 * 1080, { color: colors.text, align: 'right' });
        }
      } else if (layer.name === 'overviewFooter') {
        if (settings.labels !== false) {
          text(ctx, elapsedText, .06 * 1920, .73 * 1080, { color: colors.text, size: 18 });
          text(ctx, remainingText, .94 * 1920, .73 * 1080, { color: colors.text, size: 18, align: 'right' });
        }
      } else {
        // Optional setlist starts are plain ticks, without icons or timestamps.
        if (hasAudio && markers.length) {
          const box = rectToWorld(RECTS.overview, 16 / 9);
          const baseline = (50 / (16 / 9) - box.bottom - box.height * .27) * 19.2;
          ctx.lineWidth = 1;
          for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            if (marker.time < 0 || marker.time >= duration) continue;
            const x = (box.left + 50 + marker.time / duration * box.width) * 19.2;
            ctx.globalAlpha = i === active ? 1 : marker.time < time ? .45 : .8;
            ctx.strokeStyle = i === active ? colors.overview : colors.played;
            ctx.beginPath(); ctx.moveTo(x, baseline - 3); ctx.lineTo(x, baseline + 4); ctx.stroke();
          }
        }
      }
      ctx.restore();
      layer.texture.needsUpdate = true;
      layer.uploads++;
    }
  }

  function setHistoryFrames(rows) {
    for (const row of rows || []) {
      if (!Number.isFinite(row?.frame) || !row.bands || !row.flux) continue;
      history.set(row.frame, row);
      smoothed.delete(row.frame);
      latestFrame = Math.max(latestFrame, row.frame);
    }
    const first = latestFrame - KEEP_FRAMES;
    for (const frame of history.keys()) if (frame < first) { history.delete(frame); smoothed.delete(frame); }
    historyVersion++;
  }

  function smooth(frame) {
    if (smoothed.has(frame)) return smoothed.get(frame);
    const result = [0, 0, 0];
    let weights = 0;
    // A fixed causal triangle is identical during playback, seek and export.
    // Its 24-frame warm-up is provided by the player's reconstruction padding.
    for (let ago = 0; ago <= SMOOTH_RADIUS * 2; ago++) {
      const weight = SMOOTH_RADIUS + 1 - Math.abs(ago - SMOOTH_RADIUS);
      const row = history.get(frame - ago);
      weights += weight;
      for (let band = 0; band < 3; band++) result[band] += valueOf(row?.bands[band]) * weight;
    }
    for (let band = 0; band < 3; band++) result[band] /= weights;
    smoothed.set(frame, result);
    return result;
  }

  function updateStrip(resource, points, baseline, lineWidth = 0) {
    const { positions, geometry } = resource;
    const count = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < count; i++) {
      const point = points[i];
      const k = i * 6;
      if (lineWidth) {
        const before = points[Math.max(0, i - 1)], after = points[Math.min(count - 1, i + 1)];
        const dx = after[0] - before[0], dy = after[1] - before[1];
        const length = Math.hypot(dx, dy) || 1;
        const px = -dy / length * lineWidth / 2, py = dx / length * lineWidth / 2;
        positions[k] = point[0] + px; positions[k + 1] = point[1] + py;
        positions[k + 3] = point[0] - px; positions[k + 4] = point[1] - py;
      } else {
        positions[k] = point[0]; positions[k + 1] = point[1];
        positions[k + 3] = point[0]; positions[k + 4] = baseline;
      }
    }
    geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    geometry.attributes.position.needsUpdate = true;
  }

  function disk(resource, offset, x, y, radius) {
    const { positions } = resource;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6;
      const k = (offset + i * 3) * 3;
      positions[k] = x; positions[k + 1] = y;
      positions[k + 3] = x + Math.cos(a) * radius; positions[k + 4] = y + Math.sin(a) * radius;
      positions[k + 6] = x + Math.cos(b) * radius; positions[k + 7] = y + Math.sin(b) * radius;
    }
    return offset + 36;
  }

  function updateCurves(time) {
    const seconds = pulseHistorySeconds(settings);
    const trace = pulseTraceSettings(settings);
    const key = `${time}|${settings.energyGain}|${JSON.stringify(trace)}`;
    if (key === lastGeometryKey && renderedVersion === historyVersion) return;
    lastGeometryKey = key; renderedVersion = historyVersion;
    const rows = [...history.values()].filter(row => row.time >= time - seconds - 1e-7 && row.time <= time + 1e-7).sort((a, b) => a.frame - b.frame);
    visibleHistoryFrames = rows.length;
    let maxPower = 0;
    for (const row of rows) for (let band = 0; band < 3; band++) {
      maxPower = Math.max(maxPower, valueOf(row.bands[band]));
    }
    const energyScale = maxPower > 1e-16 ? valueOf(settings.energyGain ?? 1) / maxPower : 0;
    pathChecksums = { rhythm: [0, 0, 0], energy: [0, 0, 0] };
    headPositions = [];
    for (let band = 0; band < 3; band++) {
      const path = createCardiogramPath(history, time, band, settings, RHYTHM, { latestFrame });
      const points = rows.length ? path.points : [];
      const lane = rhythm[band];
      updateStrip(lane.line, points, 0, Math.max(.001, trace.thickness));
      updateStrip(lane.glow, points, 0, Math.max(.001, trace.thickness * 4.5));
      lane.line.mesh.visible = trace.thickness > 0;
      lane.glow.mesh.visible = trace.thickness > 0 && trace.glow > 0;
      lane.glow.material.opacity = trace.glow;
      const head = rows.length ? path.head : null;
      headPositions.push(head ? { x: head[0], y: head[1], normalizedX: head[0] / 1920, normalizedY: head[1] / 1080 } : null);
      for (const [resource, radius] of [[lane.headHalo, 8.5], [lane.headGlow, 5.5], [lane.head, 3.0], [lane.headCore, 1.25]]) {
        resource.geometry.setDrawRange(0, head ? disk(resource, 0, head[0], head[1], radius) : 0);
        resource.geometry.attributes.position.needsUpdate = true;
      }
      for (let i = 0; i < points.length; i++) pathChecksums.rhythm[band] += points[i][1] * (i + 1);
      const energyPoints = rows.map(row => [
        ENERGY.x + clamp((row.time - time + seconds) / seconds) * ENERGY.w,
        ENERGY.y + ENERGY.h * (1 - clamp(smooth(row.frame)[band] * energyScale)),
      ]);
      updateStrip(energy[band].fill, energyPoints, ENERGY.y + ENERGY.h);
      updateStrip(energy[band].line, energyPoints, ENERGY.y + ENERGY.h, 2.15);
      const endpoint = energyPoints.at(-1);
      energy[band].dot.geometry.setDrawRange(0, endpoint ? disk(energy[band].dot, 0, endpoint[0], endpoint[1], 2.7) : 0);
      energy[band].dot.geometry.attributes.position.needsUpdate = true;
      for (let i = 0; i < energyPoints.length; i++) pathChecksums.energy[band] += energyPoints[i][1] * (rows[i].frame + 1);
    }
  }

  function updateColors() {
    const nextKey = [settings.colorLow, settings.colorMid, settings.colorHigh, settings.colorText, settings.colorGuides].join('|');
    if (nextKey === colorsKey) return;
    colorsKey = nextKey;
    colors = resolveColors();
    minimap.setColors({ color: colors.overview, playedColor: colors.played, playheadColor: colors.overview });
    for (let band = 0; band < 3; band++) {
      for (const [name, resource] of Object.entries(rhythm[band])) resource.material.color.set(name === 'headCore' ? '#ffffff' : colors.bands[band]);
      for (const resource of Object.values(energy[band])) resource.material.color.set(colors.bands[band]);
    }
  }

  function resize(w, h, pixelRatio = Math.max(1, window.devicePixelRatio || 1)) {
    width = Math.max(2, Math.round(w)); height = Math.max(2, Math.round(h)); ratio = Math.max(.1, pixelRatio);
    aspect = width / height;
    renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    camera.top = 50 / aspect; camera.bottom = -50 / aspect; camera.updateProjectionMatrix();
    charts.position.set(-50, 50 / aspect, 0);
    charts.scale.set(100 / 1920, -100 / aspect / 1080, 1);
    minimap.layout(aspect); minimap.setResolution(width, height, ratio);
    resizeLabels();
  }

  function render({ time = 0, analysis = null } = {}) {
    if (disposed) return;
    lastTime = Math.max(0, Number.isFinite(time) ? time : 0);
    sampleRate = analysis?.sampleRate || sampleRate;
    analysisBands = analysis?.getInfo?.().bands || null;
    updateColors(); updateCurves(lastTime); drawLabels(lastTime, analysis);
    minimap.update({ progress: analysis?.duration ? clamp(lastTime / analysis.duration) : 0 });
    renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height);
    renderer.setClearColor(BLACK, 1); renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    renderer.setScissor(0, height * .25, width, height * .75);
    renderer.clearDepth(); renderer.render(scene, camera); renderer.setScissorTest(false);
  }

  function resetHistory() {
    history.clear(); smoothed.clear(); latestFrame = -1; historyVersion++;
    lastGeometryKey = ''; visibleHistoryFrames = 0;
  }

  function dispose() {
    disposed = true;
    minimap.dispose();
    for (const { geometry, material } of meshResources) { geometry.dispose(); material.dispose(); }
    for (const layer of layers) { layer.mesh.geometry.dispose(); layer.material.dispose(); layer.texture?.dispose(); }
    renderer.dispose(); renderer.domElement.remove(); history.clear(); smoothed.clear();
  }

  resize(stage.clientWidth || 1920, stage.clientHeight || 1080);
  minimap.setPeaks(new Float32Array(1));
  return {
    canvas: renderer.domElement, resize, render, setHistoryFrames, resetHistory, dispose,
    setOverview(peaks, rmsPeaks) { minimap.setPeaks(peaks, rmsPeaks); for (const layer of layers) layer.key = ''; },
    setSampleRate(value) { if (Number.isFinite(value) && value > 0) sampleRate = value; },
    getInfo: () => ({
      canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio,
      rectangles: RECTS, reservedTextFraction: .25, background: '#000000',
      historyFrames: history.size, visibleHistoryFrames, latestFrame,
      firstFrame: history.size ? Math.min(...history.keys()) : null,
      firstTime: history.size ? Math.min(...[...history.values()].map(row => row.time)) : null,
      lastTime, historySeconds: pulseHistorySeconds(settings), retainedHistorySeconds: HISTORY_SECONDS, smoothingFrames: SMOOTH_RADIUS * 2 + 1,
      rhythmSeconds: pulseHistorySeconds(settings), energySeconds: pulseHistorySeconds(settings),
      bands: displayedBands().map(band => ({ ...band })), traceSettings: pulseTraceSettings(settings), headPositions,
      pathChecksums, colors: { ...colors, bands: [...colors.bands] }, drawCalls: renderer.info.render.calls,
      labelFont: 'Inter', fontLoaded: document.fonts.check('500 11px "Inter"'), labelState,
      labelLayers: layers.map(layer => ({ name: layer.name, width: layer.canvas.width, height: layer.canvas.height, uploads: layer.uploads })),
    }),
  };
}

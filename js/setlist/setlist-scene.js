import * as THREE from 'three';
import { createWaveformMinimap, rectToWorld } from '../monitor-charts.js';
import { formatTrackTime } from '../atlas/signal-atlas-setlist.js';
import { splitTrackTitle, sampleTrackTransition, animatedTrackText } from './setlist-model.js';
import { resolveSetlistColors } from './setlist-settings.js';

const WIDTH = 1920, HEIGHT = 1080, ASPECT = WIDTH / HEIGHT;
const FONT = '"Inter", sans-serif';
const RECTS = Object.freeze({
  signal: { x: .06, y: .13, w: .88, h: .1188 },
  pulse: { x: .06, y: .35, w: .88, h: .14 },
  title: { x: .05, y: .77, w: .9, h: .215 },
});
// All horizontal measurements come from the waveform's resolved bounds, including
// its internal gutter. No independent percentage mapping for the bar or markers.
const BOX = rectToWorld(RECTS.signal, ASPECT);
const LEFT = (BOX.left + 50) * WIDTH / 100;
const RIGHT = (BOX.right + 50) * WIDTH / 100;
const SPAN = RIGHT - LEFT;
const BAR_Y = HEIGHT * .64;
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Overview geometry and captured typography share one fixed 16:9 design space.
 * The player supplies absolute audio time for both preview and offline export. */
export function createSetlistAtlasScene(stage, settings = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setClearColor('#000000', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Three synchronized track overviews with track-start markers, current title and artist');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 50 / ASPECT, -50 / ASPECT, -10, 10);
  camera.position.z = 5;
  let width = WIDTH, height = HEIGHT, ratio = 1, disposed = false;
  let time = 0, duration = 0, progress = 0, colorsKey = '';
  let colors = resolveSetlistColors(settings);
  let currentTrack = { index: -1, title: '', artist: '' };
  let textState = null, transition = sampleTrackTransition([], 0);
  let markerPositions = [];
  let textLayoutKey = '', textLayout = null;

  const waveforms = [
    createWaveformMinimap(scene, RECTS.signal, { barWidth: 2.3, barGap: .32 }),
    createWaveformMinimap(scene, RECTS.pulse, { style: 'reflected-bars', barWidth: 2.3, barGap: .55 }),
  ];
  const barGeometry = new THREE.PlaneGeometry(1, 1);
  const barMaterials = [colors.remaining, colors.elapsed].map(color => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
  const bars = barMaterials.map(material => {
    const mesh = new THREE.Mesh(barGeometry, material);
    mesh.renderOrder = 30;
    scene.add(mesh);
    return mesh;
  });
  const barWorldY = (HEIGHT / 2 - BAR_Y) * 100 / WIDTH;
  bars[0].scale.set(BOX.width, 4 * 100 / WIDTH, 1);
  bars[0].position.set(BOX.cx, barWorldY, 0);

  function makeLayer(name, rect) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.renderOrder = 100;
    const box = rectToWorld(rect, ASPECT, 0);
    mesh.scale.set(box.width, box.height, 1);
    mesh.position.set(box.cx, box.cy, 0);
    scene.add(mesh);
    return { name, rect, canvas, ctx, material, mesh, texture: null, key: '', uploads: 0 };
  }

  const headers = [.075, .295, .565].map((y, index) => makeLayer(`header${index}`, { x: .06, y, w: .88, h: .04 }));
  const markers = [
    makeLayer('signalMarkers', { x: .05, y: .24, w: .9, h: .05 }),
    makeLayer('pulseMarkers', { x: .05, y: .48, w: .9, h: .05 }),
    makeLayer('barMarkers', { x: .05, y: .61, w: .9, h: .06 }),
  ];
  const titleLayer = makeLayer('nowPlaying', RECTS.title);
  const layers = [...headers, ...markers, titleLayer];
  const caretY = [RECTS.signal, RECTS.pulse].map(rect => {
    const box = rectToWorld(rect, ASPECT);
    return (50 / ASPECT - box.bottom) * WIDTH / 100 + 8;
  });

  function resizeLayers() {
    for (const layer of layers) {
      const w = Math.max(1, Math.round(width * ratio * layer.rect.w));
      const h = Math.max(1, Math.round(height * ratio * layer.rect.h));
      if (layer.canvas.width === w && layer.canvas.height === h && layer.texture) continue;
      layer.canvas.width = w; layer.canvas.height = h;
      layer.texture?.dispose();
      layer.texture = new THREE.CanvasTexture(layer.canvas);
      layer.texture.colorSpace = THREE.SRGBColorSpace;
      layer.texture.minFilter = THREE.LinearFilter;
      layer.texture.generateMipmaps = false;
      layer.material.map = layer.texture;
      layer.material.needsUpdate = true;
      layer.key = '';
    }
  }

  function paint(layer, key, draw) {
    if (layer.key === key) return;
    const { ctx, canvas, rect } = layer;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / (rect.w * WIDTH), sy = canvas.height / (rect.h * HEIGHT);
    ctx.setTransform(sx, 0, 0, sy, -rect.x * WIDTH * sx, -rect.y * HEIGHT * sy);
    draw(ctx);
    layer.key = key;
    layer.texture.needsUpdate = true;
    layer.uploads++;
  }

  function label(ctx, value, x, y, size, color, align = 'left', weight = 500) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function updateColors() {
    const next = resolveSetlistColors(settings), key = JSON.stringify(next);
    if (key === colorsKey) return;
    colors = next; colorsKey = key;
    for (const waveform of waveforms) waveform.setColors({ color: colors.remaining, playedColor: colors.elapsed, playheadColor: colors.labels });
    barMaterials[0].color.set(colors.remaining);
    barMaterials[1].color.set(colors.elapsed);
  }

  function drawHeaders() {
    const elapsed = formatTrackTime(time, { forceHours: duration >= 3600 });
    const total = formatTrackTime(duration, { forceHours: duration >= 3600 });
    const clock = `${elapsed} / ${total}`;
    const names = ['SIGNAL OVERVIEW', 'PULSE OVERVIEW', 'TRACK PROGRESS'];
    headers.forEach((layer, index) => paint(layer, `${settings.headers}|${settings.labels}|${settings.labels === false ? '' : clock}|${colors.labels}`, ctx => {
      const y = layer.rect.y * HEIGHT + 23;
      if (settings.headers !== false) label(ctx, names[index], LEFT, y, 13, colors.labels);
      if (settings.labels !== false) label(ctx, clock, RIGHT, y, 14, colors.labels, 'right');
    }));
  }

  function drawMarkers(entries) {
    const size = clamp(settings.markerSize, 4, 24, 10);
    markerPositions = duration > 0 ? entries.map((entry, index) => ({
      time: entry.time, x: LEFT + Math.max(0, Math.min(1, entry.time / duration)) * SPAN,
      color: index === transition.activeIndex ? colors.labels : index < transition.activeIndex ? colors.elapsed : colors.remaining,
    })) : [];
    const key = JSON.stringify([markerPositions, size]);
    markers.forEach((layer, index) => paint(layer, key, ctx => {
      for (const marker of markerPositions) {
        ctx.fillStyle = marker.color;
        ctx.beginPath();
        if (index === 2) {
          ctx.arc(marker.x, BAR_Y, size / 2, 0, Math.PI * 2);
          // A thin black edge keeps dots legible on the same-colour bar.
          ctx.strokeStyle = '#000000'; ctx.lineWidth = 3; ctx.stroke();
        } else {
          ctx.moveTo(marker.x, caretY[index]);
          ctx.lineTo(marker.x - size / 2, caretY[index] + size * .65);
          ctx.lineTo(marker.x + size / 2, caretY[index] + size * .65);
          ctx.closePath();
        }
        ctx.fill();
      }
    }));
  }

  function fitText(value, size, weight) {
    const ctx = titleLayer.ctx;
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(value).width <= SPAN) return value;
    const graphemes = Array.from(segmenter.segment(value), item => item.segment);
    let low = 0, high = graphemes.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (ctx.measureText(graphemes.slice(0, middle).join('') + '…').width <= SPAN) low = middle;
      else high = middle - 1;
    }
    return graphemes.slice(0, low).join('') + '…';
  }

  function drawTrack(entries) {
    const entry = entries[transition.displayIndex];
    const track = entry ? splitTrackTitle(entry.title) : { title: '', artist: '' };
    const titleSize = clamp(settings.titleSize, 20, 96, 48);
    const artistSize = clamp(settings.artistSize, 12, 64, 28);
    const titleWeight = clamp(settings.titleWeight, 100, 900, 550);
    const artistWeight = clamp(settings.artistWeight, 100, 900, 450);
    const alignment = ['left', 'center', 'right'].includes(settings.alignment) ? settings.alignment : 'left';
    const layoutKey = JSON.stringify([track, titleSize, artistSize, titleWeight, artistWeight, alignment]);
    if (layoutKey !== textLayoutKey) {
      textLayoutKey = layoutKey;
      textLayout = {};
      for (const [name, size, weight] of [['title', titleSize, titleWeight], ['artist', artistSize, artistWeight]]) {
        const full = fitText(track[name], size, weight);
        const textWidth = titleLayer.ctx.measureText(full).width;
        const x = alignment === 'right' ? RIGHT - textWidth : alignment === 'center' ? LEFT + (SPAN - textWidth) / 2 : LEFT;
        textLayout[name] = { full, x, width: textWidth, size, weight };
      }
    }
    const displayed = {
      title: animatedTrackText(textLayout.title.full, transition),
      artist: animatedTrackText(textLayout.artist.full, transition),
    };
    textState = { ...displayed, fullTitle: textLayout.title.full, fullArtist: textLayout.artist.full,
      alignment, titleSize, artistSize, titleWeight, artistWeight, titleX: textLayout.title.x, artistX: textLayout.artist.x };
    paint(titleLayer, JSON.stringify([textState, colors.title, colors.artist]), ctx => {
      ctx.save();
      ctx.beginPath(); ctx.rect(LEFT, RECTS.title.y * HEIGHT, SPAN, RECTS.title.h * HEIGHT); ctx.clip();
      const top = .79 * HEIGHT;
      label(ctx, displayed.title, textLayout.title.x, top + titleSize, titleSize, colors.title, 'left', titleWeight);
      label(ctx, displayed.artist, textLayout.artist.x, top + titleSize * 1.15 + 16 + artistSize, artistSize, colors.artist, 'left', artistWeight);
      ctx.restore();
    });
  }

  function resize(w, h, pixelRatio = 1) {
    if (disposed) return;
    width = Math.max(2, Math.round(w)); height = Math.max(2, Math.round(h));
    ratio = clamp(pixelRatio, .1, 4, 1);
    renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
    for (const waveform of waveforms) {
      waveform.layout(ASPECT);
      waveform.setResolution(width, height, ratio);
    }
    resizeLayers();
  }

  function render({ time: position = 0, analysis = null } = {}) {
    if (disposed) return;
    duration = Number.isFinite(analysis?.duration) ? Math.max(0, analysis.duration) : 0;
    time = Math.max(0, Math.min(duration, Number.isFinite(position) ? position : 0));
    progress = duration ? time / duration : 0;
    const entries = duration ? (settings.setlist || []) : [];
    transition = sampleTrackTransition(entries, time, { duration: settings.transitionDuration });
    const active = entries[transition.activeIndex];
    currentTrack = { index: transition.activeIndex, ...(active ? splitTrackTitle(active.title) : { title: '', artist: '' }) };
    updateColors();
    for (const waveform of waveforms) waveform.update({ progress });
    bars[1].visible = progress > 0;
    bars[1].scale.set(BOX.width * progress, 4 * 100 / WIDTH, 1);
    bars[1].position.set(BOX.left + BOX.width * progress / 2, barWorldY, .01);
    drawHeaders(); drawMarkers(entries); drawTrack(entries);
    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const waveform of waveforms) waveform.dispose();
    barGeometry.dispose(); barMaterials.forEach(material => material.dispose());
    for (const layer of layers) {
      layer.texture?.dispose(); layer.material.dispose(); layer.mesh.geometry.dispose();
    }
    renderer.dispose(); renderer.domElement.remove();
  }

  resize(WIDTH, HEIGHT);
  for (const waveform of waveforms) waveform.setPeaks(new Float32Array(1));
  return {
    canvas: renderer.domElement, resize, render, dispose,
    setHistoryFrames() {}, resetHistory() {},
    setOverview(peaks, rmsPeaks) { for (const waveform of waveforms) waveform.setPeaks(peaks, rmsPeaks); },
    getCurrentTrack: () => ({ ...currentTrack }),
    getInfo: () => ({
      time, duration, progress, activeIndex: transition.activeIndex, currentTrack: { ...currentTrack },
      transition: { ...transition }, text: textState && { ...textState }, colors: { ...colors },
      overviewBounds: ['signal', 'pulse', 'progress'].map(style => ({ style, left: LEFT, right: RIGHT, width: SPAN, progressX: LEFT + progress * SPAN })),
      rectangles: RECTS, barY: BAR_Y, markerSize: clamp(settings.markerSize, 4, 24, 10),
      markers: markerPositions.map(marker => ({ ...marker })), markerCount: markerPositions.length,
      headers: settings.headers !== false, labels: settings.labels !== false,
      background: '#000000', labelFont: 'Inter', fontLoaded: document.fonts.check('500 16px "Inter"'),
      canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height, pixelRatio: ratio,
      layers: layers.map(layer => ({ name: layer.name, uploads: layer.uploads, width: layer.canvas.width, height: layer.canvas.height })),
      drawCalls: renderer.info.render.calls,
    }),
  };
}

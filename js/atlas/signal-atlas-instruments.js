import * as THREE from 'three';
import { amplitudeToDb, clampRange, dbToUnit, fillPhaseTrail, frequencyAt, RTA_FFT_SIZE, sampleSpectrum } from './signal-atlas-instrument-math.js';

// Compress the instrument row around its heading without shrinking typography.
const rowY = y => .096 + (y - .096) * .7;
const labelY = y => rowY(y) * 1080;
const scopeRect = Object.freeze({ x: .06, y: rowY(.12), w: .17175, h: .35 * .7 });
const meterRect = Object.freeze({ x: .86, y: rowY(.14), w: .08, h: .30 * .7 });
const SCOPE_CENTER_X = .155, CORRELATION_WIDTH = .1584, METER_BAR_WIDTH = .22;
// Preserve bar width and halve the clear gap: .24 → .12 of the meter column.
const meterCenter = index => index ? .67 : .33;
export const INSTRUMENT_VISIBLE_EDGES = Object.freeze({
  scopeRight: SCOPE_CENTER_X + CORRELATION_WIDTH / 2,
  meterLeft: meterRect.x + meterRect.w * (meterCenter(0) - METER_BAR_WIDTH / 2),
});
const analyzerWidth = .57475;
// Balance against the drawn correlation bar and first peak bar, excluding
// invisible container padding and the meter's labels inside the right gap.
const analyzerX = (INSTRUMENT_VISIBLE_EDGES.scopeRight + INSTRUMENT_VISIBLE_EDGES.meterLeft - analyzerWidth) / 2;
export const INSTRUMENT_RECTS = Object.freeze({
  scope: scopeRect,
  analyzer: Object.freeze({ x: analyzerX, y: rowY(.14), w: analyzerWidth, h: .30 * .7 }),
  meters: meterRect,
});

const CYAN = '#00f3ff', PINK = '#ff007f', PURPLE = '#9d72ff', GREEN = '#22c55e';
const CURVE_POINTS = 1280, SCOPE_POINTS = 8192;
const SCOPE = { cx: SCOPE_CENTER_X * 1920, cy: labelY(.262), scale: 108 * .7,
  left: .064, right: .23175, top: rowY(.132), bottom: rowY(.394) };
const DB_STEPS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54, -60, -66, -72, -78, -84, -90];
const FREQUENCIES = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const planeVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

function makeCurve(color) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CURVE_POINTS * 6);
  const indices = new Uint16Array((CURVE_POINTS - 1) * 6);
  for (let i = 0; i < CURVE_POINTS - 1; i++) {
    const v = i * 2;
    indices.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .93,
    side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 22;
  return { mesh, positions, values: new Float32Array(CURVE_POINTS) };
}

/** The supplied scene shares the parent’s single canvas and orthographic camera.
 * Display persistence comes from supplied timestamp-derived data. Previous
 * renders never affect a seek, repeated frame, or offline export.
 */
export function createAtlasInstruments(scene, settings) {
  const group = new THREE.Group();
  scene.add(group);
  let aspect = 16 / 9, width = 1920, height = 1080, ratio = 1;
  let latest = { frame: null, spectralFrame: null, levels: null, sampleRate: 48000, hasAudio: false };
  let range = clampRange(settings.rtaMin, settings.rtaMax), boost = 6, correlation = 0;
  const meterState = { left: { sampleDb: -Infinity, displayDb: -Infinity, heldDb: -Infinity }, right: { sampleDb: -Infinity, displayDb: -Infinity, heldDb: -Infinity } };
  let scopeState = { count: 0, correlation: 0, duration: 0, stride: 1 };
  const curveLeft = makeCurve(CYAN), curveRight = makeCurve(PINK);
  group.add(curveLeft.mesh, curveRight.mesh);

  const scopePositions = new Float32Array(SCOPE_POINTS * 3);
  const scopeWeights = new Float32Array(SCOPE_POINTS);
  const scopeGeometry = new THREE.BufferGeometry();
  scopeGeometry.setAttribute('position', new THREE.BufferAttribute(scopePositions, 3).setUsage(THREE.DynamicDrawUsage));
  scopeGeometry.setAttribute('aWeight', new THREE.BufferAttribute(scopeWeights, 1).setUsage(THREE.DynamicDrawUsage));
  const scopeMaterial = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 4 }, uClip: { value: new THREE.Vector4() } },
    transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `uniform float uSize; attribute float aWeight; varying vec2 vPosition; varying float vWeight;
      void main(){vWeight=aWeight;vPosition=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=uSize;}`,
    fragmentShader: `uniform vec4 uClip; varying vec2 vPosition; varying float vWeight;
      void main(){if(vPosition.x<uClip.x||vPosition.x>uClip.y||vPosition.y<uClip.z||vPosition.y>uClip.w)discard;
      float alpha=1.0-smoothstep(.2,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(.615686,.447059,1.0,alpha*vWeight*.6);}`,
  });
  const scope = new THREE.Points(scopeGeometry, scopeMaterial);
  scope.frustumCulled = false;
  scope.renderOrder = 21;
  group.add(scope);

  const barGeometry = new THREE.PlaneGeometry(1, 1);
  const holdMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, depthTest: false });
  const meters = ['left', 'right'].map((channel, index) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { uLevel: { value: 0 } },
      depthWrite: false, depthTest: false,
      vertexShader: planeVertex,
      fragmentShader: `uniform float uLevel; varying vec2 vUv;
        void main(){float y=vUv.y*uLevel;
        vec3 low=vec3(.058824,.219608,.117647),green=vec3(.133333,.772549,.368627);
        vec3 yellow=vec3(.917647,.701961,.031373),red=vec3(.937255,.266667,.266667);
        vec3 color=y<.65?mix(low,green,y/.65):y<.88?mix(green,yellow,(y-.65)/.23):mix(yellow,red,(y-.88)/.12);
        gl_FragColor=vec4(color,1.0);}`,
    });
    const bar = new THREE.Mesh(barGeometry, material), hold = new THREE.Mesh(barGeometry, holdMaterial);
    bar.renderOrder = 22; hold.renderOrder = 23;
    group.add(bar, hold);
    return { channel, index, bar, hold };
  });

  const worldX = x => (x - .5) * 100;
  const worldY = y => (.5 - y) * 100 / aspect;

  function updateCurve(curve, data) {
    const rect = INSTRUMENT_RECTS.analyzer;
    const values = curve.values, positions = curve.positions;
    for (let i = 0; i < CURVE_POINTS; i++) {
      const t = i / (CURVE_POINTS - 1), span = .5 / (CURVE_POINTS - 1);
      const db = sampleSpectrum(data, frequencyAt(t - span, range.min, range.max), latest.sampleRate,
        frequencyAt(t + span, range.min, range.max));
      values[i] = (rect.y + rect.h * (1 - dbToUnit(db + boost))) * 1080;
    }
    const step = rect.w * 1920 / (CURVE_POINTS - 1);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const before = Math.max(0, i - 1), after = Math.min(CURVE_POINTS - 1, i + 1);
      const dx = (after - before) * step, dy = values[after] - values[before];
      const length = Math.hypot(dx, dy) || 1;
      const nx = -dy / length * 1.1, ny = dx / length * 1.1;
      const x = rect.x * 1920 + i * step;
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1, base = i * 6 + side * 3;
        positions[base] = worldX(Math.max(rect.x, Math.min(rect.x + rect.w, (x + nx * sign) / 1920)));
        positions[base + 1] = worldY(Math.max(rect.y, Math.min(rect.y + rect.h, (values[i] + ny * sign) / 1080)));
      }
    }
    curve.mesh.geometry.attributes.position.needsUpdate = true;
    curve.mesh.visible = latest.hasAudio && Boolean(data?.length);
  }

  function update({ frame = null, spectralFrame = null, levels = null, sampleRate = 48000, hasAudio = false } = {}) {
    latest = { frame, spectralFrame, levels, sampleRate, hasAudio };
    range = clampRange(settings.rtaMin, settings.rtaMax, sampleRate);
    boost = [0, 6, 12, 18].includes(Number(settings.rtaBoost)) ? Number(settings.rtaBoost) : 6;
    scopeState = fillPhaseTrail(hasAudio ? frame : null, sampleRate, scopePositions, scopeWeights);
    correlation = scopeState.correlation;
    const count = scopeState.count;
    for (let i = 0; i < count; i++) {
      scopePositions[i * 3] = worldX((SCOPE.cx + scopePositions[i * 3] * SCOPE.scale) / 1920);
      scopePositions[i * 3 + 1] = worldY((SCOPE.cy - scopePositions[i * 3 + 1] * SCOPE.scale) / 1080);
    }
    scopeGeometry.setDrawRange(0, count);
    scopeGeometry.attributes.position.needsUpdate = true;
    scopeGeometry.attributes.aWeight.needsUpdate = true;
    scope.visible = count > 0;
    updateCurve(curveLeft, hasAudio ? spectralFrame?.rtaLeft : null);
    updateCurve(curveRight, hasAudio ? spectralFrame?.rtaRight : null);
    const rect = INSTRUMENT_RECTS.meters;
    for (const meter of meters) {
      const channel = meter.index ? 'r' : 'l', state = meterState[meter.channel];
      state.sampleDb = amplitudeToDb(hasAudio ? levels?.[channel + 'SamplePeak'] : 0);
      state.displayDb = amplitudeToDb(hasAudio ? levels?.[channel + 'DisplayPeak'] ?? levels?.[channel + 'SamplePeak'] : 0);
      state.heldDb = amplitudeToDb(hasAudio ? levels?.[channel + 'Peak'] : 0);
      const level = dbToUnit(state.displayDb), hold = dbToUnit(state.heldDb);
      const x = rect.x + rect.w * meterCenter(meter.index);
      const barWidth = rect.w * METER_BAR_WIDTH * 100, barHeight = rect.h * 100 / aspect * level;
      meter.bar.material.uniforms.uLevel.value = level;
      meter.bar.scale.set(barWidth, barHeight, 1);
      meter.bar.position.set(worldX(x), worldY(rect.y + rect.h) + barHeight / 2, 0);
      meter.bar.visible = hasAudio && level > 0;
      meter.hold.scale.set(barWidth + 100 / 1920 * 2, 100 / aspect * 2 / 1080, 1);
      meter.hold.position.set(worldX(x), worldY(rect.y + rect.h * (1 - hold)), 0);
      meter.hold.visible = hasAudio && Number.isFinite(state.heldDb) && hold > 0;
    }
  }

  function resize(w, h, pixelRatio = 1) {
    width = w; height = h; ratio = pixelRatio; aspect = width / height;
    scopeMaterial.uniforms.uSize.value = 2 * Math.max(1, 2 * width / 1920 * ratio);
    scopeMaterial.uniforms.uClip.value.set(worldX(SCOPE.left), worldX(SCOPE.right), worldY(SCOPE.bottom), worldY(SCOPE.top));
    update(latest);
  }

  function drawLabels(ctx) {
    const labels = settings.labels !== false;
    const opacity = Number.isFinite(settings.gridOpacity) ? settings.gridOpacity : .3;
    const line = (x1, y1, x2, y2, color = '#788899', alpha = Math.min(1, opacity * 1.6)) => {
      ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
    };
    const text = (value, x, y, color = '#a4acbc', size = 11, align = 'left') => {
      if (!labels) return;
      ctx.font = `500 ${size * 1.18}px "Inter", sans-serif`; ctx.fillStyle = color; ctx.textAlign = align;
      ctx.fillText(value, x, y);
    };
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // Scope guides and the in-phase ellipse share the reference's R−L / L+R axes.
    const { cx, cy, scale } = SCOPE;
    line(cx - scale, cy - scale, cx + scale, cy + scale);
    line(cx + scale, cy - scale, cx - scale, cy + scale);
    line(cx, cy - scale * 1.1, cx, cy + scale * 1.1);
    line(cx - scale * 1.4, cy, cx + scale * 1.4, cy);
    for (const radius of [.25, .5, .75, 1]) {
      ctx.beginPath(); ctx.ellipse(cx, cy, scale * .5 * radius, scale * .88 * radius, 0, 0, Math.PI * 2);
      ctx.strokeStyle = radius === 1 ? GREEN : '#5e6479';
      ctx.globalAlpha = radius === 1 ? Math.min(1, opacity * 5) : Math.min(1, opacity * 1.6);
      ctx.lineWidth = radius === 1 ? 1.3 : .8;
      ctx.setLineDash(radius === 1 ? [4, 4] : []); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    text('L', cx - scale - 10, cy - scale - 8, CYAN, 12, 'center');
    text('R', cx + scale + 10, cy - scale - 8, PINK, 12, 'center');
    text(`Φ  ${correlation >= 0 ? '+' : '−'}${Math.abs(correlation).toFixed(3)}`, cx, labelY(.429),
      correlation < 0 ? '#ef4444' : correlation > 0 ? GREEN : '#b3b5c4', 14, 'center');
    const barW = CORRELATION_WIDTH * 1920, barX = cx - barW / 2, barY = labelY(.45);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    gradient.addColorStop(0, '#7f202b'); gradient.addColorStop(.5, '#666476'); gradient.addColorStop(1, '#22c55e');
    ctx.fillStyle = gradient; ctx.globalAlpha = .7; ctx.fillRect(barX, barY, barW, 4); ctx.globalAlpha = 1;
    const pointer = barX + (correlation + 1) / 2 * barW;
    ctx.fillStyle = '#eeeaf7'; ctx.fillRect(pointer - 1, barY - 4, 2, 12);
    text('−1', barX, labelY(.473), '#858c9c', 10);
    text('0', barX + barW / 2, labelY(.473), '#858c9c', 10, 'center');
    text('+1', barX + barW, labelY(.473), '#858c9c', 10, 'right');

    const analyzer = INSTRUMENT_RECTS.analyzer, meterRect = INSTRUMENT_RECTS.meters;
    const leftX = analyzer.x * 1920, rightX = (analyzer.x + analyzer.w) * 1920;
    const meterLeftX = INSTRUMENT_VISIBLE_EDGES.meterLeft * 1920;
    const meterRightX = (meterRect.x + meterRect.w * (meterCenter(1) + METER_BAR_WIDTH / 2)) * 1920;
    const meterLabelX = meterLeftX - 10;
    for (const db of DB_STEPS) {
      const y = (analyzer.y + analyzer.h * (1 - dbToUnit(db))) * 1080;
      line(leftX, y, rightX, y);
      line(meterLeftX, y, meterRightX, y);
      text(db === 0 ? '0' : `−${Math.abs(db)}`, meterLabelX, y + 3.5, db === 0 ? CYAN : '#858c9c', 10, 'right');
    }
    line(rightX, analyzer.y * 1080, rightX, (analyzer.y + analyzer.h) * 1080, '#858c9c', opacity * 1.4);
    const ticks = [...new Set([range.min, ...FREQUENCIES.filter(f => f > range.min && f < range.max), range.max])];
    let lastTextX = -Infinity;
    for (const frequency of ticks) {
      const position = Math.log(frequency / range.min) / Math.log(range.max / range.min);
      const x = leftX + position * analyzer.w * 1920;
      line(x, analyzer.y * 1080, x, (analyzer.y + analyzer.h) * 1080);
      if (x - lastTextX > 48 || frequency === range.max) {
        const label = frequency >= 1000 ? `${Number((frequency / 1000).toFixed(1))}k` : String(Math.round(frequency));
        text(label, x, labelY(.462), '#858c9c', 11, frequency === range.min ? 'left' : frequency === range.max ? 'right' : 'center');
        lastTextX = x;
      }
    }
    text('L', leftX, labelY(.124), CYAN, 11);
    text('R', leftX + 26, labelY(.124), PINK, 11);
    text('dBFS', meterLabelX, labelY(.124), '#9ba0b1', 9, 'right');
    text('Hz', rightX, labelY(.478), '#6e7687', 9, 'right');
    for (const meter of meters) {
      const x = (meterRect.x + meterRect.w * meterCenter(meter.index)) * 1920;
      const state = meterState[meter.channel], color = meter.index ? PINK : CYAN;
      text(meter.index ? 'R' : 'L', x, labelY(.462), color, 11, 'center');
      const peak = state.heldDb >= 0 ? 'CLIP' : Number.isFinite(state.heldDb) ? state.heldDb.toFixed(1).replace('-', '−') : '−∞';
      text(peak, x, labelY(.124), state.heldDb >= 0 ? '#ef4444' : color, 11, 'center');
    }
    ctx.restore();
  }

  function hitTest(x, y) {
    const rect = INSTRUMENT_RECTS.analyzer;
    if (!latest.hasAudio || !latest.spectralFrame || x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) return null;
    const frequency = frequencyAt((x - rect.x) / rect.w, range.min, range.max);
    return { frequency, leftDb: sampleSpectrum(latest.spectralFrame.rtaLeft, frequency, latest.sampleRate),
      rightDb: sampleSpectrum(latest.spectralFrame.rtaRight, frequency, latest.sampleRate) };
  }

  resize(width, height, ratio);
  return {
    resize, update, drawLabels, hitTest,
    getInfo: () => ({ rects: INSTRUMENT_RECTS, correlation, scope: { ...scopeState }, rta: { ...range, boost, fftSize: RTA_FFT_SIZE, bins: RTA_FFT_SIZE / 2 },
      meters: { left: { ...meterState.left }, right: { ...meterState.right } }, hasAudio: latest.hasAudio }),
    dispose() {
      scopeGeometry.dispose(); scopeMaterial.dispose(); barGeometry.dispose(); holdMaterial.dispose();
      for (const curve of [curveLeft, curveRight]) { curve.mesh.geometry.dispose(); curve.mesh.material.dispose(); }
      for (const meter of meters) meter.bar.material.dispose();
      group.removeFromParent();
    },
  };
}

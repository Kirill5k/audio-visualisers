/**
 * Vizz.fm effect runtime adapted with the user's confirmed reuse permission.
 * Original: vizz.fm (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-3ced9d0c98830ef9.js
 * Release 1b2b169, retrieved 2026-09-20. No additional license is granted.
 *
 * Original GLSL and parameter ranges live in adjacent source modules. React
 * lifecycle code is replaced with explicit ownership and deterministic reset.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import * as shaders from './mesh-grid-effect-shaders.js';
import {
  EFFECT_CONTROLS, EFFECT_DEFAULTS, GRADIENT_PALETTES, resolveEffectOrder,
  effectiveTileCount, feedbackFrameUniforms,
} from './mesh-grid-effect-settings.js';
export { EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_ORDER, EFFECT_NAMES, resolveEffectOrder } from './mesh-grid-effect-settings.js';

const CLOCKED_EFFECTS = new Set(['gradientMap', 'gammaCorrection', 'kaleidoscope', 'concentricTile']);
const CHARACTER_SETS = { ascii: ' .,:;i1tfLCG08@', blocks: ' ░▒▓█' };
const ROTATION_MODES = { linear: 0, radial: 1, random: 2 };

/** Reproduce Vizz's glyph atlas, including the twelve intensity-ranked LED dots. */
function createGlyphAtlas(charSet) {
  const canvas = document.createElement('canvas');
  const dots = charSet === 'dots';
  const characters = CHARACTER_SETS[charSet] ?? CHARACTER_SETS.ascii;
  const glyphCount = dots ? 12 : Math.min(16, characters.length);
  const cellSize = dots ? 32 : 16;
  canvas.width = cellSize * glyphCount;
  canvas.height = cellSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas is required for the ASCII effect.');
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (dots) {
    for (let index = 1; index < 12; index++) {
      const level = index / 11;
      const x = 32 * index + 16;
      const radius = 15 * (0.4 + 0.55 * level);
      const opacity = 0.35 + 0.65 * level;
      const gradient = context.createRadialGradient(x, 16, 0, x, 16, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
      gradient.addColorStop(0.7, `rgba(255, 255, 255, ${opacity})`);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, 16, radius, 0, 2 * Math.PI);
      context.fill();
    }
  } else {
    context.fillStyle = '#fff';
    context.font = '14px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let index = 0; index < glyphCount; index++) {
      context.fillText(characters[index] ?? ' ', 16 * index + 8, 9);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = dots ? THREE.LinearFilter : THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, glyphCount };
}

function createEffectPass(effect) {
  const uniforms = { tDiffuse: { value: null } };
  for (const [key, control] of Object.entries(EFFECT_CONTROLS[effect])) {
    if (key === 'enabled') continue;
    uniforms[key] = { value: control.type === 'color' ? new THREE.Color(control.default) : control.default };
  }
  uniforms.resolution = { value: new THREE.Vector2(1920, 1080) };
  if (CLOCKED_EFFECTS.has(effect)) uniforms.time = { value: 0 };
  if (effect === 'feedback') Object.assign(uniforms, {
    tFeedback: { value: null }, decayFrame: { value: 0.9 }, injectFrame: { value: 1 },
    zoomFrame: { value: 1 }, rotateFrame: { value: 0 }, offsetFrame: { value: new THREE.Vector2() },
    hueFrame: { value: 0 }, blendModeInt: { value: 0 },
  });
  if (effect === 'gradientMap') {
    uniforms.paletteCount = { value: 0 };
    for (let index = 1; index <= 4; index++) uniforms[`paletteColor${index}`] = { value: new THREE.Color(index === 1 ? '#000000' : '#ffffff') };
  }
  if (effect === 'gridTile') Object.assign(uniforms, {
    effColumns: { value: 4 }, effRows: { value: 4 }, rotationModeInt: { value: 0 },
  });
  if (effect === 'ascii') Object.assign(uniforms, {
    uAtlas: { value: null }, glyphCount: { value: CHARACTER_SETS.ascii.length },
    colorModeInt: { value: 0 }, dprScale: { value: 1 },
  });
  if (effect === 'ledScreen') uniforms.dprScale = { value: 1 };
  return new ShaderPass({
    uniforms,
    vertexShader: shaders.FULLSCREEN_VERTEX_SHADER,
    fragmentShader: shaders[`${effect}FragmentShader`],
  });
}

/**
 * Dimensions are CSS pixels plus DPR. Frame settings may contain audio-modulated
 * values. A zero-delta repaint never advances clocks or commits feedback history.
 */
export function createMeshGridEffects({ renderer, scene, camera, settings = {} }) {
  let configuredSettings = settings;
  const size = renderer.getSize(new THREE.Vector2());
  let width = size.x;
  let height = size.y;
  let pixelRatio = renderer.getPixelRatio();
  let composer = null;
  let passes = new Map();
  let historyTarget = null;
  let chainKey = null;
  let hasFrame = false;
  let dirty = true;
  let disposed = false;
  let lastPositiveDelta = 1 / 60;
  const copyPass = new ShaderPass(CopyShader);
  const atlases = new Map();
  const palettes = Object.fromEntries(Object.entries(GRADIENT_PALETTES)
    .map(([name, colors]) => [name, colors.map(color => new THREE.Color(color))]));

  function getAtlas(charSet) {
    if (!atlases.has(charSet)) atlases.set(charSet, createGlyphAtlas(charSet));
    return atlases.get(charSet);
  }

  function releaseComposer() {
    if (composer) {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
    }
    composer = null;
    passes.clear();
    historyTarget?.dispose();
    historyTarget = null;
    hasFrame = false;
  }

  function clearTargets() {
    if (!composer) return;
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const target of [composer.renderTarget1, composer.renderTarget2, historyTarget]) {
      if (!target) continue;
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
    }
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  function applySize() {
    if (!composer) return;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    const physicalWidth = Math.max(1, Math.floor(width * pixelRatio));
    const physicalHeight = Math.max(1, Math.floor(height * pixelRatio));
    historyTarget?.setSize(physicalWidth, physicalHeight);
    for (const pass of passes.values()) {
      pass.uniforms.resolution.value.set(physicalWidth, physicalHeight);
      if (pass.uniforms.dprScale) pass.uniforms.dprScale.value = 2 / (pixelRatio || 1);
    }
  }

  function ensureComposer(effectiveSettings) {
    const enabled = resolveEffectOrder(effectiveSettings);
    const antiAliasing = Boolean(effectiveSettings.antiAliasing);
    const nextKey = JSON.stringify([enabled, antiAliasing]);
    if (nextKey === chainKey) return;
    releaseComposer();
    chainKey = nextKey;
    dirty = true;
    if (!enabled.length && !antiAliasing) return;
    composer = new EffectComposer(renderer);
    // Keep the complete final image available for feedback and pause repaints.
    composer.renderToScreen = false;
    composer.addPass(new RenderPass(scene, camera));
    for (const effect of enabled) {
      const pass = createEffectPass(effect);
      passes.set(effect, pass);
      composer.addPass(pass);
    }
    if (antiAliasing) composer.addPass(new SMAAPass());
    if (passes.has('feedback')) {
      historyTarget = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
      });
      historyTarget.texture.name = 'Mesh Grid final-frame feedback';
      passes.get('feedback').uniforms.tFeedback.value = historyTarget.texture;
    }
    applySize();
    clearTargets();
  }

  function updateUniforms(effect, pass, effectiveSettings, dt) {
    const uniforms = pass.uniforms;
    for (const [key, control] of Object.entries(EFFECT_CONTROLS[effect])) {
      if (key === 'enabled') continue;
      const value = effectiveSettings[`${effect}_${key}`] ?? control.default;
      if (uniforms[key].value?.isColor) uniforms[key].value.set(value);
      else uniforms[key].value = value;
    }
    // Upstream eW(.016, dt) = .016 * dt * 120, not elapsed wall time.
    if (uniforms.time) uniforms.time.value += 1.92 * dt;
    if (effect === 'feedback') {
      const dynamics = feedbackFrameUniforms(effectiveSettings, dt > 0 ? dt : lastPositiveDelta);
      for (const [key, value] of Object.entries(dynamics)) {
        if (key === 'offsetFrame') uniforms[key].value.set(...value);
        else uniforms[key].value = value;
      }
    } else if (effect === 'gridTile') {
      uniforms.effColumns.value = effectiveTileCount(uniforms.columns.value, width, 1600);
      uniforms.effRows.value = effectiveTileCount(uniforms.rows.value, height, 900);
      uniforms.rotationModeInt.value = ROTATION_MODES[uniforms.rotationMode.value] ?? 0;
    } else if (effect === 'ascii') {
      const atlas = getAtlas(uniforms.charSet.value || 'ascii');
      uniforms.uAtlas.value = atlas.texture;
      uniforms.glyphCount.value = atlas.glyphCount;
      uniforms.colorModeInt.value = Number(uniforms.colorMode.value === 'mono');
    } else if (effect === 'gradientMap') {
      const palette = palettes[uniforms.palette.value];
      const count = palette ? Math.max(2, Math.min(palette.length, Math.round(uniforms.colorCount.value))) : 0;
      uniforms.paletteCount.value = count;
      for (let index = 0; index < count; index++) {
        uniforms[`paletteColor${index + 1}`].value.copy(palette[Math.round(index * (palette.length - 1) / (count - 1))]);
      }
    }
  }

  function displayFrame() {
    copyPass.renderToScreen = true;
    copyPass.render(renderer, null, composer.readBuffer, 0, false);
  }

  return {
    render(frame = {}, delta = 0) {
      if (disposed) return;
      const effectiveSettings = frame.settings ?? configuredSettings;
      const dt = Math.max(0, Number.isFinite(delta) ? delta : 0);
      ensureComposer(effectiveSettings);
      if (!composer) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      if (dt === 0 && hasFrame && !dirty) {
        displayFrame();
        return;
      }
      if (dt > 0) lastPositiveDelta = dt;
      for (const [effect, pass] of passes) updateUniforms(effect, pass, effectiveSettings, dt);
      composer.render(dt);
      displayFrame();
      // Vizz feeds back the final composed frame, including effects after the
      // feedback pass. This separate target preserves that exact recurrence.
      if (historyTarget && dt > 0) {
        copyPass.renderToScreen = false;
        copyPass.render(renderer, historyTarget, composer.readBuffer, dt, false);
        renderer.setRenderTarget(null);
      }
      hasFrame = true;
      dirty = false;
    },
    setSettings(nextSettings) {
      configuredSettings = nextSettings;
      dirty = true;
    },
    // Camera interaction can repaint a paused frame without advancing echoes.
    invalidate() {
      dirty = true;
    },
    resize(nextWidth, nextHeight, nextPixelRatio = renderer.getPixelRatio()) {
      const normalizedWidth = Math.max(1, nextWidth);
      const normalizedHeight = Math.max(1, nextHeight);
      const normalizedRatio = Math.max(0.1, nextPixelRatio);
      if (width === normalizedWidth && height === normalizedHeight && pixelRatio === normalizedRatio) return;
      width = normalizedWidth;
      height = normalizedHeight;
      pixelRatio = normalizedRatio;
      applySize();
      clearTargets();
      hasFrame = false;
      dirty = true;
    },
    reset() {
      for (const pass of passes.values()) if (pass.uniforms.time) pass.uniforms.time.value = 0;
      clearTargets();
      lastPositiveDelta = 1 / 60;
      hasFrame = false;
      dirty = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseComposer();
      copyPass.dispose();
      for (const atlas of atlases.values()) atlas.texture.dispose();
      atlases.clear();
    },
  };
}

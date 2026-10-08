/**
 * Vizz.fm's complete effect registry, adapted with permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 * Retrieved 2026-10-08. No additional license is granted.
 */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createMeshGridEffects } from '../mesh-grid/mesh-grid-effects.js';
import { FULLSCREEN_VERTEX_SHADER } from '../mesh-grid/mesh-grid-effect-shaders.js';
import { EFFECT_CONTROLS, resolveEffectOrder } from './particle-dance-effect-settings.js';
import * as shaders from './particle-dance-effect-shaders.js';
import { createTextureCanvas } from './particle-dance-effect-textures.js';
import {
  ADDED_CLOCKED_EFFECTS, EFFECT_ENUMS, effectClockRate, createGrainTimeline,
} from './particle-dance-effect-dynamics.js';
export { EFFECT_CONTROLS, EFFECT_DEFAULTS, EFFECT_ORDER, EFFECT_NAMES, resolveEffectOrder } from './particle-dance-effect-settings.js';

/** The legacy fourteen passes stay shared; resources for the other eighteen are local. */
export function createParticleDanceEffects(options) {
  const textures = new Map();
  const grainTimelines = new WeakMap();

  function getTexture(preset, index = 0) {
    const animated = preset === 'noiseAnimated';
    const key = animated ? `${preset}:${index}` : preset;
    if (textures.has(key)) return textures.get(key);
    const canvas = createTextureCanvas(preset, 512, animated ? 1009 + 7919 * index : 42);
    if (!canvas) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.name = `Particle Dance ${key}`;
    textures.set(key, texture);
    return texture;
  }

  const registry = {
    controls: EFFECT_CONTROLS,
    shaders,
    resolveEffectOrder,
    initializeUniforms(effect, uniforms) {
      if (ADDED_CLOCKED_EFFECTS.has(effect)) uniforms.time = { value: 0 };
      for (const mapping of Object.values(EFFECT_ENUMS[effect] ?? {})) {
        uniforms[mapping.uniform] = { value: 0 };
      }
      if (['pixelate', 'dither', 'dotScreen'].includes(effect)) uniforms.dprScale = { value: 1 };
      if (effect === 'dotScreen') Object.assign(uniforms, {
        tSize: { value: new THREE.Vector2(256, 256) },
        center: { value: new THREE.Vector2(uniforms.centerX.value, uniforms.centerY.value) },
      });
      if (effect === 'textureOverlay') Object.assign(uniforms, {
        uTexture: { value: null }, uTextureNext: { value: null },
        uHasTexture: { value: false }, uGrainAnimated: { value: false }, uGrainMix: { value: 0 },
      });
    },
    createPreparatoryPasses(effect) {
      if (effect !== 'bokehBlur') return [];
      return [2.5, 14].map(maxRadius => new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          size: { value: EFFECT_CONTROLS.bokehBlur.size.default },
          opacity: { value: EFFECT_CONTROLS.bokehBlur.opacity.default },
          maxRadius: { value: maxRadius },
          resolution: { value: new THREE.Vector2(1920, 1080) },
        },
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: shaders.bokehPreBlurFragmentShader,
      }));
    },
    clockRate(effect, uniforms) {
      return effectClockRate(effect, uniforms.rippleSpeed?.value ?? 1);
    },
    updateUniforms(effect, pass, settings, dt) {
      const uniforms = pass.uniforms;
      for (const [control, mapping] of Object.entries(EFFECT_ENUMS[effect] ?? {})) {
        uniforms[mapping.uniform].value = mapping.values[uniforms[control].value] ?? 0;
      }
      if (effect === 'dotScreen') {
        // Upstream exposes two scalar controls for this vec2; keep both editable.
        uniforms.center.value.set(uniforms.centerX.value, uniforms.centerY.value);
      }
      if (effect !== 'textureOverlay') return;
      const preset = uniforms.preset.value || 'noise';
      const animated = preset === 'noiseAnimated';
      uniforms.uGrainAnimated.value = animated;
      if (animated) {
        let timeline = grainTimelines.get(pass);
        if (!timeline) { timeline = createGrainTimeline(); grainTimelines.set(pass, timeline); }
        const state = timeline.advance(dt);
        uniforms.uTexture.value = getTexture(preset, state.indexA);
        uniforms.uTextureNext.value = getTexture(preset, state.indexB);
        uniforms.uGrainMix.value = state.phase;
      } else {
        uniforms.uTexture.value = getTexture(preset);
        uniforms.uTextureNext.value = uniforms.uTexture.value;
        uniforms.uGrainMix.value = 0;
      }
      uniforms.uHasTexture.value = Boolean(uniforms.uTexture.value);
    },
    resetPass(effect, pass) {
      if (effect === 'textureOverlay') {
        grainTimelines.get(pass)?.reset();
        pass.uniforms.uGrainMix.value = 0;
      }
    },
    dispose() {
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
    },
  };
  return createMeshGridEffects({ ...options, registry });
}

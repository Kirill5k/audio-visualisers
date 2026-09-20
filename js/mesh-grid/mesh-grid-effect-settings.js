/**
 * Mesh Grid effects adapted from Vizz.fm with the user's confirmed permission.
 * Original: vizz.fm (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-3ced9d0c98830ef9.js
 * Release: 1b2b169. Retrieved: 2026-09-20. No additional license is granted.
 */

export const EFFECT_CONTROLS = {
  "feedback": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "decay": {
      "type": "number",
      "label": "Persistence",
      "min": 0,
      "max": 1,
      "step": 0.005,
      "default": 0.9
    },
    "blendMode": {
      "type": "select",
      "label": "Blend",
      "options": {
        "Lighten": "lighten",
        "Add": "add",
        "Average": "average"
      },
      "default": "lighten"
    },
    "zoom": {
      "type": "number",
      "label": "Zoom Rate",
      "min": 0.9,
      "max": 1.1,
      "step": 0.001,
      "default": 1
    },
    "rotate": {
      "type": "number",
      "label": "Rotate Rate",
      "min": -180,
      "max": 180,
      "step": 1,
      "default": 0
    },
    "offsetX": {
      "type": "number",
      "label": "Drift X",
      "min": -0.5,
      "max": 0.5,
      "step": 0.001,
      "default": 0
    },
    "offsetY": {
      "type": "number",
      "label": "Drift Y",
      "min": -0.5,
      "max": 0.5,
      "step": 0.001,
      "default": 0
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "hueShift": {
      "type": "number",
      "label": "Hue Cycle",
      "min": -360,
      "max": 360,
      "step": 1,
      "default": 0
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "gradientMap": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "palette": {
      "type": "select",
      "label": "Palette",
      "options": {
        "Custom": "custom",
        "Synthwave": "synthwave",
        "Vapor": "vapor",
        "Sunset": "sunset",
        "Ocean": "ocean",
        "Forest": "forest",
        "Ice": "ice",
        "Plasma": "plasma",
        "Game Boy": "gameboy",
        "Magma": "magma",
        "Viridis": "viridis",
        "Cyberpunk": "cyberpunk",
        "Matrix": "matrix",
        "Acid": "acid",
        "Candy": "candy",
        "Twilight": "twilight",
        "Sepia": "sepia",
        "Rose Gold": "rosegold",
        "Mono": "mono"
      },
      "default": "custom"
    },
    "colorCount": {
      "type": "number",
      "label": "Colors",
      "min": 2,
      "max": 4,
      "step": 1,
      "default": 4
    },
    "color1": {
      "type": "color",
      "label": "Shadows",
      "default": "#0d0221"
    },
    "color2": {
      "type": "color",
      "label": "Midtones",
      "default": "#f72585"
    },
    "color3": {
      "type": "color",
      "label": "Highlights",
      "default": "#ffd60a"
    },
    "color4": {
      "type": "color",
      "label": "Color 4",
      "default": "#ffffff"
    },
    "shift": {
      "type": "number",
      "label": "Shift",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "cycleSpeed": {
      "type": "number",
      "label": "Cycle Speed",
      "min": -2,
      "max": 2,
      "step": 0.01,
      "default": 0
    },
    "cyclic": {
      "type": "boolean",
      "label": "Cyclic",
      "default": false
    },
    "posterize": {
      "type": "number",
      "label": "Posterize",
      "min": 0,
      "max": 16,
      "step": 1,
      "default": 0
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "gammaCorrection": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "gamma": {
      "type": "number",
      "label": "Gamma",
      "min": 0.5,
      "max": 3,
      "step": 0.01,
      "default": 0.77
    },
    "decode": {
      "type": "boolean",
      "label": "Decode Mode (sRGB → Linear)",
      "default": true
    },
    "hueShift": {
      "type": "number",
      "label": "Hue Shift",
      "min": -3.14159,
      "max": 3.14159,
      "step": 0.01,
      "default": 0
    },
    "hueSpeed": {
      "type": "number",
      "label": "Hue Cycle Speed",
      "min": 0,
      "max": 5,
      "step": 0.01,
      "default": 0
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "swirl": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "angle": {
      "type": "number",
      "label": "Swirl Angle",
      "min": -10,
      "max": 10,
      "step": 0.1,
      "default": 2
    },
    "radius": {
      "type": "number",
      "label": "Swirl Radius",
      "min": 0.1,
      "max": 2,
      "step": 0.01,
      "default": 0.8
    },
    "falloff": {
      "type": "number",
      "label": "Falloff",
      "min": 0.1,
      "max": 3,
      "step": 0.1,
      "default": 1
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "kaleidoscope": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "segmentCount": {
      "type": "number",
      "label": "Segment Count",
      "min": 1,
      "max": 20,
      "step": 1,
      "default": 4
    },
    "rotateCopies": {
      "type": "boolean",
      "label": "Rotate Copies",
      "default": false
    },
    "blend": {
      "type": "number",
      "label": "Copy Blend",
      "min": 0,
      "max": 0.5,
      "step": 0.01,
      "default": 0
    },
    "rotation": {
      "type": "number",
      "label": "Rotation",
      "min": 0,
      "max": 6.28,
      "step": 0.01,
      "default": 0
    },
    "spin": {
      "type": "number",
      "label": "Spin Speed",
      "min": -2,
      "max": 2,
      "step": 0.01,
      "default": 0
    },
    "twist": {
      "type": "number",
      "label": "Twist",
      "min": -6.28,
      "max": 6.28,
      "step": 0.01,
      "default": 0
    },
    "zoom": {
      "type": "number",
      "label": "Zoom",
      "min": 0.5,
      "max": 2,
      "step": 0.01,
      "default": 1
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0.1,
      "max": 0.9,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0.1,
      "max": 0.9,
      "step": 0.01,
      "default": 0.5
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "gridTile": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "columns": {
      "type": "number",
      "label": "Columns",
      "min": 1,
      "max": 20,
      "step": 1,
      "default": 4
    },
    "rows": {
      "type": "number",
      "label": "Rows",
      "min": 1,
      "max": 20,
      "step": 1,
      "default": 4
    },
    "zoom": {
      "type": "number",
      "label": "Zoom",
      "min": 0.1,
      "max": 3,
      "step": 0.01,
      "default": 1
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "gap": {
      "type": "number",
      "label": "Gap",
      "min": 0,
      "max": 0.1,
      "step": 0.001,
      "default": 0
    },
    "overlap": {
      "type": "number",
      "label": "Overlap",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "mirror": {
      "type": "boolean",
      "label": "Mirror Adjacent",
      "default": false
    },
    "rotationStep": {
      "type": "number",
      "label": "Rotation Step",
      "min": 0,
      "max": 180,
      "step": 1,
      "default": 0
    },
    "rotationMode": {
      "type": "select",
      "label": "Rotation Mode",
      "options": {
        "Linear": "linear",
        "Radial": "radial",
        "Random": "random"
      },
      "default": "linear"
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "concentricTile": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "scaleFactor": {
      "type": "number",
      "label": "Ring Scale",
      "min": 1.1,
      "max": 4,
      "step": 0.01,
      "default": 2
    },
    "baseRadius": {
      "type": "number",
      "label": "Source Radius",
      "min": 0.05,
      "max": 1,
      "step": 0.01,
      "default": 0.25
    },
    "zoom": {
      "type": "number",
      "label": "Zoom",
      "min": 0.1,
      "max": 3,
      "step": 0.01,
      "default": 1
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "twist": {
      "type": "number",
      "label": "Twist",
      "min": -360,
      "max": 360,
      "step": 1,
      "default": 0
    },
    "spin": {
      "type": "number",
      "label": "Spin Speed",
      "min": -2,
      "max": 2,
      "step": 0.01,
      "default": 0
    },
    "mirror": {
      "type": "boolean",
      "label": "Mirror Rings",
      "default": false
    },
    "blend": {
      "type": "number",
      "label": "Ring Blend",
      "min": 0,
      "max": 0.5,
      "step": 0.01,
      "default": 0
    },
    "innerRings": {
      "type": "number",
      "label": "Inner Rings",
      "min": 0,
      "max": 6,
      "step": 1,
      "default": 2
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "radialBlur": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "strength": {
      "type": "number",
      "label": "Blur Strength",
      "min": 0,
      "max": 0.5,
      "step": 0.01,
      "default": 0.1
    },
    "samples": {
      "type": "number",
      "label": "Quality (Samples)",
      "min": 4,
      "max": 32,
      "step": 2,
      "default": 12
    },
    "centerX": {
      "type": "number",
      "label": "Center X",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "centerY": {
      "type": "number",
      "label": "Center Y",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "innerRadius": {
      "type": "number",
      "label": "Inner Radius",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "falloff": {
      "type": "number",
      "label": "Falloff",
      "min": 0.1,
      "max": 3,
      "step": 0.1,
      "default": 1
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "tiltShift": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "focusPosition": {
      "type": "number",
      "label": "Focus Position",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "focusWidth": {
      "type": "number",
      "label": "Focus Width",
      "min": 0,
      "max": 0.5,
      "step": 0.01,
      "default": 0.1
    },
    "blurAmount": {
      "type": "number",
      "label": "Blur Amount",
      "min": 0,
      "max": 10,
      "step": 0.1,
      "default": 3
    },
    "falloff": {
      "type": "number",
      "label": "Falloff",
      "min": 0,
      "max": 2,
      "step": 0.01,
      "default": 0.5
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "sepia": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amount": {
      "type": "number",
      "label": "Amount",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "bleachBypass": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amount": {
      "type": "number",
      "label": "Amount",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.95
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "crt": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "curvature": {
      "type": "number",
      "label": "Curvature",
      "min": 0,
      "max": 0.5,
      "step": 0.01,
      "default": 0.1
    },
    "scanlineIntensity": {
      "type": "number",
      "label": "Scanline Intensity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.3
    },
    "rgbOffset": {
      "type": "number",
      "label": "RGB Offset",
      "min": 0,
      "max": 0.01,
      "step": 0.001,
      "default": 0.002
    },
    "vignette": {
      "type": "number",
      "label": "Vignette",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.3
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "ascii": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "cellSize": {
      "type": "number",
      "label": "Cell Size (px)",
      "min": 4,
      "max": 32,
      "step": 1,
      "default": 8
    },
    "charSet": {
      "type": "select",
      "label": "Charset",
      "options": {
        "ASCII": "ascii",
        "Blocks": "blocks",
        "LED Dots": "dots"
      },
      "default": "ascii"
    },
    "colorMode": {
      "type": "select",
      "label": "Color Mode",
      "options": {
        "Source": "source",
        "Mono": "mono"
      },
      "default": "source"
    },
    "monoColor": {
      "type": "color",
      "label": "Mono Color",
      "default": "#00ff88"
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "ledScreen": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "cellSize": {
      "type": "number",
      "label": "Cell Size (px)",
      "min": 2,
      "max": 48,
      "step": 1,
      "default": 10
    },
    "dotSize": {
      "type": "number",
      "label": "Dot Size",
      "min": 0.4,
      "max": 1.5,
      "step": 0.01,
      "default": 0.94
    },
    "softness": {
      "type": "number",
      "label": "Softness",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.4
    },
    "glow": {
      "type": "number",
      "label": "Glow",
      "min": 0,
      "max": 2,
      "step": 0.01,
      "default": 0.43
    },
    "glowRadius": {
      "type": "number",
      "label": "Glow Radius",
      "min": 0.4,
      "max": 3,
      "step": 0.01,
      "default": 1.9
    },
    "panelGlow": {
      "type": "number",
      "label": "Panel Glow",
      "min": 0,
      "max": 0.3,
      "step": 0.005,
      "default": 0.1
    },
    "tint": {
      "type": "color",
      "label": "Tint",
      "default": "#ffffff"
    },
    "tintAmount": {
      "type": "number",
      "label": "Tint Amount",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  }
};

export const EFFECT_NAMES = {
  "feedback": "Echo Trails",
  "gradientMap": "Gradient Map",
  "gammaCorrection": "Color Tone",
  "swirl": "Swirl",
  "kaleidoscope": "Kaleidoscope",
  "gridTile": "Grid Tile",
  "concentricTile": "Concentric Tile",
  "radialBlur": "Radial Blur",
  "tiltShift": "Tilt Shift",
  "sepia": "Sepia",
  "bleachBypass": "Bleach Bypass",
  "crt": "CRT",
  "ascii": "ASCII",
  "ledScreen": "LED Screen"
};

export const GRADIENT_PALETTES = {
  "synthwave": [
    "#0d0221",
    "#f72585",
    "#ffd60a"
  ],
  "vapor": [
    "#150050",
    "#ff71ce",
    "#01cdfe",
    "#fffb96"
  ],
  "sunset": [
    "#03071e",
    "#9d0208",
    "#e85d04",
    "#ffba08"
  ],
  "ocean": [
    "#001219",
    "#005f73",
    "#94d2bd",
    "#e9d8a6"
  ],
  "forest": [
    "#081c15",
    "#2d6a4f",
    "#95d5b2",
    "#d8f3dc"
  ],
  "ice": [
    "#03045e",
    "#0077b6",
    "#90e0ef",
    "#caf0f8"
  ],
  "plasma": [
    "#0d0887",
    "#9c179e",
    "#ed7953",
    "#f0f921"
  ],
  "gameboy": [
    "#0f380f",
    "#306230",
    "#8bac0f",
    "#9bbc0f"
  ],
  "magma": [
    "#000004",
    "#781c6d",
    "#ed6925",
    "#fcffa4"
  ],
  "viridis": [
    "#440154",
    "#31688e",
    "#35b779",
    "#fde725"
  ],
  "cyberpunk": [
    "#0b0c2a",
    "#711c91",
    "#ea00d9",
    "#0abdc6"
  ],
  "matrix": [
    "#000000",
    "#003b00",
    "#008f11",
    "#00ff41"
  ],
  "acid": [
    "#10002b",
    "#7b2cbf",
    "#c8ff00"
  ],
  "candy": [
    "#3c1642",
    "#ff5d8f",
    "#ffcad4",
    "#fff0f3"
  ],
  "twilight": [
    "#0f0c29",
    "#302b63",
    "#bc78ec",
    "#ffd6ff"
  ],
  "sepia": [
    "#2a1a0a",
    "#70421f",
    "#c19a6b",
    "#f4e8d0"
  ],
  "rosegold": [
    "#31090f",
    "#b76e79",
    "#eac9c1",
    "#fff5f2"
  ],
  "mono": [
    "#000000",
    "#ffffff"
  ]
};

// Registry order is significant: Vizz appends enabled effects omitted from an
// explicit preset effectOrder after the explicitly ordered entries.
export const EFFECT_ORDER = Object.freeze(Object.keys(EFFECT_CONTROLS));
export const EFFECT_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(EFFECT_CONTROLS).flatMap(([effect, controls]) =>
    Object.entries(controls).map(([name, control]) => [`${effect}_${name}`, control.default]))
));

export function resolveEffectOrder(settings = {}) {
  if (!settings.enablePostProcessing) return [];
  const explicit = Array.isArray(settings.effectOrder) ? settings.effectOrder : [];
  return [...new Set([...explicit, ...EFFECT_ORDER])]
    .filter(effect => Object.hasOwn(EFFECT_CONTROLS, effect) && settings[`${effect}_enabled`]);
}

/** Vizz's reference-DPR grid sizing; use the render surface, not global window. */
export function effectiveTileCount(count, pixels, referencePixels) {
  return Math.max(1, Math.min(count, Math.round(count * pixels / referencePixels)));
}

/** The original frame-rate-independent feedback recurrence. */
export function feedbackFrameUniforms(settings, dt) {
  const read = key => settings[`feedback_${key}`] ?? EFFECT_DEFAULTS[`feedback_${key}`];
  const frameScale = 60 * Math.max(0, Number.isFinite(dt) ? dt : 0);
  const seconds = frameScale / 60;
  const decay = read('decay');
  const decayFrame = Math.pow(decay, frameScale);
  return {
    decayFrame,
    injectFrame: decay > 0.9995 ? frameScale : (1 - decayFrame) / (1 - decay),
    zoomFrame: Math.pow(read('zoom'), frameScale),
    rotateFrame: read('rotate') * Math.PI / 180 * seconds,
    offsetFrame: [read('offsetX') * seconds, read('offsetY') * seconds],
    hueFrame: read('hueShift') * Math.PI / 180 * seconds,
    blendModeInt: { lighten: 0, add: 1, average: 2 }[read('blendMode')] ?? 0,
  };
}

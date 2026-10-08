/**
 * Adapted from Vizz.fm with the user’s confirmed permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/app/app/page-536ef188d65bad19.js
 * Retrieved 2026-10-08. No additional license is granted.
 */
import { EFFECT_CONTROLS as LEGACY_CONTROLS } from '../mesh-grid/mesh-grid-effect-settings.js';

const ADDED_CONTROLS = {
  "barrelDistortion": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amount": {
      "type": "number",
      "label": "Distortion Amount",
      "min": -1,
      "max": 1,
      "step": 0.01,
      "default": 0.3
    },
    "amountX": {
      "type": "number",
      "label": "Distortion X Mult",
      "min": 0,
      "max": 2,
      "step": 0.01,
      "default": 1
    },
    "amountY": {
      "type": "number",
      "label": "Distortion Y Mult",
      "min": 0,
      "max": 2,
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
    "zoom": {
      "type": "number",
      "label": "Zoom",
      "min": 0.5,
      "max": 1.5,
      "step": 0.01,
      "default": 1
    },
    "chromaticAberration": {
      "type": "number",
      "label": "Chromatic Aberration",
      "min": 0,
      "max": 0.1,
      "step": 0.001,
      "default": 0
    },
    "vignette": {
      "type": "number",
      "label": "Vignette",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "vignetteSize": {
      "type": "number",
      "label": "Vignette Size",
      "min": 0,
      "max": 2,
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
  "ripple": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amplitude": {
      "type": "number",
      "label": "Amplitude",
      "min": 0,
      "max": 0.1,
      "step": 0.001,
      "default": 0.02
    },
    "frequency": {
      "type": "number",
      "label": "Frequency",
      "min": 1,
      "max": 50,
      "step": 1,
      "default": 15
    },
    "speed": {
      "type": "number",
      "label": "Speed",
      "min": 0,
      "max": 5,
      "step": 0.1,
      "default": 1
    },
    "decay": {
      "type": "number",
      "label": "Decay",
      "min": 0,
      "max": 5,
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
  "pondRipple": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amplitude": {
      "type": "number",
      "label": "Amplitude",
      "min": 0,
      "max": 0.3,
      "step": 0.001,
      "default": 0.258
    },
    "rings": {
      "type": "number",
      "label": "Rings",
      "min": 0.5,
      "max": 12,
      "step": 0.1,
      "default": 2.8
    },
    "speed": {
      "type": "number",
      "label": "Speed",
      "min": -3,
      "max": 3,
      "step": 0.05,
      "default": 0.05
    },
    "crestWidth": {
      "type": "number",
      "label": "Crest Width",
      "min": 0.02,
      "max": 0.5,
      "step": 0.01,
      "default": 0.02
    },
    "decay": {
      "type": "number",
      "label": "Decay",
      "min": 0,
      "max": 5,
      "step": 0.1,
      "default": 5
    },
    "shimmer": {
      "type": "number",
      "label": "Shimmer",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "chromatic": {
      "type": "number",
      "label": "Chromatic",
      "min": 0,
      "max": 1,
      "step": 0.01,
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
    "opacity": {
      "type": "number",
      "label": "Opacity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 1
    }
  },
  "raindrops": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amplitude": {
      "type": "number",
      "label": "Refraction",
      "min": 0,
      "max": 2,
      "step": 0.01,
      "default": 2
    },
    "density": {
      "type": "number",
      "label": "Density",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.07
    },
    "scale": {
      "type": "number",
      "label": "Scale",
      "min": 2,
      "max": 20,
      "step": 0.5,
      "default": 8
    },
    "speed": {
      "type": "number",
      "label": "Speed",
      "min": 0,
      "max": 3,
      "step": 0.05,
      "default": 0.25
    },
    "slide": {
      "type": "number",
      "label": "Slide",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.87
    },
    "blur": {
      "type": "number",
      "label": "Frost",
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
  },
  "waterDistortion": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "waveSpeed": {
      "type": "number",
      "label": "Wave Speed",
      "min": 0.1,
      "max": 5,
      "step": 0.1,
      "default": 1
    },
    "waveStrength": {
      "type": "number",
      "label": "Wave Strength",
      "min": 0.001,
      "max": 0.1,
      "step": 0.001,
      "default": 0.015
    },
    "waveScale": {
      "type": "number",
      "label": "Wave Scale",
      "min": 1,
      "max": 50,
      "step": 1,
      "default": 20
    },
    "waterColor": {
      "type": "color",
      "label": "Water Color",
      "default": "#0066ff"
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
  "hexMirror": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "tileSize": {
      "type": "number",
      "label": "Tile Size",
      "min": 0.05,
      "max": 1,
      "step": 0.01,
      "default": 0.3
    },
    "rotation": {
      "type": "number",
      "label": "Rotation",
      "min": 0,
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
    "sampleMode": {
      "type": "select",
      "label": "Sample Mode",
      "options": {
        "In Place": "local",
        "Center": "center"
      },
      "default": "local"
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
  "directionalBlur": {
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
    "angle": {
      "type": "number",
      "label": "Angle",
      "min": 0,
      "max": 360,
      "step": 1,
      "default": 0
    },
    "samples": {
      "type": "number",
      "label": "Quality (Samples)",
      "min": 4,
      "max": 32,
      "step": 2,
      "default": 12
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
  "bokehBlur": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "size": {
      "type": "number",
      "label": "Blur Size",
      "min": 0,
      "max": 10,
      "step": 0.1,
      "default": 3
    },
    "highlightBoost": {
      "type": "number",
      "label": "Highlight Boost",
      "min": 0,
      "max": 10,
      "step": 0.1,
      "default": 4
    },
    "blades": {
      "type": "number",
      "label": "Aperture Blades",
      "min": 3,
      "max": 8,
      "step": 1,
      "default": 6
    },
    "rotation": {
      "type": "number",
      "label": "Aperture Rotation",
      "min": 0,
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
  "reflection": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "waterLevel": {
      "type": "number",
      "label": "Water Level",
      "min": 0.05,
      "max": 0.6,
      "step": 0.01,
      "default": 0.3
    },
    "rippleAmount": {
      "type": "number",
      "label": "Ripple Amount",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.3
    },
    "rippleSpeed": {
      "type": "number",
      "label": "Ripple Speed",
      "min": 0,
      "max": 3,
      "step": 0.01,
      "default": 1
    },
    "blur": {
      "type": "number",
      "label": "Blur",
      "min": 0,
      "max": 3,
      "step": 0.01,
      "default": 0.35
    },
    "fade": {
      "type": "number",
      "label": "Depth Fade",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "squash": {
      "type": "number",
      "label": "Squash",
      "min": 0.25,
      "max": 1,
      "step": 0.01,
      "default": 1
    },
    "shoreline": {
      "type": "number",
      "label": "Shoreline Glow",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.25
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
  "neonEdge": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "intensity": {
      "type": "number",
      "label": "Intensity",
      "min": 0.5,
      "max": 10,
      "step": 0.1,
      "default": 3
    },
    "thickness": {
      "type": "number",
      "label": "Thickness",
      "min": 0.5,
      "max": 5,
      "step": 0.1,
      "default": 1
    },
    "threshold": {
      "type": "number",
      "label": "Threshold",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.05
    },
    "colorMode": {
      "type": "select",
      "label": "Edge Color",
      "options": {
        "Solid": "solid",
        "Source": "source",
        "Direction": "direction"
      },
      "default": "solid"
    },
    "edgeColor": {
      "type": "color",
      "label": "Solid Color",
      "default": "#00ffea"
    },
    "blendMode": {
      "type": "select",
      "label": "Blend",
      "options": {
        "Replace": "replace",
        "Add": "add"
      },
      "default": "replace"
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
  "bloom": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "threshold": {
      "type": "number",
      "label": "Threshold",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "intensity": {
      "type": "number",
      "label": "Intensity",
      "min": 0,
      "max": 3,
      "step": 0.1,
      "default": 1
    },
    "radius": {
      "type": "number",
      "label": "Radius",
      "min": 1,
      "max": 10,
      "step": 0.5,
      "default": 4
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
  "rgbShift": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "amount": {
      "type": "number",
      "label": "Shift Amount",
      "min": 0,
      "max": 0.05,
      "step": 0.001,
      "default": 0.005
    },
    "angle": {
      "type": "number",
      "label": "Shift Angle",
      "min": 0,
      "max": 6.28,
      "step": 0.01,
      "default": 0
    },
    "radial": {
      "type": "number",
      "label": "Radial Amount",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0
    },
    "falloff": {
      "type": "number",
      "label": "Radial Falloff",
      "min": 0,
      "max": 4,
      "step": 0.01,
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
  "pixelate": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "pixelSize": {
      "type": "number",
      "label": "Pixel Size",
      "min": 2,
      "max": 100,
      "step": 1,
      "default": 8
    },
    "smoothing": {
      "type": "number",
      "label": "Smoothing",
      "min": 1,
      "max": 4,
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
  "dotScreen": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "scale": {
      "type": "number",
      "label": "Scale",
      "min": 0.5,
      "max": 10,
      "step": 0.1,
      "default": 1
    },
    "angle": {
      "type": "number",
      "label": "Angle",
      "min": 0,
      "max": 6.28,
      "step": 0.01,
      "default": 1.57
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
  "glitch": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "intensity": {
      "type": "number",
      "label": "Intensity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "speed": {
      "type": "number",
      "label": "Speed",
      "min": 0.1,
      "max": 5,
      "step": 0.1,
      "default": 1
    },
    "blockSize": {
      "type": "number",
      "label": "Block Size",
      "min": 0.01,
      "max": 0.2,
      "step": 0.01,
      "default": 0.05
    },
    "colorShift": {
      "type": "number",
      "label": "Color Shift",
      "min": 0,
      "max": 0.1,
      "step": 0.005,
      "default": 0.02
    },
    "lineMode": {
      "type": "select",
      "label": "Line Mode",
      "options": {
        "Random": "random",
        "Wave (Slit-scan)": "wave",
        "Audio (hijack amp)": "audio"
      },
      "default": "random"
    },
    "lineWaveFreq": {
      "type": "number",
      "label": "Line Wave Freq",
      "min": 1,
      "max": 60,
      "step": 0.1,
      "default": 12
    },
    "lineWaveAmp": {
      "type": "number",
      "label": "Line Wave Amp",
      "min": 0,
      "max": 0.3,
      "step": 0.001,
      "default": 0.05
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
  "film": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "nIntensity": {
      "type": "number",
      "label": "Noise Intensity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5
    },
    "sIntensity": {
      "type": "number",
      "label": "Scanline Intensity",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.05
    },
    "sCount": {
      "type": "number",
      "label": "Scanline Count",
      "min": 0,
      "max": 8192,
      "step": 256,
      "default": 4096
    },
    "grayscale": {
      "type": "boolean",
      "label": "Grayscale",
      "default": true
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
  "dither": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "colorLevels": {
      "type": "number",
      "label": "Color Levels",
      "min": 2,
      "max": 16,
      "step": 1,
      "default": 4
    },
    "pixelScale": {
      "type": "number",
      "label": "Pixel Scale",
      "min": 1,
      "max": 8,
      "step": 0.5,
      "default": 2
    },
    "grayscale": {
      "type": "boolean",
      "label": "Grayscale",
      "default": false
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
  "textureOverlay": {
    "enabled": {
      "type": "boolean",
      "label": "Enable",
      "default": false
    },
    "preset": {
      "type": "select",
      "label": "Texture",
      "options": {
        "Noise": "noise",
        "Noise (Animated)": "noiseAnimated",
        "Paper": "paper",
        "Grid": "grid",
        "Dots": "dots",
        "Diagonal": "diagonal",
        "Hex Grid": "hexgrid"
      },
      "default": "noise"
    },
    "blendMode": {
      "type": "select",
      "label": "Blend Mode",
      "options": {
        "Multiply": "multiply",
        "Screen": "screen",
        "Overlay": "overlay",
        "Soft Light": "softLight",
        "Add": "add",
        "Subtract": "subtract",
        "Darken": "darken",
        "Lighten": "lighten",
        "Color Dodge": "colorDodge",
        "Color Burn": "colorBurn"
      },
      "default": "screen"
    },
    "scale": {
      "type": "number",
      "label": "Scale",
      "min": 0.1,
      "max": 10,
      "step": 0.1,
      "default": 7
    },
    "rotation": {
      "type": "number",
      "label": "Rotation",
      "min": 0,
      "max": 6.28,
      "step": 0.01,
      "default": 0
    },
    "tintColor": {
      "type": "color",
      "label": "Tint Color",
      "default": "#ffffff"
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

export const EFFECT_ORDER = Object.freeze(["feedback", "gradientMap", "gammaCorrection", "barrelDistortion", "swirl", "ripple", "pondRipple", "raindrops", "waterDistortion", "kaleidoscope", "gridTile", "concentricTile", "hexMirror", "radialBlur", "directionalBlur", "tiltShift", "bokehBlur", "reflection", "neonEdge", "bloom", "rgbShift", "pixelate", "dotScreen", "glitch", "film", "sepia", "bleachBypass", "crt", "dither", "ascii", "ledScreen", "textureOverlay"]);
export const EFFECT_NAMES = Object.freeze({
  "feedback": "Echo Trails",
  "gradientMap": "Gradient Map",
  "gammaCorrection": "Color Tone",
  "barrelDistortion": "Barrel Distortion",
  "swirl": "Swirl",
  "ripple": "Ripple",
  "pondRipple": "Pond Ripple",
  "raindrops": "Raindrops",
  "waterDistortion": "Water Distortion",
  "kaleidoscope": "Kaleidoscope",
  "gridTile": "Grid Tile",
  "concentricTile": "Concentric Tile",
  "hexMirror": "Hex Mirror",
  "radialBlur": "Radial Blur",
  "directionalBlur": "Directional Blur",
  "tiltShift": "Tilt Shift",
  "bokehBlur": "Bokeh Blur",
  "reflection": "Reflection",
  "neonEdge": "Neon Edge",
  "bloom": "Bloom",
  "rgbShift": "RGB Shift",
  "pixelate": "Pixelate",
  "dotScreen": "Dot Screen",
  "glitch": "Glitch",
  "film": "Film Grain",
  "sepia": "Sepia",
  "bleachBypass": "Bleach Bypass",
  "crt": "CRT",
  "dither": "Dither",
  "ascii": "ASCII",
  "ledScreen": "LED Screen",
  "textureOverlay": "Texture Overlay"
});
export const EFFECT_CONTROLS = Object.freeze(Object.fromEntries(EFFECT_ORDER.map(id =>
  [id, LEGACY_CONTROLS[id] ?? ADDED_CONTROLS[id]])));
export const EFFECT_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(EFFECT_CONTROLS).flatMap(([effect, controls]) =>
    Object.entries(controls).map(([key, spec]) => [`${effect}_${key}`, spec.default]))
));

/** Explicit entries first, followed by enabled effects in the source registry order. */
export function resolveEffectOrder(settings = {}) {
  if (!settings.enablePostProcessing) return [];
  const explicit = Array.isArray(settings.effectOrder) ? settings.effectOrder : [];
  return [...new Set([...explicit, ...EFFECT_ORDER])]
    .filter(id => Object.hasOwn(EFFECT_CONTROLS, id) && settings[`${id}_enabled`]);
}

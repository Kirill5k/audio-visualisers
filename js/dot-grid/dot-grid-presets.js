/**
 * Dot Grid adapted from Vizz.fm with the author's permission for personal reuse.
 * Copyright (c) 2026 Mathew Preziotte. All rights reserved.
 * Source: https://vizz.fm/_next/static/chunks/9583-5bcee8001b3090e9.js
 * Source SHA-256: 049859defa821b49da55dd5e2aa55a68489e73c1bd528081dd1507ba80971cc9
 * Retrieved 2026-10-25. No additional license is granted.
 */

export const DEFAULT_PRESET_ID = 'config-1766283127041-472';

export const PRESETS = [
  {
    "id": "config-1766283127041-472",
    "name": "Dot Grid Variant #1",
    "createdAt": "2025-12-21T02:12:07.041Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 0.7,
      "peakDecay": 0.95,
      "bassAttenuation": 0.75,
      "spectrumCap": 0.8,
      "dotColor": "#aa4444",
      "gridWidth": 64,
      "gridHeight": 64,
      "dotSize": 0.02,
      "spacing": 0.4,
      "maxScale": 4.5,
      "colorReactivity": 1,
      "barrelDistortion_enabled": true,
      "barrelDistortion_amount": -0.35,
      "barrelDistortion_amountX": 0.11,
      "barrelDistortion_amountY": 0.63,
      "barrelDistortion_centerX": 0.4,
      "barrelDistortion_chromaticAberration": 0.043,
      "barrelDistortion_opacity": 0,
      "bleachBypass_enabled": true,
      "bleachBypass_amount": 0.3,
      "cameraState": {
        "position": {
          "x": 0,
          "y": 22.367304,
          "z": -2.2e-05
        },
        "quaternion": [
          0.001517,
          0.707106,
          0.707105,
          -0.001517
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid"
  },
  {
    "id": "config-1767875526367-77",
    "name": "Dot Grid Variant #2",
    "createdAt": "2026-01-08T12:32:06.367Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 1.3,
      "noiseGate": 0.31,
      "peakDecay": 0.9,
      "bassAttenuation": 1,
      "spectrumCap": 0.6,
      "enablePostProcessing": true,
      "effectOrder": [
        "gradientMap",
        "gammaCorrection",
        "feedback",
        "concentricTile"
      ],
      "backgroundGradientColor": "#1a1a2e",
      "backgroundPlasmaScale": 3,
      "backgroundPlasmaSpeed": 0.5,
      "dotColor": "#aa4444",
      "gridWidth": 220,
      "gridHeight": 117,
      "dotSize": 0.02,
      "spacing": 0.4,
      "maxScale": 4.5,
      "colorReactivity": 1,
      "symmetricMode": true,
      "mirrorY": true,
      "trailIntensity": 0.95,
      "heightDisplacement": 3,
      "terrainSmoothing": 0.75,
      "feedback_enabled": true,
      "feedback_decay": 0.575,
      "feedback_blendMode": "add",
      "feedback_zoom": 1.01,
      "gradientMap_enabled": true,
      "gradientMap_palette": "ocean",
      "gradientMap_colorCount": 3,
      "gradientMap_opacity": 0.67,
      "gammaCorrection_enabled": true,
      "gammaCorrection_hueShift": -1.23,
      "gammaCorrection_opacity": 0.43,
      "concentricTile_enabled": true,
      "concentricTile_scaleFactor": 1.83,
      "concentricTile_mirror": true,
      "concentricTile_blend": 0.5,
      "concentricTile_innerRings": 4,
      "cameraState": {
        "position": {
          "x": 3.6e-05,
          "y": 33.115237,
          "z": -0.030173
        },
        "quaternion": [
          -0.000422,
          0.707429,
          0.706784,
          0.000422
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 66"
  },
  {
    "id": "config-1766441015772-83",
    "name": "Dot Grid Variant #3",
    "createdAt": "2025-12-22T22:03:35.772Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 1.4,
      "noiseGate": 0.31,
      "peakDecay": 0.9,
      "bassAttenuation": 1,
      "spectrumCap": 0.6,
      "enablePostProcessing": true,
      "effectOrder": [
        "gradientMap",
        "gammaCorrection",
        "barrelDistortion",
        "feedback",
        "concentricTile"
      ],
      "dotColor": "#aa4444",
      "gridWidth": 126,
      "gridHeight": 97,
      "dotSize": 0.04,
      "spacing": 0.2,
      "maxScale": 2,
      "colorReactivity": 1,
      "radialMode": true,
      "symmetricMode": true,
      "trailIntensity": 0.95,
      "spiralIntensity": 3,
      "symmetry": 6,
      "waveDelay": 0.75,
      "heightDisplacement": 0.9,
      "waveModulation": 1.8,
      "sphereIntensity": 1,
      "feedback_enabled": true,
      "feedback_decay": 0.575,
      "feedback_blendMode": "add",
      "feedback_zoom": 1.01,
      "gradientMap_enabled": true,
      "gradientMap_palette": "ocean",
      "gradientMap_colorCount": 3,
      "gradientMap_opacity": 0.67,
      "gammaCorrection_enabled": true,
      "gammaCorrection_hueShift": -1.23,
      "gammaCorrection_opacity": 0.43,
      "barrelDistortion_enabled": true,
      "barrelDistortion_amount": 1,
      "concentricTile_enabled": true,
      "concentricTile_scaleFactor": 1.83,
      "concentricTile_mirror": true,
      "concentricTile_blend": 0.5,
      "concentricTile_innerRings": 0,
      "controlModulations": {
        "spiralIntensity": {
          "enabled": true,
          "mode": "oscillate",
          "amount": 1,
          "freqStart": 0,
          "freqEnd": 1,
          "invert": false,
          "speed": 59,
          "easing": "sine",
          "min": 0,
          "max": 3
        }
      },
      "cameraState": {
        "position": {
          "x": -1.412607,
          "y": -1.362505,
          "z": 47.926289
        },
        "quaternion": [
          0.014203,
          -0.014731,
          0.000209,
          0.999791
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 5"
  },
  {
    "id": "config-1766286388222-783",
    "name": "Dot Grid Variant #4",
    "createdAt": "2025-12-21T03:06:28.222Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 1.9,
      "bassAttenuation": 1,
      "spectrumCap": 0.5,
      "enablePostProcessing": true,
      "effectOrder": [
        "gammaCorrection",
        "barrelDistortion",
        "feedback"
      ],
      "dotColor": "#aa4444",
      "gridWidth": 88,
      "gridHeight": 239,
      "dotSize": 0.01,
      "spacing": 0.2,
      "maxScale": 5.5,
      "colorReactivity": 0.85,
      "radialMode": true,
      "trailIntensity": 0.95,
      "spiralIntensity": 3,
      "waveDelay": 3,
      "heightDisplacement": 0.5,
      "feedback_enabled": true,
      "feedback_decay": 0.38,
      "feedback_blendMode": "add",
      "gammaCorrection_enabled": true,
      "gammaCorrection_gamma": 0.5,
      "gammaCorrection_hueShift": -1.43,
      "barrelDistortion_enabled": true,
      "barrelDistortion_amount": -0.07,
      "cameraState": {
        "position": {
          "x": -0.54514,
          "y": 18.549836,
          "z": 0.005818
        },
        "quaternion": [
          -0.495223,
          -0.504577,
          -0.489966,
          0.509991
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 3"
  },
  {
    "id": "config-1770516552579-966",
    "name": "Dot Grid Variant #5",
    "createdAt": "2026-02-08T02:09:12.579Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 2.1,
      "peakDecay": 0.95,
      "bassAttenuation": 0.75,
      "spectrumCap": 0.8,
      "enablePostProcessing": true,
      "effectOrder": [],
      "backgroundGradientColor": "#1a1a2e",
      "backgroundPlasmaScale": 3,
      "backgroundPlasmaSpeed": 0.5,
      "dotColor": "#aa4444",
      "gridWidth": 120,
      "gridHeight": 64,
      "dotSize": 0.01,
      "spacing": 0.4,
      "maxScale": 2.5,
      "colorReactivity": 1,
      "radialMode": true,
      "trailIntensity": 0.95,
      "spiralIntensity": 3,
      "symmetry": 4,
      "heightDisplacement": 0,
      "feedback_enabled": true,
      "feedback_zoom": 1.01,
      "gradientMap_enabled": true,
      "gradientMap_palette": "ocean",
      "controlModulations": {
        "spiralIntensity": {
          "enabled": true,
          "mode": "oscillate",
          "amount": 1,
          "freqStart": 0,
          "freqEnd": 1,
          "invert": false,
          "speed": 46.5,
          "easing": "sine",
          "min": 0,
          "max": 3
        }
      },
      "cameraState": {
        "position": {
          "x": 0,
          "y": 22.597943,
          "z": -2.3e-05
        },
        "quaternion": [
          0,
          0.707107,
          0.707106,
          0
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 21:09:12"
  },
  {
    "id": "config-1785032062543-223",
    "name": "Dot Grid Variant #6",
    "createdAt": "2026-07-26T02:14:22.543Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 0.7,
      "peakDecay": 0.95,
      "bassAttenuation": 0.75,
      "spectrumCap": 0.8,
      "backgroundType": "starfield",
      "backgroundStarDensity": 2.5,
      "backgroundTwinkleSpeed": 2.1,
      "backgroundAudioReactivity": 6.2,
      "dotColor": "#aa4444",
      "gridWidth": 64,
      "gridHeight": 43,
      "dotSize": 0.01,
      "spacing": 0.4,
      "maxScale": 1.5,
      "colorReactivity": 1,
      "mirrorY": true,
      "trailIntensity": 0.6,
      "heightDisplacement": 1,
      "waveModulation": 0,
      "sphereIntensity": 1,
      "barrelDistortion_enabled": true,
      "barrelDistortion_amount": -0.35,
      "barrelDistortion_amountX": 0.11,
      "barrelDistortion_amountY": 0.63,
      "barrelDistortion_centerX": 0.4,
      "barrelDistortion_chromaticAberration": 0.043,
      "barrelDistortion_opacity": 0,
      "bleachBypass_enabled": true,
      "bleachBypass_amount": 0.3,
      "cameraState": {
        "position": {
          "x": 0,
          "y": 22.367304,
          "z": -2.2e-05
        },
        "quaternion": [
          0,
          0.707107,
          0.707106,
          0
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 22:14:22"
  },
  {
    "id": "config-1785032283208-792",
    "name": "Dot Grid Variant #7",
    "createdAt": "2026-07-26T02:18:03.208Z",
    "data": {
      "visualizationType": "dot-grid",
      "backgroundColor": "#000000",
      "fftSize": 16384,
      "gain": 0.7,
      "peakDecay": 0.95,
      "bassAttenuation": 0.75,
      "spectrumCap": 0.8,
      "enablePostProcessing": true,
      "effectOrder": [
        "gridTile",
        "bleachBypass",
        "gradientMap"
      ],
      "dotColor": "#aa4444",
      "gridWidth": 64,
      "gridHeight": 43,
      "dotSize": 0.02,
      "spacing": 0.2,
      "maxScale": 1.5,
      "colorReactivity": 1,
      "mirrorY": true,
      "trailIntensity": 0.6,
      "heightDisplacement": 1,
      "waveModulation": 0,
      "sphereIntensity": 1,
      "gradientMap_enabled": true,
      "gradientMap_palette": "ice",
      "gridTile_enabled": true,
      "gridTile_rows": 3,
      "gridTile_zoom": 0.73,
      "gridTile_overlap": 0.43,
      "gridTile_rotationStep": 47,
      "bleachBypass_enabled": true,
      "bleachBypass_amount": 0.3,
      "cameraState": {
        "position": {
          "x": 0,
          "y": 22.367304,
          "z": -2.2e-05
        },
        "quaternion": [
          0,
          0.707107,
          0.707106,
          0
        ],
        "target": {
          "x": 0,
          "y": 0,
          "z": 0
        },
        "zoom": 1
      }
    },
    "sourceName": "Dot Grid 22:18:03"
  }
];

// A fresh object per scene keeps the interactive pages and capture checks aligned.
export function createStarfieldSettings() {
  return {
    density: 1, brightness: 1, bloom: true, speed: 1, drift: .4, gain: 1.25,
    starSize: 1, nebula: 1, colorLow: '#527fa7', colorHigh: '#e5efff', pulse: 1.3,
    connectionColor: '#e8d2a0', linkLife: 1.2, linkReach: 1, connectionStrength: 1,
    dustRivers: true, dustDensity: .7, dustBrightness: 1, dustWidth: 1,
    dustFlow: 1, dustResponse: 1,
    wavefronts: true, waveStrength: 1, waveSpeed: 1, waveWidth: 1,
    nebulaBreathing: true, breathDepth: 1, breathSpeed: 1, breathResponse: 1,
  };
}

import * as THREE from 'three';
import { buildPeakTree } from '../atlas/signal-atlas-peak-tree.js';

/** Full-resolution, absolute-frame ring shared by the atlas and terrain.
 * A projector may remap a complete row before upload; it must return Uint16
 * values in the same 0…65535 encoding as the source FFT. */
export function createSpectralHistory(renderer, {
  bins = 16384, rows = 1442, peakTree = true, projectSpectrum = null, filter = THREE.LinearFilter,
} = {}) {
  const halfLut = new Uint16Array(65536);
  for (let i = 0; i < halfLut.length; i++) halfLut[i] = THREE.DataUtils.toHalfFloat(i / 65535);
  const historyData = new Uint16Array(bins * rows);
  const peakTreeData = peakTree ? new Uint16Array(bins * rows) : null;
  const stamps = new Int32Array(rows).fill(-999999);
  let latestFrame = -1;
  let disposed = false;

  function makeTexture(data, filter) {
    const texture = new THREE.DataTexture(data, bins, rows, THREE.RedFormat, THREE.HalfFloatType);
    texture.minFilter = texture.magFilter = filter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    renderer.initTexture(texture);
    return texture;
  }
  const texture = makeTexture(historyData, filter);
  const peakTreeTexture = peakTree ? makeTexture(peakTreeData, THREE.NearestFilter) : null;
  const stores = [[texture, historyData]];
  if (peakTree) stores.push([peakTreeTexture, peakTreeData]);

  function setFrames(frames) {
    if (disposed || !frames?.length) return;
    const updated = [];
    for (const entry of frames) {
      if (entry.frame < 0) continue;
      const row = entry.frame % rows;
      if (stamps[row] === entry.frame) continue;
      const offset = row * bins;
      const source = projectSpectrum ? projectSpectrum(entry.spectrum) : entry.spectrum;
      for (let i = 0; i < bins; i++) historyData[offset + i] = halfLut[source[i]];
      if (peakTree) buildPeakTree(historyData, peakTreeData, bins, offset, offset);
      stamps[row] = entry.frame;
      latestFrame = Math.max(latestFrame, entry.frame);
      updated.push(row);
    }
    if (!updated.length) return;
    if (updated.length > 48) {
      for (const [rowTexture] of stores) {
        rowTexture.needsUpdate = true;
        renderer.initTexture(rowTexture);
      }
    } else {
      const gl = renderer.getContext();
      renderer.state.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (const [rowTexture, rowData] of stores) {
        renderer.initTexture(rowTexture);
        const gpuTexture = renderer.properties.get(rowTexture).__webglTexture;
        renderer.state.activeTexture(gl.TEXTURE0);
        renderer.state.bindTexture(gl.TEXTURE_2D, gpuTexture);
        for (const row of updated) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, bins, 1, gl.RED, gl.HALF_FLOAT,
            rowData.subarray(row * bins, (row + 1) * bins));
        }
      }
    }
    renderer.resetState();
  }

  function reset() {
    historyData.fill(0);
    peakTreeData?.fill(0);
    stamps.fill(-999999);
    latestFrame = -1;
    for (const [rowTexture] of stores) rowTexture.needsUpdate = true;
  }

  function dispose() {
    disposed = true;
    for (const [rowTexture] of stores) rowTexture.dispose();
  }

  return {
    texture, peakTreeTexture, setFrames, reset, dispose,
    get latestFrame() { return latestFrame; },
    getInfo: () => ({ historyRows: rows, historyBytes: historyData.byteLength,
      peakTreeBytes: peakTreeData?.byteLength || 0 }),
  };
}

/** Inclusive interval maxima preserve isolated peaks between log-axis probes. */
export function createSpectralSampling({ bins = 16384, rows = 1442, fftSize = 32768 } = {}) {
  return `
  uniform sampler2D uHistory;
  uniform sampler2D uPeakTree;
  uniform float uFrame;
  uniform float uSampleRate;
  uniform float uGain;
  const float ROWS = ${rows}.0;
  const float BINS = ${bins}.0;
  float historySample(float bin, float frame) {
    if (frame < 0.0) return 0.0;
    float row = mod(floor(frame), ROWS);
    return texture2D(uHistory, vec2((clamp(bin, 0.0, BINS - 1.0) + .5) / BINS, (row + .5) / ROWS)).r;
  }
  float binAt(float x) {
    float knee = 30.0 * ${fftSize}.0 / uSampleRate;
    return knee * (pow(1.0 + (BINS - 1.0) / knee, clamp(x, 0.0, 1.0)) - 1.0);
  }
  float treeSample(float node, float frame) {
    if (node >= BINS) return historySample(node - BINS, frame);
    float row = mod(floor(frame), ROWS);
    return texture2D(uPeakTree, vec2((node + .5) / BINS, (row + .5) / ROWS)).r;
  }
  float intervalPeak(float first, float last, float frame) {
    if (frame < 0.0) return 0.0;
    float left = BINS + clamp(floor(first), 0.0, BINS - 1.0);
    float right = BINS + clamp(ceil(last), 0.0, BINS - 1.0);
    float peak = 0.0;
    for (int level = 0; level < 15; level++) {
      if (left > right) break;
      if (mod(left, 2.0) > .5) {
        peak = max(peak, treeSample(left, frame));
        left += 1.0;
      }
      if (mod(right, 2.0) < .5) {
        peak = max(peak, treeSample(right, frame));
        right -= 1.0;
      }
      left = floor(left * .5);
      right = floor(right * .5);
    }
    return peak;
  }
  float spectrum(float x, float halfSpan, float frame) {
    float first = binAt(x - halfSpan);
    float last = binAt(x + halfSpan);
    float a = intervalPeak(first, last, floor(frame));
    float fraction = fract(frame);
    if (fraction < .000001) return a;
    float b = intervalPeak(first, last, floor(frame) + 1.0);
    return mix(a, b, fraction);
  }
`;
}

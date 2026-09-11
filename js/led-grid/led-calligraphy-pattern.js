/** Real stereo PCM, drawn as two interweaving strokes on one flat LED plane. */
const COLUMNS = 96, ROWS = 54, COUNT = COLUMNS * ROWS;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const feature = value => clamp(Number(value) || 0);

/** Four floats per LED: energy, cool mix, amber mix, peak white. */
export function writeCalligraphy(data = {}, settings = {}, output = new Float32Array(COUNT * 4)) {
  output.fill(0);
  const gain = Math.max(0, Number.isFinite(Number(settings.gain)) ? Number(settings.gain) : 1.3);
  const frames = data.waveform?.frames;
  if (!gain || !frames?.length) return output;
  const persistence = clamp(Number(settings.persistence) || 1, .15, 3);
  const features = data.features || {};
  const time = Math.max(0, Number(data.time) || 0);
  let kick = feature(features.onsets?.[0]);
  let accent = Math.max(kick, feature(features.onsets?.[1]), feature(features.onsets?.[2]));
  let penAttack = -Infinity;
  for (const event of data.events || []) {
    const age = time - Number(event.time);
    if (!Number.isFinite(age) || age < 0 || age > .5) continue;
    if (event.band === 0 && feature(event.strength) > .16) penAttack = Math.max(penAttack, Number(event.time));
    const strength = feature(event.strength) * Math.exp(-age / .09);
    accent = Math.max(accent, strength);
    if (event.band === 0) kick = Math.max(kick, strength);
  }
  kick = clamp(kick * 2); accent = clamp(accent * 1.6);
  const stereoWidth = feature(features.width);
  const balance = clamp(Number(features.balance) || 0, -1, 1);

  function segment(ax, ay, bx, by, radius, intensity, cool, warm, peak) {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - .6));
    const maxX = Math.min(COLUMNS - 1, Math.ceil(Math.max(ax, bx) + radius + .6));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - .6));
    const maxY = Math.min(ROWS - 1, Math.ceil(Math.max(ay, by) + radius + .6));
    const dx = bx - ax, dy = by - ay;
    const inverseLength = 1 / Math.max(.0001, dx * dx + dy * dy);
    for (let row = minY; row <= maxY; row++) for (let column = minX; column <= maxX; column++) {
      const t = clamp(((column - ax) * dx + (row - ay) * dy) * inverseLength);
      const distance = Math.hypot(column - ax - dx * t, row - ay - dy * t);
      const coverage = clamp(radius + .6 - distance);
      const value = intensity * coverage;
      const index = (row * COLUMNS + column) * 4;
      // Pick the brighter ink at crossings. There is no additive stack that
      // could imply separate layers or blow a crossing into a white blob.
      if (value <= output[index]) continue;
      output[index] = Math.min(5, value);
      output[index + 1] = cool;
      output[index + 2] = warm;
      output[index + 3] = peak * clamp(1 - distance / (radius + .1));
    }
  }

  // Old ink is dim and brief; all shapes are reconstructed directly from
  // absolute PCM time, including after seeking, mode changes and export.
  for (let frameIndex = Math.min(2, frames.length - 1); frameIndex >= 0; frameIndex--) {
    const frame = frames[frameIndex];
    if (!frame?.left?.length || !frame?.right?.length || frame.time < 0) continue;
    const combinedRms = Math.sqrt(((Number(frame.rmsLeft) || 0) ** 2 + (Number(frame.rmsRight) || 0) ** 2) * .5);
    if (combinedRms <= .00005) continue;
    const level = clamp((combinedRms - .001) * 5.8);
    if (level <= 0) continue;
    const age = Math.max(0, Number(frame.age) || 0);
    if (frameIndex > 0 && level < .45) continue;
    const trail = frameIndex === 0 ? 1 : Math.exp(-age / (.027 * persistence)) * .12;
    const amplitude = 20 - stereoWidth * 3;
    const radius = (frameIndex ? .36 : .46) + feature(features.bass) * .12 + kick * .4;
    // These are luminous coloured strokes, not white HDR ribbons. The scene
    // supplies the bright LED core; spare emission is reserved for attacks.
    const energy = Math.pow(level, 1.1) * 1.05 * gain * trail * (1 + kick * .32);
    const inkOffset = frameIndex * (1.1 + feature(features.mids) * .7);
    const channels = [frame.left, frame.right];
    const channelRms = [Number(frame.rmsLeft) || 0, Number(frame.rmsRight) || 0];
    const bothChannels = Math.min(...channelRms) > Math.max(...channelRms) * .015;
    const hero = channelRms[0] < channelRms[1] * .015 ? 1 : 0;
    const drawn = .6 + .4 * clamp((time - penAttack) / .15);
    const span = (47 + 40 * Math.pow(level, .7)) * drawn;
    for (let channel = 0; channel < 2; channel++) {
      if (channelRms[channel] <= .00005) continue;
      // Identical mono channels form one stroke; true stereo separates the
      // two only as far as its width warrants. Opposite phase stays visible.
      if (channel === 1 && stereoWidth < .025 && bothChannels) continue;
      const secondary = channel !== hero;
      const sign = channel === 0 ? 1 : -1;
      const center = 26.5 + sign * stereoWidth * 4 + balance * 1.5 - sign * inkOffset;
      const points = channels[channel];
      const channelLevel = clamp(channelRms[channel] / Math.max(.001, combinedRms), .15, 1.3);
      const count = points.length;
      // A short triangular reconstruction removes sub-cell PCM chatter while
      // retaining the actual contour. Timbre still changes its lobes, and
      // unfiltered RMS retains an immediate response to high-frequency hits.
      const smooth = point => {
        let total = 0;
        for (let offset = -3; offset <= 3; offset++) total += (Number(points[clamp(point + offset, 0, count - 1)]) || 0) * (4 - Math.abs(offset));
        return total / 16;
      };
      const length = span * (secondary ? .76 : 1);
      const firstX = 47.5 - length * .5 + balance * 2 + (secondary ? 5 : 0);
      const lean = (feature(features.mids) - feature(features.bass)) * 10 + balance * 5;
      const ordinate = (sample, position) => clamp(center + Math.atan(sample * 2.9) / 1.15 * amplitude * (secondary ? .78 : 1)
        + (position - .5) * lean + Math.sin(position * Math.PI) * (feature(features.mids) - feature(features.highs)) * 3, 3, 50);
      let previousX = firstX;
      let previousY = ordinate(smooth(0), 0);
      for (let point = 1; point < count; point++) {
        const position = point / (count - 1);
        const x = firstX + position * length;
        const sample = smooth(point);
        const y = ordinate(sample, position);
        const edge = Math.pow(Math.sin(position * Math.PI), .55);
        const local = clamp(Math.abs(sample) / Math.max(.035, channelRms[channel] * 2.1));
        const warm = clamp((channel ? .92 : .02) + (local - .42) * .18 + (frameIndex ? 0 : accent * local * .35));
        const white = frameIndex ? 0 : accent * Math.pow(clamp((local - .58) / .42), 2) * .75;
        const cool = clamp((channel ? .16 : .8) + sample * .35);
        const accentInk = secondary ? clamp((local - .08) / .45) * .72 : 1;
        const penHead = Math.exp(-(((position - .84) / .10) ** 2)) * kick;
        const weight = radius * (.55 + local * .45) + penHead * .3;
        segment(previousX, previousY, x, y, weight, energy * channelLevel * edge * (.63 + local * .37 + penHead * .5) * accentInk, cool, warm, white);
        previousX = x; previousY = y;
      }
    }
  }
  return output;
}

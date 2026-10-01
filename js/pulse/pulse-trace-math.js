const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const bound = (value, low, high) => Math.max(low, Math.min(high, value));

export function pulseHistorySeconds(settings = {}) {
  return bound(finite(settings.historySeconds, 15), 5, 60);
}

export function pulseTraceSettings(settings = {}) {
  return {
    historySeconds: pulseHistorySeconds(settings),
    head: bound(finite(settings.head, .98), .4, 1),
    gain: bound(finite(settings.gain, 1.15), .4, 4),
    height: bound(finite(settings.height, 1.9), .2, 6),
    baseline: bound(finite(settings.baseline, -.9), -.9, .9),
    transient: bound(finite(settings.transient, .85), 0, 1.2),
    smoothingRadius: Math.round(bound(finite(settings.waveSmoothness, .1), 0, 1) * 18),
    thickness: bound(finite(settings.waveThickness, 1.6), 0, 8),
    glow: bound(finite(settings.waveGlow, .14), 0, 1),
  };
}

/** Cardiogram's display math, read from immutable absolute-frame envelopes.
 * Resampling/smoothing is deliberately independent of the playback frame rate. */
export function createCardiogramPath(history, time, band, settings, plot, { columns = 2048, fps = 60, latestFrame = -1 } = {}) {
  const config = pulseTraceSettings(settings);
  const values = new Float64Array(columns);
  const latest = history.get(latestFrame);
  const envelope = row => config.gain * (finite(row?.fast?.[band]) - config.transient * finite(row?.slow?.[band]));
  const sample = position => {
    if (position < 0) return 0;
    if (latest && position >= latest.time) return envelope(latest);
    const exact = position * fps;
    const low = Math.floor(exact + 1e-8), fraction = bound(exact - low, 0, 1);
    const a = history.get(low), b = history.get(low + 1) || a;
    const value = envelope(a);
    return value + (envelope(b) - value) * fraction;
  };
  for (let column = 0; column < columns; column++) {
    values[column] = sample(time - config.historySeconds + column / (columns - 1) * config.historySeconds);
  }
  const points = new Array(columns);
  const stride = plot.h / 3, half = stride * .42;
  const centre = plot.y + (band + .5) * stride;
  const radius = config.smoothingRadius;
  for (let column = 0; column < columns; column++) {
    let value = values[column];
    if (radius > 0) {
      let weighted = 0, totalWeight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const weight = radius + 1 - Math.abs(offset);
        weighted += values[bound(column + offset, 0, columns - 1)] * weight;
        totalWeight += weight;
      }
      value = weighted / totalWeight;
    }
    const shaped = Math.tanh(value * config.height);
    const norm = config.baseline + shaped * (shaped >= 0 ? 1 - config.baseline : 1 + config.baseline);
    points[column] = [plot.x + column / (columns - 1) * plot.w * config.head, centre - norm * half];
  }
  return { points, head: points.at(-1), baseline: centre - config.baseline * half, config };
}

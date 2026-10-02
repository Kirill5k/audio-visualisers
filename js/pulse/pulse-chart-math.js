const clamp = value => Math.max(0, Math.min(1, value));

/** Absolute frame neighbours keep a seek and uninterrupted playback identical. */
export function timbreTrail(history, rows, time, seconds) {
  const samples = [];
  for (const row of rows) {
    if (!(row.brightness > 0) || !Number.isFinite(row.rmsDb) || row.rmsDb <= -95) continue;
    let brightness = 0, level = 0, weight = 0;
    for (let ago = 0; ago < 5; ago++) {
      const prior = history.get(row.frame - ago);
      if (!(prior?.brightness > 0) || !Number.isFinite(prior.rmsDb) || prior.rmsDb <= -95) continue;
      const w = 5 - ago;
      brightness += Math.log2(Math.max(20, prior.brightness)) * w;
      level += prior.rmsDb * w;
      weight += w;
    }
    samples.push({ frame: row.frame, time: row.time, x: brightness / weight, y: level / weight,
      age: clamp(1 - (time - row.time) / seconds) });
  }
  let minX = Math.log2(1000), maxX = minX, minY = -24, maxY = -18;
  for (const sample of samples) {
    minX = Math.min(minX, sample.x); maxX = Math.max(maxX, sample.x);
    minY = Math.min(minY, sample.y); maxY = Math.max(maxY, sample.y);
  }
  const lowX = Math.floor((minX - .2) * 2) / 2;
  const highX = Math.max(lowX + 1.5, Math.ceil((maxX + .2) * 2) / 2);
  const lowY = Math.max(-96, Math.floor((minY - 3) / 6) * 6);
  const highY = Math.min(0, Math.max(lowY + 18, Math.ceil((maxY + 3) / 6) * 6));
  const points = samples.map(sample => ({ ...sample,
    x: clamp((sample.x - lowX) / (highX - lowX)),
    y: clamp((sample.y - lowY) / (highY - lowY)),
  }));
  const newest = samples.at(-1);
  const current = newest && time - newest.time < .05 ? newest : null;
  return { points, lowX, highX, lowY, highY,
    head: current ? points.at(-1) : null,
    brightness: current ? 2 ** current.x : 0, rmsDb: current?.y ?? -96 };
}

/** One-second bins and statistics all share the same visible time interval. */
export function activityStrip(rows, time, seconds) {
  const start = time - seconds;
  const events = rows.filter(row => row.onset > 0 && row.time >= start && row.time <= time)
    .map(row => ({ time: row.time, strength: clamp(row.onset) }));
  const count = Math.max(1, Math.round(seconds));
  const rates = new Array(count).fill(0);
  for (const event of events) rates[Math.min(count - 1, Math.floor((event.time - start) / seconds * count))]++;
  const recentSeconds = Math.min(2, Math.max(0, time));
  const recent = events.filter(event => event.time >= time - recentSeconds).length;
  const duration = Math.min(seconds, Math.max(0, time));
  const maxRate = Math.max(4, Math.ceil(Math.max(...rates) / 2) * 2);
  const smoothed = rates.map((_, index) => {
    const neighbours = rates.slice(Math.max(0, index - 1), Math.min(count, index + 2));
    return neighbours.reduce((sum, rate) => sum + rate, 0) / neighbours.length;
  });
  return { events, rates, smoothed, maxRate, count: events.length,
    recent: recentSeconds ? recent / recentSeconds : 0, mean: duration ? events.length / duration : 0 };
}

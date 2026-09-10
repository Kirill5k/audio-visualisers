/** Map measured stereo loudness to a bounded hue shift. The meter timeline
 * already smooths attack/release, so this stays deterministic across seeks. */
export function terrainEnergy(levels) {
  const left = Number.isFinite(levels?.lRms) ? Math.max(0, levels.lRms) : 0;
  const right = Number.isFinite(levels?.rRms) ? Math.max(0, levels.rRms) : 0;
  const rms = Math.hypot(left, right) / Math.SQRT2;
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  const amount = Math.max(0, Math.min(1, (db + 42) / 32));
  return amount * amount * (3 - 2 * amount);
}

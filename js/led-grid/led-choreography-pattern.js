/** Musical, planar graphic forms, rasterized onto the fixed 96 × 54 board. */
const COLUMNS = 96;
const ROWS = 54;
const COUNT = COLUMNS * ROWS;
const clamp = (number, low = 0, high = 1) => Math.max(low, Math.min(high, number));
const finite = (number, fallback = 0) => Number.isFinite(Number(number)) ? Number(number) : fallback;
const level = number => clamp(finite(number));
const hash = seed => {
  let bits = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  bits = Math.imul(bits ^ (bits >>> 13), 0xc2b2ae35);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
};

/** Four floats per fixed LED: energy, cool mix, amber mix, white peak.
 * Geometry has no free-running clock. Canonical attacks select a graphic pose;
 * current band envelopes articulate it. Seeking cannot change that pose.
 */
export function writeChoreography(data = {}, settings = {}, output = new Float32Array(COUNT * 4)) {
  output.fill(0);
  const time = Math.max(0, finite(data.time));
  const gain = Math.max(0, finite(settings.gain, 1.3));
  if (gain === 0) return output;
  const persistence = clamp(finite(settings.persistence, 1), .15, 3);
  const features = data.features || {};
  const bands = data.bands || [];
  const bass = level(features.bass), mids = level(features.mids), highs = level(features.highs);
  const attacks = [0, 1, 2].map(group => clamp(level(features.onsets?.[group]) * 2.1));
  let bandMaximum = 0, bandSum = 0, spectralMoment = 0;
  for (let band = 0; band < COLUMNS; band++) {
    const strength = level(bands[band]);
    bandMaximum = Math.max(bandMaximum, strength);
    bandSum += strength;
    spectralMoment += strength * band / (COLUMNS - 1);
  }
  const centroid = bandSum > .00001 ? spectralMoment / bandSum : .5;
  let energy = Math.max(level(features.energy), bass * .62, mids * .62, highs * .62,
    bandMaximum * .42 + bandSum / COLUMNS * .58);
  let anchor = null, anchorGroup = 4, anchorBucket = -1;
  for (const event of data.events || []) {
    const sourceTime = finite(event.time, -100), age = time - sourceTime;
    const group = finite(event.band, -1), strength = level(event.strength);
    if (!Number.isInteger(group) || group < 0 || group > 2 || sourceTime < 0 || age < 0 || age > 6 || strength === 0) continue;
    const attack = clamp(Math.sqrt(strength) * 1.35) * Math.exp(-age / (.105 * Math.sqrt(persistence)));
    attacks[group] = Math.max(attacks[group], attack);
    energy = Math.max(energy, strength * .28 * Math.exp(-age / (.42 * persistence)));
    // One first attack per musical time window prevents several simultaneous
    // band detections from producing a rapid sequence of unrelated silhouettes.
    if (group === 2 || strength < (group === 0 ? .15 : .24)) continue;
    const bucket = Math.floor(sourceTime / 2.8);
    if (bucket > anchorBucket || (bucket === anchorBucket &&
      (sourceTime < anchor.time || (sourceTime === anchor.time && group < anchorGroup)))) {
      anchor = { time: sourceTime, strength, balance: clamp(finite(event.balance), -1, 1) };
      anchorGroup = group;
      anchorBucket = bucket;
    }
  }
  const rawDynamic = Number.isFinite(features.rms) ? .55 + .45 * clamp(features.rms / .16) : 1;
  const activity = Math.pow(clamp((energy - .035) / .86), 1.7) * rawDynamic;
  if (!(activity > .00001)) return output;

  const kick = attacks[0], snare = attacks[1], tick = attacks[2];
  const accent = Math.max(kick, snare, tick);
  const seed = anchor ? Math.round(anchor.time * 60) * 47 + anchorGroup * 971 : 7919;
  const family = anchor ? Math.floor(hash(seed + 31) * 5) : bass >= mids && bass >= highs ? 0 : mids >= highs ? 1 : 2;
  const polarity = hash(seed + 79) > .5 ? 1 : -1;
  const width = level(features.width);
  const balance = clamp(finite(features.balance), -1, 1);
  const centerX = 47.5 + balance * 5 + (centroid - .4) * 9;
  const centerY = 26.5 + (mids - bass) * 2.5;
  const stretchX = .91 + width * .08 + mids * .07 + snare * .075;
  const stretchY = .80 + bass * .18 + kick * .13;
  const stroke = .62 + activity * .65 + bass * .2 + kick * .45;
  // A beat stamps a pose; the release rotates that same graphic back toward
  // its resting angle. Low energy leaves a single hero stroke on the board.
  const release = anchor ? Math.exp(-(time - anchor.time) / .48) : 0;
  const assembly = anchor ? .65 + .35 * clamp((time - anchor.time) / .24) : 1;
  const turn = (hash(seed + 181) - .5) * .2 + polarity * release * .16;
  const cosine = Math.cos(turn), sine = Math.sin(turn);
  const paths = [];
  const add = (points, weight = 1, visibility = 0, reverse = false) => {
    paths.push({ points: points.map(([x, y]) => {
      x *= stretchX * polarity; y *= stretchY;
      return [x * cosine - y * sine, x * sine + y * cosine];
    }), weight, visibility, reverse });
  };
  const spread = 17 + width * 3 + kick * 1.8;

  if (family === 0) {
    // Interlocking open diamonds. The dark interiors remain large enough to
    // read as a single graphic even when viewed at full-board scale.
    add([[-spread, 0], [0, 21], [spread, 0], [0, -21], [-spread, 0]], 1.08);
    add([[-39, 0], [-22, 18], [-5, 0], [-22, -18], [-39, 0]], .82, .24, true);
    add([[39, 0], [22, -18], [5, 0], [22, 18], [39, 0]], .82, .36);
    if (highs + tick > .22) add([[-8, 0], [0, 9 + highs * 3], [8, 0], [0, -9 - highs * 3]], .65, .52, true);
  } else if (family === 1) {
    // Counter-moving chevrons with a small central lozenge. Midrange opens the
    // arms while the kick snaps their tips toward the centre.
    const reach = 8 + snare * 3.5, arm = 20 - mids * 3;
    add([[-37, arm], [-reach, 0], [-37, -arm]], 1.2);
    add([[37, -arm], [reach, 0], [37, arm]], 1.2, .13, true);
    add([[-22, 21], [-1, 0], [-22, -21]], .65, .37, true);
    add([[22, -21], [1, 0], [22, 21]], .65, .49);
    add([[0, 8], [6, 0], [0, -8], [-6, 0], [0, 8]], .72, .29);
  } else if (family === 2) {
    // An open lightning mark reads in one direction without crossed hooks.
    const notch = 7 + mids * 5;
    add([[-36, -20], [notch, -3], [-notch, 9], [36, 20]], 1.2);
    add([[-34, -9], [-11, -1], [-19, 12], [12, 22]], .73, .32, true);
    add([[34, 9], [11, 1], [19, -12], [-12, -22]], .6, .50);
  } else if (family === 3) {
    // An off-centre fan opens one ray at a time from a single focal vertex.
    const pivot = [-27 + snare * 3, -11];
    add([[24, 22], pivot, [36, 6]], 1.15);
    add([pivot, [33, -12]], .85, .24, true);
    add([pivot, [15, -22]], .76, .39);
    add([[-27, -5], [-21, -11], [-27, -17], [-33, -11], [-27, -5]], .8, .47);
  } else {
    // A large sail and two small facets form an asymmetric triangular group.
    const peak = 18 + kick * 3;
    add([[-35, -19], [-10, peak], [12, -16], [-35, -19]], 1.15);
    add([[6, -12], [25, 15], [38, -12], [6, -12]], .85, .27, true);
    add([[8, 20], [16, 6], [25, 20]], .65, .49);
  }

  // Keep rotated poses inside the same flat board, including stereo offsets.
  let extentX = 1, extentY = 1;
  for (const path of paths) for (const [x, y] of path.points) {
    extentX = Math.max(extentX, Math.abs(x)); extentY = Math.max(extentY, Math.abs(y));
  }
  const fit = Math.min(1, (43 - Math.abs(centerX - 47.5)) / extentX, (23 - Math.abs(centerY - 26.5)) / extentY) * (.58 + .42 * Math.sqrt(activity));
  for (const path of paths) for (const point of path.points) {
    point[0] = centerX + point[0] * fit; point[1] = centerY + point[1] * fit;
  }

  let pathIndex = 0;
  for (const path of paths) {
    const visible = clamp((activity + accent * .16 - path.visibility) / .28);
    if (visible === 0) { pathIndex++; continue; }
    const lengths = [];
    let totalLength = 0;
    for (let point = 1; point < path.points.length; point++) {
      const [ax, ay] = path.points[point - 1], [bx, by] = path.points[point];
      const length = Math.hypot(bx - ax, by - ay);
      lengths.push(length); totalLength += length;
    }
    let distance = 0;
    const colourOrigin = hash(seed + pathIndex * 113 + 67);
    const hotVertex = Math.floor(hash(seed + pathIndex * 199 + 13) * (path.points.length - 1));
    for (let segment = 0; segment < lengths.length; segment++) {
      const [ax, ay] = path.points[segment], [bx, by] = path.points[segment + 1];
      const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
      const halfWidth = stroke * (pathIndex === 0 ? 1 : .82);
      const radius = halfWidth + .6;
      const firstX = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
      const lastX = Math.min(COLUMNS - 1, Math.ceil(Math.max(ax, bx) + radius));
      const firstY = Math.max(0, Math.floor(Math.min(ay, by) - radius));
      const lastY = Math.min(ROWS - 1, Math.ceil(Math.max(ay, by) + radius));
      const segmentReveal = clamp((activity + accent * .12 - (segment % 3) * .055) / .18);
      for (let row = firstY; row <= lastY; row++) for (let column = firstX; column <= lastX; column++) {
        const u = clamp(((column - ax) * dx + (row - ay) * dy) / lengthSquared);
        const perpendicular = Math.hypot(column - ax - u * dx, row - ay - u * dy);
        const edge = clamp(halfWidth + .5 - perpendicular);
        if (edge === 0) continue;
        let along = (distance + lengths[segment] * u) / totalLength;
        if (path.reverse) along = 1 - along;
        const drawn = clamp((assembly - along) * 14);
        if (drawn === 0) continue;
        // All 96 retained column intervals contribute along every long stroke;
        // interpolation avoids an arbitrary single-bin lookup at the corners.
        const spectralPosition = along * (COLUMNS - 1);
        const low = Math.floor(spectralPosition), high = Math.min(COLUMNS - 1, low + 1);
        const spectral = level(bands[low]) * (1 - spectralPosition + low) + level(bands[high]) * (spectralPosition - low);
        const pulse = Math.exp(-(((along - centroid) / (.075 + highs * .035)) ** 2));
        const vertex = segment === hotVertex ? Math.exp(-u * u * 110)
          : segment + 1 === hotVertex ? Math.exp(-((1 - u) ** 2) * 110) : 0;
        const intensity = edge * visible * drawn * segmentReveal * path.weight * gain * Math.pow(activity, .78)
          * (.80 + spectral * .52 + pulse * mids * .44 + accent * .55 + vertex * accent * 1.10);
        const offset = (row * COLUMNS + column) * 4;
        if (intensity <= output[offset]) continue;
        const warmCenter = .14 + centroid * .60;
        const warmZone = Math.exp(-(((along - warmCenter) / .16) ** 2));
        output[offset] = clamp(intensity, 0, 5);
        output[offset + 1] = clamp(.12 + colourOrigin * .58 + along * .20 + highs * .10);
        output[offset + 2] = clamp(warmZone * (.62 + bass * .34 + accent * .30) + vertex * accent * .22);
        output[offset + 3] = vertex * clamp((accent - .43) * 1.8);
      }
      distance += lengths[segment];
    }
    pathIndex++;
  }
  return output;
}

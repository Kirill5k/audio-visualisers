import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLEDFrameReader, ANALYSIS_FPS, BAND_COUNT, GRID_ROWS, HISTORY_SECONDS, FEATURE_STRIDE,
} from '../js/led-grid/led-analysis-core.js';

const rowSeconds = HISTORY_SECONDS / GRID_ROWS;
const sourceTime = 1;
const sourceFrame = sourceTime * ANALYSIS_FPS;
const peakColumn = 40;
const encodedPeak = 60000;
const peak = encodedPeak / 65535;

function makeTimeline() {
  const duration = 8, frames = duration * ANALYSIS_FPS + 1;
  return {
    duration, frames, sampleRate: 48000,
    bands: new Uint16Array(frames * BAND_COUNT),
    features: new Float32Array(frames * FEATURE_STRIDE), events: [],
  };
}

function isolatedPeak() {
  const timeline = makeTimeline();
  timeline.bands[sourceFrame * BAND_COUNT + peakColumn] = encodedPeak;
  return createLEDFrameReader(timeline);
}

const column = (history, index = peakColumn) =>
  Array.from({ length: GRID_ROWS }, (_, row) => history[row * BAND_COUNT + index]);
const maxDifference = (a, b) => a.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - b[index])), 0);
function centroid(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return total ? values.reduce((sum, value, row) => sum + row * value, 0) / total : null;
}

test('Loom history lights a causal one-frame attack immediately without anticipating it', () => {
  const at = isolatedPeak();
  assert.ok(at(sourceTime - 0.000001).history.every(value => value === 0));
  const arrival = column(at(sourceTime).history);
  assert.ok(Math.abs(arrival[0] - peak) < 1e-7, 'The new attack must not wait for an interpolation window');
  assert.ok(arrival.slice(1).every(value => value === 0));
});

test('Loom history preserves isolated full peaks at every row centre', () => {
  const at = isolatedPeak();
  for (let row = 0; row < GRID_ROWS; row++) {
    const values = column(at(sourceTime + (row + 0.5) * rowSeconds).history);
    assert.ok(Math.abs(values[row] - peak) < 1e-7, `Row ${row} must retain the brief peak rather than average it away`);
    assert.equal(values.filter(value => value > 1e-7).length, 1, `Row ${row} should remain a distinct LED row`);
  }
});

test('Loom history moves at fractional audio times within the same 60 Hz analysis frame', () => {
  const at = isolatedPeak();
  const boundary = sourceTime + rowSeconds;
  const firstTime = boundary + 0.001, secondTime = boundary + 0.004;
  const first = at(firstTime), firstFrame = first.frame, before = column(first.history);
  const second = at(secondTime), after = column(second.history);
  assert.equal(second.frame, firstFrame, 'Both reads deliberately share one cached analysis frame');
  assert.ok(maxDifference(before, after) > 0.001, 'Continuous travel must not be quantized to the analysis frame');
  assert.ok(centroid(after) > centroid(before));
});

test('Loom history hands peaks across row boundaries continuously without losing spectral energy', () => {
  const at = isolatedPeak();
  for (let boundaryRow = 1; boundaryRow < GRID_ROWS; boundaryRow++) {
    const boundary = sourceTime + boundaryRow * rowSeconds;
    const before = column(at(boundary - 0.000001).history);
    const after = column(at(boundary + 0.000001).history);
    assert.ok(maxDifference(before, after) < 0.0002, `Boundary ${boundaryRow} must not jump between LEDs`);
    const middle = column(at(boundary).history);
    assert.ok(middle[boundaryRow - 1] > peak * 0.65 && middle[boundaryRow] > peak * 0.65);
    const power = middle.reduce((sum, value) => sum + value * value, 0);
    assert.ok(Math.abs(power - peak * peak) < 1e-6, `Boundary ${boundaryRow} must preserve the isolated peak's squared amplitude`);
    assert.equal(middle.filter(value => value > 1e-7).length, 2, 'A handover should involve only neighboring LEDs');
  }
});

test('Loom history travels monotonically through six seconds without one-row steps', () => {
  const at = isolatedPeak();
  const displayFps = 240;
  let previous = 0;
  for (let sample = 0; sample < HISTORY_SECONDS * displayFps; sample++) {
    const values = column(at(sourceTime + sample / displayFps).history);
    const next = centroid(values);
    assert.notEqual(next, null, 'The isolated peak should remain present until its bounded history expires');
    assert.ok(next >= previous - 1e-6, 'A historical gesture must never move back down');
    assert.ok(next - previous < 0.15, 'A short display interval must not move a peak a whole physical row');
    previous = next;
  }
  assert.ok(Math.abs(previous - (GRID_ROWS - 1)) < 1e-6);
});

test('Loom temporal smoothing never leaks into adjacent frequency columns', () => {
  const timeline = makeTimeline();
  const activeColumns = [0, 47, BAND_COUNT - 1];
  for (const index of activeColumns) timeline.bands[sourceFrame * BAND_COUNT + index] = encodedPeak;
  const at = createLEDFrameReader(timeline);
  for (const ageRows of [0, 0.9, 1, 1.1, 20.98, 21.02, 53.9]) {
    const { history } = at(sourceTime + ageRows * rowSeconds);
    for (let index = 0; index < history.length; index++) {
      if (!activeColumns.includes(index % BAND_COUNT)) assert.equal(history[index], 0);
    }
    for (const index of activeColumns) assert.ok(column(history, index).some(value => value > 0));
  }
});

test('Loom history fades out continuously inside the six-second retention limit', () => {
  const at = isolatedPeak();
  const fadeStart = sourceTime + (GRID_ROWS - 0.5) * rowSeconds;
  const expiry = sourceTime + HISTORY_SECONDS;
  const beforeFade = Math.max(...column(at(fadeStart).history));
  const midFade = Math.max(...column(at((fadeStart + expiry) / 2).history));
  const nearExpiry = Math.max(...column(at(expiry - 0.000001).history));
  assert.ok(Math.abs(beforeFade - peak) < 1e-7);
  assert.ok(midFade > 0 && midFade < beforeFade);
  assert.ok(nearExpiry < 0.0001, 'The oldest row must reach darkness without an abrupt final removal');
  assert.ok(at(expiry).history.every(value => value === 0));
  assert.ok(at(expiry + 0.01).history.every(value => value === 0));
});

test('Loom fractional history is independent of seeking, replay order and prior reads', () => {
  const timeline = makeTimeline();
  for (let frame = 1; frame < timeline.frames; frame += 7) {
    timeline.bands[frame * BAND_COUNT + frame % BAND_COUNT] = 20000 + (frame * 197) % 45000;
  }
  const at = createLEDFrameReader(timeline);
  const times = [0, 0.1173, 1.1131, 2.7174, 6.993, 7.991];
  const expected = new Map(times.map(time => [time, at(time).history.slice()]));
  for (const time of [8, 0, 4.731, 0.001, 7, 1.009, ...times.toReversed(), ...times]) {
    const actual = at(time).history;
    if (expected.has(time)) assert.deepEqual(actual, expected.get(time));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { timbreTrail, activityStrip } from '../js/pulse/pulse-chart-math.js';

test('activity bins include the current attack and agree with visible-window statistics', () => {
  const rows = [0, 1, 2, 3, 6].map(time => ({ time, onset: .5 }));
  const data = activityStrip(rows, 6, 5);
  assert.deepEqual(data.rates, [1, 1, 1, 0, 1]);
  assert.equal(data.count, 4);
  assert.equal(data.mean, .8);
  assert.equal(data.recent, .5);
  assert.equal(activityStrip([], 0, 15).recent, 0);
});

test('timbre uses causal neighbours and is independent of history outside the window and padding', () => {
  const rows = Array.from({ length: 601 }, (_, frame) => ({ frame, time: frame / 60,
    brightness: 800 + 200 * Math.sin(frame / 17), rmsDb: -20 + Math.cos(frame / 23) * 4 }));
  const visible = rows.filter(row => row.time >= 5);
  const full = timbreTrail(new Map(rows.map(row => [row.frame, row])), visible, 10, 5);
  const rebuilt = timbreTrail(new Map(rows.filter(row => row.frame >= 296).map(row => [row.frame, row])), visible, 10, 5);
  assert.deepEqual(full, rebuilt);
  assert.ok(full.head);
  assert.ok(full.points.every(point => Number.isFinite(point.x) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
  assert.equal(full.head.age, 1);
  assert.ok(full.brightness > 0);
});

test('silence has no fabricated timbre dot or activity', () => {
  const row = { frame: 60, time: 1, brightness: 0, rmsDb: -96, onset: 0 };
  const data = timbreTrail(new Map([[60, row]]), [row], 1, 15);
  assert.equal(data.head, null);
  assert.deepEqual(data.points, []);
  assert.equal(data.rmsDb, -96);
  assert.equal(activityStrip([row], 1, 15).count, 0);
});

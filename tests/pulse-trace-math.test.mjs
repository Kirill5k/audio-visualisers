import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardiogramPath, pulseHistorySeconds } from '../js/pulse/pulse-trace-math.js';

const plot = { x: 100, y: 100, w: 600, h: 300 };
const rows = (start, end, sample) => new Map(Array.from({ length: end - start + 1 }, (_, index) => {
  const frame = start + index;
  return [frame, { frame, time: frame / 60, ...sample(frame) }];
}));

test('Cardiogram gain, transient, height and baseline match the original mapping', () => {
  const history = rows(0, 900, () => ({ fast: [.8, .8, .8], slow: [.4, .4, .4] }));
  const settings = { gain: 1.15, transient: .85, height: 1.9, baseline: -.2, head: .98, waveSmoothness: 0 };
  const path = createCardiogramPath(history, 15, 0, settings, plot, { latestFrame: 900, columns: 61 });
  const shaped = Math.tanh(1.15 * (.8 - .85 * .4) * 1.9);
  const expected = 150 - (-.2 + shaped * 1.2) * 42;
  assert.ok(Math.abs(path.head[1] - expected) < 1e-10);
  assert.equal(path.head[0], plot.x + plot.w * .98);
  assert.deepEqual(path.head, path.points.at(-1));
  assert.equal(path.baseline, 150 + .2 * 42);
});

test('live tip moves with the newest envelope and never leaves its lane', () => {
  const history = rows(0, 901, frame => ({ fast: [frame === 901 ? .9 : .1, 100, 0], slow: [.05, 0, 100] }));
  const a = createCardiogramPath(history, 15, 0, {}, plot, { latestFrame: 900 });
  const b = createCardiogramPath(history, 901 / 60, 0, {}, plot, { latestFrame: 901 });
  assert.notEqual(a.head[1], b.head[1]);
  for (let band = 0; band < 3; band++) {
    const path = createCardiogramPath(history, 901 / 60, band, { gain: 4, height: 6, baseline: -.9 }, plot, { latestFrame: 901 });
    const centre = plot.y + (band + .5) * 100;
    for (const [, y] of path.points) assert.ok(y >= centre - 42 - 1e-8 && y <= centre + 42 + 1e-8);
  }
});

test('triangle smoothness rounds a narrow transient while retaining the head on the path', () => {
  const history = rows(0, 300, frame => ({ fast: [frame === 150 ? 1 : 0, 0, 0], slow: [0, 0, 0] }));
  const options = { latestFrame: 300, columns: 301 };
  const sharp = createCardiogramPath(history, 5, 0, { historySeconds: 5, waveSmoothness: 0 }, plot, options);
  const smooth = createCardiogramPath(history, 5, 0, { historySeconds: 5, waveSmoothness: 1 }, plot, options);
  assert.ok(Math.min(...smooth.points.map(point => point[1])) > Math.min(...sharp.points.map(point => point[1])));
  assert.deepEqual(smooth.head, smooth.points.at(-1));
});

test('seek reconstruction matches uninterrupted absolute-time geometry', () => {
  const sample = frame => ({ fast: [Math.sin(frame * .3) * .2 + .4, .2, .1], slow: [.3, .15, .08] });
  const uninterrupted = rows(0, 5400, sample);
  const reconstructed = rows(1800, 5400, sample);
  for (const historySeconds of [5, 15, 60]) {
    const settings = { historySeconds, waveSmoothness: .7 };
    const options = { latestFrame: 5400 };
    assert.deepEqual(createCardiogramPath(uninterrupted, 90, 0, settings, plot, options), createCardiogramPath(reconstructed, 90, 0, settings, plot, options));
  }
});

test('both charts share the bounded default fifteen-second display window', () => {
  assert.equal(pulseHistorySeconds(), 15);
  assert.equal(pulseHistorySeconds({ historySeconds: 2 }), 5);
  assert.equal(pulseHistorySeconds({ historySeconds: 100 }), 60);
  assert.equal(pulseHistorySeconds({ historySeconds: 35 }), 35);
});

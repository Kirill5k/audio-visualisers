import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingDestination } from '../js/led-grid/led-recording.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('recording writes finish in order before the destination closes', async () => {
  const events = [];
  const sink = createRecordingDestination({
    async write(chunk) { await new Promise(resolve => setTimeout(resolve, chunk === 1 ? 10 : 0)); events.push(chunk); },
    async close() { events.push('closed'); }, async abort() { events.push('aborted'); },
  });
  sink.write(1); sink.write(2); await sink.close();
  assert.deepEqual(events, [1, 2, 'closed']);
  assert.equal(sink.error, null);
});

test('a failed write aborts once and lets recorder cleanup complete', async () => {
  const events = [], failure = new Error('disk full');
  const sink = createRecordingDestination({
    async write() { events.push('write'); throw failure; },
    async close() { events.push('closed'); }, async abort() { events.push('aborted'); },
  });
  sink.write(1); sink.write(2); await sink.close(); await sink.abort();
  assert.deepEqual(events, ['write', 'aborted']);
  assert.equal(sink.error, failure);
});

test('a rejected file close is retained without trapping the recorder stop callback', async () => {
  const failure = new Error('destination disconnected'); let aborted = false;
  const sink = createRecordingDestination({ async write() {}, async close() { throw failure; }, async abort() { aborted = true; } });
  await sink.write(1); await sink.close();
  assert.equal(sink.error, failure); assert.ok(aborted);
});

test('recorder buffering pauses and resumes the encoder without invalid state transitions', async () => {
  const transitions = [];
  class Encoder {
    static isTypeSupported() { return true; }
    state = 'inactive';
    start() { this.state = 'recording'; }
    pause() { assert.equal(this.state, 'recording'); this.state = 'paused'; transitions.push('pause'); }
    resume() { assert.equal(this.state, 'paused'); this.state = 'recording'; transitions.push('resume'); }
    stop() { this.state = 'inactive'; transitions.push('stop'); }
  }
  const context = vm.createContext({ MediaRecorder: Encoder });
  vm.runInContext(await readFile(new URL('../js/recorder.js', import.meta.url), 'utf8'), context);
  const recorder = context.createRecorder({});
  recorder.pause(); recorder.resume();
  recorder.begin({}, { write() {}, close() {} });
  recorder.pause(); recorder.pause(); assert.equal(recorder.isRecording, true);
  recorder.resume(); recorder.resume(); recorder.stop(); recorder.resume();
  assert.deepEqual(transitions, ['pause', 'resume', 'stop']);
  assert.equal(recorder.isRecording, false);
});

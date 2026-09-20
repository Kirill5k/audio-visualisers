import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createSpectralPlayer } from '../js/terrain/spectral-player.js';

// Exercise the production player, audio transport, analysis worker and capture
// session together. Only browser device/DOM APIs and the video encoder are faked.
class BrowserWorker {
  constructor(url) {
    const source = `import { parentPort } from 'node:worker_threads';
      globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
      await import(${JSON.stringify(url.href)});
      parentPort.on('message', data => self.onmessage({ data }));`;
    this.worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
    this.worker.on('message', data => this.onmessage?.({ data }));
    this.worker.on('error', error => this.onerror?.({ message: error.message }));
  }
  postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
  terminate() { this.worker.terminate(); }
}

function audioBuffer(seconds, sampleRate = 8000) {
  const channels = [new Float32Array(Math.round(seconds * sampleRate))];
  channels[0][channels[0].length - 1] = .7;
  return {
    numberOfChannels: 1, length: channels[0].length, sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: channel => channels[channel],
    copyToChannel: (source, channel) => channels[channel].set(source),
  };
}

function environment(input) {
  const listeners = new Map();
  class Element {
    constructor() {
      this.style = {}; this.dataset = {}; this.value = ''; this.attributes = {};
      const classes = new Set();
      this.classList = {
        contains: key => classes.has(key), add: key => classes.add(key), remove: key => classes.delete(key),
        toggle(key, on = !classes.has(key)) { if (on) classes.add(key); else classes.delete(key); },
      };
      this.events = new Map();
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    querySelector() { return null; }
    getBoundingClientRect() { return { width: 1000, height: 800 }; }
    click() { this.events.get('click')?.({ target: this }); }
  }
  const ids = ['stage', 'fatal', 'statusText', 'statusLight', 'panel', 'panelToggle', 'cleanBtn',
    'playPauseBtn', 'recordBtn', 'exportBtn', 'exportOverlay', 'exportStatus', 'exportProgressBar',
    'exportPercent', 'exportCancelBtn', 'seek', 'seekSeconds', 'currentTime', 'durationText'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  globalThis.document = {
    fonts: { load: async () => [{ status: 'loaded' }] }, body: new Element(),
    getElementById: id => elements.get(id) || null, querySelector: () => null,
    querySelectorAll: () => [], addEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.HTMLElement = Element;
  globalThis.devicePixelRatio = 1;
  globalThis.addEventListener = (name, callback) => listeners.set(name, callback);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.Worker = BrowserWorker;
  let audioContext;
  let decodeFailure = false, startFailure = false, stopFailure = null;
  let stoppedTracks = 0, abortedRecording = false;
  const node = () => ({ connect() {}, disconnect() {}, stop() {}, start() {} });
  globalThis.AudioContext = class {
    constructor(options) { assert.equal(options.sampleRate, 48000); this.state = 'suspended'; this.currentTime = 0; this.destination = {}; audioContext = this; }
    createAnalyser() { return node(); }
    createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {} } }; }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{}] } }; }
    createBufferSource() { return node(); }
    createBuffer(channels, length, rate) { assert.equal(channels, 1); return audioBuffer(length / rate, rate); }
    async decodeAudioData() { if (decodeFailure) throw new Error('Decode failed'); return input; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  };
  globalThis.VideoEncoder = class {};
  globalThis.AudioEncoder = class {};
  globalThis.MediaRecorder = class {};
  globalThis.createRecorder = callbacks => {
    let recording = false, writable;
    return {
      get isRecording() { return recording; },
      getCodec: () => ({ mime: 'video/webm' }),
      prepareAutoRecord: async () => ({ writable: { abort() { abortedRecording = true; } } }),
      startAutoRecord(prepared, streamFactory) {
        const stream = streamFactory();
        if (startFailure) throw new Error('Recorder start failed');
        this.begin(stream, prepared.writable);
      },
      begin(_stream, destination) { writable = destination; recording = true; callbacks.onStart(); },
      async stop() {
        recording = false;
        await writable?.write(new Uint8Array([1, 2, 3]));
        await writable?.close();
        callbacks.onStop(stopFailure);
      },
    };
  };
  let rows = [], sampleRate = 0, frame = null, camera = { preset: 'side', position: [4, 5, 6] };
  const events = [];
  const canvas = {
    width: 1, height: 1,
    getContext: () => ({ finish() {} }),
    captureStream: () => ({ getVideoTracks: () => [{ stop() { stoppedTracks++; } }], addTrack() {} }),
  };
  const scene = {
    canvas,
    resize(width, height, ratio) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); },
    setSampleRate(value) { sampleRate = value; events.push('sampleRate'); },
    setHistoryFrames(batch) { assert.ok(sampleRate > 0); rows.push(...batch); events.push('rows'); },
    resetHistory() { rows = []; },
    render(data) { frame = data; },
    getCameraState: () => structuredClone(camera),
    setCameraState(value) { camera = structuredClone(value); },
    setInteractionEnabled(enabled) { scene.interactionEnabled = enabled; },
    getInfo: () => ({ rows: rows.map(row => row.frame), sampleRate, time: frame?.time, hasSpectrum: !!frame?.spectralFrame }),
    dispose() {},
  };
  const file = { name: 'fixture.wav', arrayBuffer: async () => new ArrayBuffer(0) };
  return { scene, file, elements, events,
    advanceAudio: seconds => { audioContext.currentTime += seconds; },
    failDecode: () => { decodeFailure = true; },
    failRecordingStart: () => { startFailure = true; },
    failRecordingStop: () => { stopFailure = new Error('Encoder stopped unexpectedly'); },
    captureCleanup: () => ({ stoppedTracks, abortedRecording }),
    cleanup: () => listeners.get('pagehide')?.(),
  };
}

async function create(env, extra = {}) {
  return createSpectralPlayer({
    name: 'Test Terrain', slug: 'test-terrain', settings: { gain: 1.3, annotations: [{ title: 'Track' }] },
    createScene: () => env.scene, historySeconds: 12, historyPaddingFrames: 2,
    previewAspect: 16 / 9, previewMinWidth: 3840, previewMinHeight: 2160, ...extra,
  });
}

test('shared lifecycle retains 12 seconds plus interpolation, final partial frames, and isolated settings', async () => {
  const env = environment(audioBuffer(12.505));
  try {
    const player = await create(env);
    assert.equal(await player.loadFile(env.file), true);
    assert.ok(env.events.indexOf('sampleRate') < env.events.indexOf('rows'));
    const state = await player.renderAt(12.505);
    assert.equal(state.uploadedFrame, 751, 'partial final interval remains visible');
    assert.equal(state.scene.rows.length, 722);
    assert.equal(state.scene.rows.at(-1), 751);
    assert.equal(state.scene.rows[0], 30);
    assert.equal(state.position, 12.505);
    assert.equal(state.finished, true);
    assert.deepEqual([state.viewport.canvasWidth, state.viewport.canvasHeight], [3840, 2160]);
    state.settings.annotations[0].title = 'Mutation outside player';
    assert.equal(player.getState().settings.annotations[0].title, 'Track');
    player.flushAnalysisCache();
    const reconstructed = await player.renderAt(12.505);
    assert.deepEqual(reconstructed.scene, state.scene);
    player.unload();
    assert.equal(player.getState().ready, false);
    assert.equal(player.getState().scene.hasSpectrum, false);
    assert.deepEqual(player.getState().scene.rows, []);
  } finally { env.cleanup(); }
});

test('pause reconstructs audio frames advanced since the last RAF before resolving', async () => {
  const env = environment(audioBuffer(2.005));
  try {
    const player = await create(env);
    await player.loadFile(env.file);
    await player.renderAt(1.2);
    await player.play();
    env.advanceAudio(.055);
    assert.equal(player.getState().uploadedFrame, 72, 'no RAF has uploaded the advancing audio');

    const pausing = player.pause();
    assert.equal(player.getState().busy, 'pausing');
    assert.equal(env.scene.interactionEnabled, false);
    assert.equal(await player.seek(0), false, 'transport remains locked until the final image is ready');
    assert.equal(await pausing, true);
    const paused = player.getState();
    assert.equal(paused.playing, false);
    assert.equal(paused.paused, true);
    assert.equal(paused.busy, '');
    assert.equal(paused.position, 1.255);
    assert.equal(paused.uploadedFrame, 75);
    assert.equal(paused.scene.rows.at(-1), 75);
    assert.equal(paused.scene.time, paused.position, 'the paused image is rendered before pause resolves');
    assert.equal(env.scene.interactionEnabled, true);
    const reconstructed = await player.renderAt(paused.position);
    assert.deepEqual(reconstructed.scene, paused.scene, 'direct seeking produces the same complete paused history');

    await player.play();
    env.advanceAudio(.01);
    await player.pause();
    assert.ok(Math.abs(player.getState().position - 1.265) < 1e-12, 'resume preserves the fractional position');
    assert.equal(player.getState().uploadedFrame, 75);

    await player.renderAt(2.005);
    await player.pause();
    assert.equal(player.getState().position, 2.005);
    assert.equal(player.getState().uploadedFrame, 121, 'pause retains the partial final interval');
    assert.equal(player.getState().finished, true);
  } finally { env.cleanup(); }
});

test('shared export restores selected camera, viewport, playback and position on success or encoder failure', async () => {
  const env = environment(audioBuffer(.72));
  try {
    const player = await create(env);
    await player.loadFile(env.file);
    await player.renderAt(.3);
    await player.play();
    const before = player.getState();
    const camera = env.scene.getCameraState();
    let aborted = false;
    const writable = { write() {}, close() {}, abort() { aborted = true; } };
    globalThis.offlineExport = async options => {
      assert.equal(env.scene.interactionEnabled, false);
      assert.deepEqual([env.scene.canvas.width, env.scene.canvas.height], [3840, 2160]);
      const data = await options.analysisProvider(1);
      await options.renderFrame(null, 1 / 60, data);
      env.scene.setCameraState({ preset: null, position: [9, 9, 9] });
    };
    assert.equal((await player.exportClip({ start: .1, duration: .1, writable })).ok, true);
    assert.deepEqual(env.scene.getCameraState(), camera);
    assert.deepEqual(player.getState().viewport, before.viewport);
    assert.equal(player.getState().position, before.position);
    assert.equal(player.getState().playing, true);
    globalThis.offlineExport = async () => { throw new Error('Encoder failed'); };
    const priorError = console.error;
    console.error = () => {};
    try { await assert.rejects(player.exportClip({ start: .1, duration: .1, writable }), /Encoder failed/); }
    finally { console.error = priorError; }
    assert.equal(aborted, true);
    assert.equal(player.getState().busy, '');
    assert.equal(player.getState().exporting, false);
    assert.equal(player.getState().playing, true);
    assert.equal(player.getState().position, before.position);
    assert.deepEqual(env.scene.getCameraState(), camera);
    assert.equal(env.scene.interactionEnabled, true);
    globalThis.offlineExport = async options => {
      env.elements.get('exportCancelBtn').click();
      assert.equal(options.isCancelled(), true);
    };
    assert.deepEqual(await player.exportClip({ start: .1, duration: .1, writable }), { ok: false, reason: 'cancelled' });
    assert.deepEqual(env.scene.getCameraState(), camera);
    assert.deepEqual(player.getState().viewport, before.viewport);
    assert.equal(player.getState().position, before.position);
    assert.equal(player.getState().playing, true);
    assert.equal(player.getState().exporting, false);
    assert.equal(player.getState().busy, '');
  } finally { env.cleanup(); }
});

test('shared recording uses native 1080p, retains camera, and restores paused position', async () => {
  const env = environment(audioBuffer(.72));
  try {
    const player = await create(env);
    await player.loadFile(env.file);
    await player.renderAt(.3);
    const before = player.getState();
    const camera = env.scene.getCameraState();
    let closed = false;
    const recording = player.recordClip({ duration: .001, writable: {
      write() {
        assert.deepEqual([env.scene.canvas.width, env.scene.canvas.height], [1920, 1080]);
        assert.deepEqual(env.scene.getCameraState(), camera);
      },
      close() { closed = true; },
    } });
    assert.equal((await recording).ok, true);
    assert.equal(closed, true);
    assert.deepEqual(player.getState().viewport, before.viewport);
    assert.equal(player.getState().position, before.position);
    assert.equal(player.getState().playing, false);
    assert.equal(player.getState().recording, false);
    assert.equal(env.scene.interactionEnabled, true);
  } finally { env.cleanup(); }
});

test('failed replacement clears track state and invokes reset metadata hook', async () => {
  const env = environment(audioBuffer(.05));
  const calls = [];
  try {
    const player = await create(env, { extend: () => ({
      onTrackLoaded: ({ replacingTrack }) => calls.push(['loaded', replacingTrack]),
      onReset: ({ clear }) => calls.push(['reset', clear]),
    }) });
    await player.loadFile(env.file);
    env.failDecode();
    await assert.rejects(player.loadFile(env.file), /Decode failed/);
    const state = player.getState();
    assert.equal(state.ready, false);
    assert.equal(state.busy, '');
    assert.equal(state.fileName, '');
    assert.equal(state.position, 0);
    assert.deepEqual(state.scene.rows, []);
    assert.deepEqual(calls, [['loaded', false], ['reset', true]]);
  } finally { env.cleanup(); }
});


test('recording start failure releases capture stream, aborts destination and restores 4K viewport', async () => {
  const env = environment(audioBuffer(.72));
  const priorError = console.error;
  try {
    const player = await create(env);
    await player.loadFile(env.file);
    await player.renderAt(.3);
    const before = player.getState();
    const camera = env.scene.getCameraState();
    env.failRecordingStart();
    console.error = () => {};
    env.elements.get('recordBtn').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(env.captureCleanup(), { stoppedTracks: 1, abortedRecording: true });
    assert.deepEqual(player.getState().viewport, before.viewport);
    assert.deepEqual(env.scene.getCameraState(), camera);
    assert.equal(player.getState().busy, '');
    assert.equal(player.getState().recording, false);
    assert.equal(player.getState().error, 'Recorder start failed');
    assert.equal(env.scene.interactionEnabled, true);
  } finally { console.error = priorError; env.cleanup(); }
});

test('review recording rejects encoder stop errors after restoring scene and paused position', async () => {
  const env = environment(audioBuffer(.72));
  try {
    const player = await create(env);
    await player.loadFile(env.file);
    await player.renderAt(.3);
    const before = player.getState();
    const camera = env.scene.getCameraState();
    env.failRecordingStop();
    await assert.rejects(player.recordClip({ duration: .001, writable: { write() {}, close() {} } }),
      /Encoder stopped unexpectedly/);
    assert.equal(env.captureCleanup().stoppedTracks, 1, 'repeated cleanup does not stop a released stream again');
    assert.deepEqual(player.getState().viewport, before.viewport);
    assert.deepEqual(env.scene.getCameraState(), camera);
    assert.equal(player.getState().position, before.position);
    assert.equal(player.getState().playing, false);
    assert.equal(player.getState().recording, false);
    assert.equal(player.getState().busy, '');
    assert.equal(env.scene.interactionEnabled, true);
    assert.match(env.elements.get('statusText').textContent, /Recording failed/);
  } finally { env.cleanup(); }
});

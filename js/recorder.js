"use strict";

function createRecorder(opts) {
  const state = {
    mediaRecorder: null,
    isRecording: false,
    fileWritable: null,
    recordedChunks: [],
    codec: null,
    failure: null,
    pendingWrites: Promise.resolve(),
  };

  const codecCandidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', bps: 20_000_000 },
    { mime: 'video/webm;codecs=h264,opus',             ext: 'webm', bps: 20_000_000 },
    { mime: 'video/webm;codecs=vp9,opus',              ext: 'webm', bps: 60_000_000 },
    { mime: 'video/webm;codecs=vp8,opus',              ext: 'webm', bps: 40_000_000 },
    { mime: 'video/webm',                              ext: 'webm', bps: 40_000_000 },
  ];

  function getCodec() {
    return codecCandidates.find(c => MediaRecorder.isTypeSupported(c.mime))
      ?? codecCandidates.at(-1);
  }

  async function pickSaveFile(suggestedName, ext) {
    if (!window.showSaveFilePicker) return null;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{ description: 'Video', accept: { ['video/' + ext]: ['.' + ext] } }]
      });
      return await handle.createWritable();
    } catch (e) {
      if (e.name !== 'AbortError' && opts.onStatus) opts.onStatus('Error: ' + e.message);
      return null;
    }
  }

  function begin(stream, writable, codec) {
    state.codec = codec || getCodec();
    state.fileWritable = writable;
    state.recordedChunks = [];
    state.failure = null;
    state.pendingWrites = Promise.resolve();

    const bps = opts.videoBitsPerSecond || state.codec.bps;
    state.mediaRecorder = new MediaRecorder(stream, {
      mimeType: state.codec.mime,
      videoBitsPerSecond: bps,
    });

    function failed(error) {
      if (state.failure) return;
      state.failure = error || new Error('The video encoder stopped unexpectedly.');
      if (opts.onError) opts.onError(state.failure);
      else if (opts.onStatus) opts.onStatus('Recording failed · ' + state.failure.message);
    }

    state.mediaRecorder.onerror = event => {
      state.isRecording = false;
      failed(event.error);
      // Browsers normally emit dataavailable and stop after an encoder error.
      // Explicitly stop only if the implementation still reports an active recorder.
      if (state.mediaRecorder.state !== 'inactive') state.mediaRecorder.stop();
    };
    state.mediaRecorder.ondataavailable = e => {
      if (e.data.size <= 0 || state.failure) return;
      if (state.fileWritable) {
        state.pendingWrites = state.pendingWrites.then(async () => {
          if (!state.failure) await state.fileWritable.write(e.data);
        }).catch(error => {
          failed(error);
          stop();
        });
      } else {
        state.recordedChunks.push(e.data);
      }
    };

    state.mediaRecorder.onstop = async () => {
      // A device or encoder can stop without our public stop() being called.
      state.isRecording = false;
      try {
        await state.pendingWrites;
        if (state.fileWritable) {
          if (!state.failure) {
            await state.fileWritable.close();
            // Serialized destinations retain errors so cleanup can always finish.
            if (state.fileWritable.error) failed(state.fileWritable.error);
          }
          if (state.failure) await state.fileWritable.abort?.();
          else if (opts.onStatus) opts.onStatus('Recording saved to disk!');
        } else if (!state.failure) {
          const blob = new Blob(state.recordedChunks, { type: state.codec.mime });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const name = opts.defaultFilename || 'recording';
          a.download = `${name}.${state.codec.ext}`;
          a.click();
          URL.revokeObjectURL(url);
          if (opts.onStatus) opts.onStatus('Recording saved!');
        }
      } catch (error) {
        failed(error);
        try { await state.fileWritable?.abort?.(); } catch (_) {}
      } finally {
        state.fileWritable = null;
        state.recordedChunks = [];
        if (opts.onStop) opts.onStop(state.failure);
      }
    };

    state.mediaRecorder.start(200);
    state.isRecording = true;
    if (opts.onStart) opts.onStart(state.codec);
  }

  function stop() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
    state.isRecording = false;
  }

  async function toggle(streamFactory) {
    if (state.isRecording) { stop(); return; }
    const codec = getCodec();
    const writable = await pickSaveFile(
      (opts.defaultFilename || 'recording') + '.' + codec.ext,
      codec.ext
    );
    if (!writable && window.showSaveFilePicker) return;
    const stream = streamFactory();
    if (!stream) return;
    begin(stream, writable, codec);
  }

  async function prepareAutoRecord() {
    const codec = getCodec();
    const writable = await pickSaveFile(
      (opts.defaultFilename || 'recording') + '.' + codec.ext,
      codec.ext
    );
    if (!writable && window.showSaveFilePicker) return null;
    return { codec, writable };
  }

  function startAutoRecord(prepared, streamFactory) {
    if (!prepared || state.isRecording) return;
    const stream = streamFactory();
    if (!stream) return;
    begin(stream, prepared.writable, prepared.codec);
  }

  return {
    get isRecording() { return state.isRecording; },
    getCodec,
    begin,
    stop,
    pause() {
      if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.pause();
    },
    resume() {
      if (state.mediaRecorder?.state === 'paused') state.mediaRecorder.resume();
    },
    toggle,
    prepareAutoRecord,
    startAutoRecord,
  };
}

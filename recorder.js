"use strict";

function createRecorder(opts) {
  const state = {
    mediaRecorder: null,
    isRecording: false,
    fileWritable: null,
    recordedChunks: [],
    codec: null,
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

    const bps = opts.videoBitsPerSecond || state.codec.bps;
    state.mediaRecorder = new MediaRecorder(stream, {
      mimeType: state.codec.mime,
      videoBitsPerSecond: bps,
    });

    state.mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        if (state.fileWritable) {
          await state.fileWritable.write(e.data);
        } else {
          state.recordedChunks.push(e.data);
        }
      }
    };

    state.mediaRecorder.onstop = async () => {
      if (state.fileWritable) {
        await state.fileWritable.close();
        state.fileWritable = null;
        if (opts.onStatus) opts.onStatus('Recording saved to disk!');
      } else {
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
      state.recordedChunks = [];
      if (opts.onStop) opts.onStop();
    };

    state.mediaRecorder.start(1000);
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
    toggle,
    prepareAutoRecord,
    startAutoRecord,
  };
}

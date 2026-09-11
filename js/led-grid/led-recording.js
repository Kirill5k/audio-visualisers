// MediaRecorder delivers chunks without waiting for previous writes. Keep disk
// operations ordered and always settle close so its stop callback can clean up.
export function createRecordingDestination(writable) {
  let pending = Promise.resolve(), failure = null, aborted = false, closed = false;
  async function abortOnce() {
    if (aborted || closed) return;
    aborted = true;
    try { await writable.abort?.(); } catch (error) { failure ||= error; }
  }
  function enqueue(operation) {
    pending = pending.then(operation).catch(async error => { failure ||= error; await abortOnce(); });
    return pending;
  }
  return {
    get error() { return failure; },
    write(chunk) { return enqueue(async () => { if (!failure && !aborted && !closed) await writable.write(chunk); }); },
    close() { return enqueue(async () => {
      if (failure || aborted || closed) return;
      await writable.close(); closed = true;
    }); },
    abort() { return enqueue(abortOnce); },
  };
}

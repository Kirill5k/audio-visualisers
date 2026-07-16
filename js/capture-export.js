/**
 * Shared canvas capture + offline export session for the visualisers.
 * Owns 1080p viewport swap, MediaRecorder stream, export overlay, and offlineExport orchestration.
 * Page-specific viewport/scene logic is supplied via callbacks.
 */
export function createCaptureSession({
  width = 1920,
  height = 1080,
  fps = 60,
  getCanvas,
  getAudioTrack,
  saveViewport,
  applyViewport,
  restoreViewport,
  overlay = {},
} = {}) {
  let preCapture = null;
  let videoTrack = null;
  let lastCaptureMs = 0;
  let exporting = false;
  let exportCancelled = false;

  const overlayRoot = overlay.root || null;
  const overlayStatus = overlay.status || null;
  const overlayProgress = overlay.progress || null;
  const overlayPercent = overlay.percent || null;
  const cancelBtn = overlay.cancelBtn || null;

  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      exportCancelled = true;
      if (overlayStatus) overlayStatus.textContent = "Cancelling…";
    });
  }

  function showOverlay(message) {
    if (overlayStatus && message) overlayStatus.textContent = message;
    if (overlayProgress) overlayProgress.style.width = "0%";
    if (overlayPercent) overlayPercent.textContent = "0%";
    if (overlayRoot) overlayRoot.style.display = "flex";
  }

  function hideOverlay(delayMs = 0) {
    if (!overlayRoot) return;
    if (delayMs > 0) {
      setTimeout(() => { overlayRoot.style.display = "none"; }, delayMs);
    } else {
      overlayRoot.style.display = "none";
    }
  }

  function setProgress(fraction, statusMessage) {
    const percent = Math.round(fraction * 100);
    if (overlayProgress) overlayProgress.style.width = percent + "%";
    if (overlayPercent) overlayPercent.textContent = percent + "%";
    if (overlayStatus && statusMessage) overlayStatus.textContent = statusMessage;
  }

  function beginViewportCapture() {
    if (!preCapture && saveViewport) preCapture = saveViewport();
    if (applyViewport) applyViewport(width, height);
  }

  function endViewportCapture() {
    if (!preCapture) return;
    if (restoreViewport) restoreViewport(preCapture);
    preCapture = null;
  }

  async function pickWritable(suggestedName, onError) {
    if (!window.showSaveFilePicker) return null;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "MP4 Video", accept: { "video/mp4": [".mp4"] } }],
      });
      return await handle.createWritable();
    } catch (error) {
      if (error.name !== "AbortError" && onError) onError(error);
      return null;
    }
  }

  return {
    get width() { return width; },
    get height() { return height; },
    get fps() { return fps; },
    get isExporting() { return exporting; },
    get videoTrack() { return videoTrack; },
    get lastCaptureMs() { return lastCaptureMs; },

    beginViewportCapture,
    endViewportCapture,

    makeRecordingStream() {
      const canvas = getCanvas?.();
      if (!canvas) return null;

      beginViewportCapture();
      const stream = canvas.captureStream(0);
      videoTrack = stream.getVideoTracks()[0] || null;
      lastCaptureMs = 0;

      const audioTrack = getAudioTrack?.();
      if (audioTrack) stream.addTrack(audioTrack);
      return stream;
    },

    onRecordingStopped() {
      videoTrack = null;
      endViewportCapture();
    },

    shouldSkipRecordingFrame(now, lock60) {
      return Boolean(lock60 && now - lastCaptureMs < 16.5);
    },

    requestRecordingFrame(now = performance.now()) {
      if (!videoTrack) return;
      videoTrack.requestFrame();
      lastCaptureMs = now;
    },

    pickWritable,

    async runOfflineExport({
      audio,
      suggestedName,
      pendingWritable = null,
      onStatus,
      labels = {},
      prepare,
      restore,
      renderFrame,
      readCanvas,
      gpuFinish,
    }) {
      if (exporting) return { ok: false, reason: "busy" };
      if (!audio?.hasAudio) return { ok: false, reason: "no-audio" };

      const exportAudio = audio.getExportAudio();
      if (!exportAudio) return { ok: false, reason: "no-audio" };

      const writable = pendingWritable || await pickWritable(
        suggestedName,
        (error) => onStatus?.("Export error · " + error.message),
      );
      if (!writable) return { ok: false, reason: "cancelled" };

      const offlineExport = globalThis.offlineExport;
      if (typeof offlineExport !== "function") {
        onStatus?.("Export unavailable");
        return { ok: false, reason: "missing-exporter" };
      }

      exporting = true;
      exportCancelled = false;
      showOverlay(labels.rendering || "Exporting…");

      let sceneSaved = null;
      let viewportSaved = null;

      try {
        await audio.suspendContext();
        viewportSaved = saveViewport ? saveViewport() : null;
        if (applyViewport) applyViewport(width, height);
        sceneSaved = prepare ? await prepare() : null;

        await offlineExport({
          ...exportAudio,
          fps,
          width,
          height,
          writable,
          isCancelled: () => exportCancelled,
          renderFrame,
          readCanvas,
          gpuFinish,
          onProgress: (fraction) => {
            const totalFrames = Math.ceil(audio.duration * fps);
            const frame = Math.round(fraction * totalFrames);
            const message = (labels.progress || "Rendering frame {frame} of {total}")
              .replace("{frame}", String(frame))
              .replace("{total}", String(totalFrames));
            setProgress(fraction, message);
          },
          onDone: () => {
            if (overlayStatus) overlayStatus.textContent = labels.complete || "Export complete";
            hideOverlay(labels.completeDelayMs ?? 900);
          },
        });

        if (exportCancelled) {
          hideOverlay(0);
          onStatus?.(labels.cancelled || "Export cancelled");
          return { ok: false, reason: "cancelled" };
        }

        onStatus?.(labels.saved || ("Export saved · " + suggestedName));
        return { ok: true };
      } catch (error) {
        console.error(error);
        try { await writable.abort(); } catch (_) {}
        if (overlayStatus) {
          overlayStatus.textContent = (labels.failed || "Export failed · {message}")
            .replace("{message}", error.message || "error");
        }
        hideOverlay(labels.failedDelayMs ?? 2600);
        onStatus?.(
          (labels.failed || "Export failed · {message}")
            .replace("{message}", error.message || "error"),
        );
        return { ok: false, reason: "error", error };
      } finally {
        if (restore) await restore(sceneSaved);
        if (viewportSaved && restoreViewport) restoreViewport(viewportSaved);
        preCapture = null;
        exporting = false;
        await audio.resumeContext();
      }
    },
  };
}

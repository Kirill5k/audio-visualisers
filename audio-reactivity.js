"use strict";

// =====================================================
// Shared audio reactivity
// -----------------------------------------------------
// Turns a raw FFT magnitude array (0..255, like
// AnalyserNode.getByteFrequencyData) into a small set of
// smoothed, musically-useful signals.
//
// Philosophy: every exposed signal is passed through an
// attack/release envelope follower so nothing snaps on a
// single transient. Visualizers should drive light,
// material, density and *forward speed* from these — never
// instantaneous camera displacement.
//
// Exposed (read each frame after update()):
//   .bass .lowMid .mid .high .air   smoothed band energy 0..1
//   .<band>Raw                       un-smoothed band energy 0..1
//   .rms                             smoothed overall energy 0..1
//   .rmsRaw                          un-smoothed overall energy 0..1
//   .build                           very slow energy envelope 0..1
//                                    (use for multi-second ramps)
// =====================================================

function createAudioReactivity(opts) {
  opts = opts || {};
  const fftSize = opts.fftSize || 2048;
  const bins = opts.bins || (fftSize >> 1);
  const sampleRate = opts.sampleRate || 44100;
  const nyquist = sampleRate / 2;

  // Band edges in Hz, tuned for music (kick/sub, bass body,
  // mids, presence, air).
  const bandDefs = {
    bass:   [20, 120],
    lowMid: [120, 500],
    mid:    [500, 2000],
    high:   [2000, 6000],
    air:    [6000, 16000],
  };

  function binRange(lo, hi) {
    const a = Math.max(0, Math.floor((lo / nyquist) * bins));
    const b = Math.min(bins - 1, Math.ceil((hi / nyquist) * bins));
    return [a, Math.max(a, b)];
  }

  const ranges = {};
  for (const k in bandDefs) ranges[k] = binRange(bandDefs[k][0], bandDefs[k][1]);

  // Envelope follower: fast attack, slow release (ms).
  function follow(prev, target, delta, attackMs, releaseMs) {
    const tau = target > prev ? attackMs : releaseMs;
    const coeff = 1 - Math.exp(-(delta * 1000) / Math.max(1, tau));
    return prev + (target - prev) * coeff;
  }

  function bandAvg(data, range) {
    let s = 0;
    const a = range[0], b = range[1];
    for (let i = a; i <= b; i++) s += data[i];
    return (s / (b - a + 1)) / 255;
  }

  const r = {
    bass: 0, lowMid: 0, mid: 0, high: 0, air: 0,
    bassRaw: 0, lowMidRaw: 0, midRaw: 0, highRaw: 0, airRaw: 0,
    rms: 0, rmsRaw: 0, build: 0,

    // Reset all envelopes (used before deterministic offline export).
    reset() {
      this.bass = this.lowMid = this.mid = this.high = this.air = 0;
      this.bassRaw = this.lowMidRaw = this.midRaw = this.highRaw = this.airRaw = 0;
      this.rms = this.rmsRaw = this.build = 0;
    },

    update(data, delta) {
      // clamp delta so a stalled tab doesn't produce a giant jump
      const d = Math.min(delta, 0.1);

      for (const k in ranges) {
        const raw = bandAvg(data, ranges[k]);
        this[k + 'Raw'] = raw;
        this[k] = follow(this[k], raw, d, 80, 400);
      }

      // Overall energy (skip the lowest couple of DC-ish bins).
      let s = 0;
      const start = Math.min(2, bins);
      for (let i = start; i < bins; i++) {
        const v = data[i] / 255;
        s += v * v;
      }
      const rmsRaw = Math.sqrt(s / Math.max(1, bins - start));
      this.rmsRaw = rmsRaw;
      this.rms = follow(this.rms, rmsRaw, d, 120, 500);

      // Long "build / drop" envelope: quick-ish to rise, very
      // slow to fall, so breakdowns calm and drops surge over
      // seconds rather than frames.
      this.build = follow(this.build, rmsRaw, d, 800, 4000);
    },
  };

  return r;
}

if (typeof window !== 'undefined') window.createAudioReactivity = createAudioReactivity;

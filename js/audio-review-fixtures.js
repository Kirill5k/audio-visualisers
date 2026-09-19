// Deterministic tiny WAV files for opt-in visualiser integration checks.
export function makeAudioFixture(kind) {
  const sampleRate = 48000;
  const sampleCount = Math.round(sampleRate * 0.72);
  const channelCount = kind === 'mono' ? 1 : 2;
  const bytes = new ArrayBuffer(44 + sampleCount * channelCount * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, sampleCount * channelCount * 2, true);
  for (let sample = 0; sample < sampleCount; sample++) {
    const value = kind === 'silence' ? 0 : Math.round(Math.sin(2 * Math.PI * 997 * sample / sampleRate) * 19660);
    for (let channel = 0; channel < channelCount; channel++) {
      const output = kind === 'right-only' && channel === 0 ? 0
        : kind === 'opposite-phase' && channel === 1 ? -value : value;
      view.setInt16(44 + (sample * channelCount + channel) * 2, output, true);
    }
  }
  return new File([bytes], `spectral-${kind}.wav`, { type: 'audio/wav' });
}


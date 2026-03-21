class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._samplesCount = 0;
    this._flushSize = 2400; // ~100ms at 24kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const ratio = sampleRate / 24000;
    const outLen = Math.floor(channelData.length / ratio);
    if (outLen === 0) return true;

    const pcm16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, channelData[Math.floor(i * ratio)]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this._chunks.push(pcm16);
    this._samplesCount += outLen;

    if (this._samplesCount >= this._flushSize) {
      const merged = new Int16Array(this._samplesCount);
      let offset = 0;
      for (const chunk of this._chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._chunks = [];
      this._samplesCount = 0;
      this.port.postMessage(merged.buffer, [merged.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);

const SAMPLE_RATE = 24000;

interface MicCapture {
  stop: () => void;
}

export async function startMicCapture(
  onChunk: (pcm16: ArrayBuffer) => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);

  await ctx.audioWorklet.addModule("/pcm-processor.js");
  const worklet = new AudioWorkletNode(ctx, "pcm-processor");

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    onChunk(e.data);
  };

  source.connect(worklet);
  // Do not connect worklet to destination — we don't want to hear ourselves

  return {
    stop() {
      worklet.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}

interface AudioPlayer {
  play: (pcm16: ArrayBuffer) => void;
  flush: () => void;
  stop: () => void;
}

export function createAudioPlayer(
  onSpeakingChange?: (speaking: boolean) => void,
): AudioPlayer {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  let nextStartTime = 0;
  const activeSources: AudioBufferSourceNode[] = [];
  let speaking = false;

  // "Speaking" = at least one scheduled chunk is still playing. Chunks are
  // scheduled back-to-back (nextStartTime), so the queue stays non-empty for the
  // whole utterance and only drains on the last chunk's onended (or flush).
  function setSpeaking(value: boolean) {
    if (speaking === value) return;
    speaking = value;
    onSpeakingChange?.(value);
  }

  function play(pcm16: ArrayBuffer) {
    const int16 = new Int16Array(pcm16);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }

    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextStartTime < now) nextStartTime = now;
    source.start(nextStartTime);
    nextStartTime += buffer.duration;

    activeSources.push(source);
    setSpeaking(true);
    source.onended = () => {
      const idx = activeSources.indexOf(source);
      if (idx !== -1) activeSources.splice(idx, 1);
      if (activeSources.length === 0) setSpeaking(false);
    };
  }

  function flush() {
    for (const source of activeSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    activeSources.length = 0;
    nextStartTime = 0;
    setSpeaking(false);
  }

  function stop() {
    flush();
    ctx.close();
  }

  return { play, flush, stop };
}

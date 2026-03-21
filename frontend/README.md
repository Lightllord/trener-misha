# frontend

Thin browser client: microphone capture, audio playback, and minimal UI. All intelligence lives on the backend.

## Architecture

### Capture pipeline (mic → backend)

```
getUserMedia (mono, echo cancel, noise suppress)
  → AudioContext
    → AudioWorkletNode ("pcm-processor")
      → resample to 24kHz + convert to PCM16 (Int16Array)
        → postMessage to main thread
          → ws.send(binary)
```

The AudioWorklet (`public/pcm-processor.js`) buffers samples and flushes every ~100ms (2400 samples at 24kHz).

### Playback pipeline (backend → speaker)

```
ws.onmessage (ArrayBuffer)
  → Int16Array → Float32Array
    → AudioBuffer (24kHz mono)
      → AudioBufferSourceNode
        → ctx.destination (speaker)
```

Chunks are scheduled back-to-back using `nextStartTime` for gapless playback.

### Interrupt handling

When the backend sends `{ type: "interrupt" }` (user started speaking during assistant response), the player calls `flush()` — stops all queued `AudioBufferSourceNode`s and resets the schedule.

## Key files

| File | Role |
|------|------|
| `src/main.ts` | WebSocket client, UI event handlers, control message routing |
| `src/audio.ts` | `startMicCapture()` and `createAudioPlayer()` |
| `public/pcm-processor.js` | AudioWorklet: resample + PCM16 encode |
| `vite.config.ts` | Dev server on :5173, proxies `/ws` → `ws://localhost:3000` |

## Commands

```bash
npm run dev      # vite dev server (port 5173)
npm run build    # tsc + vite build
npm run preview  # serve production build
```

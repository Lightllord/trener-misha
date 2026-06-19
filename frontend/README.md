# frontend

Desktop client (Electron + Vite/TS): microphone capture, audio playback, push-to-talk, and minimal UI. All intelligence lives on the backend. **Electron-only** — a plain browser tab can't capture a global hotkey, so there's no browser build; the wrapper makes push-to-talk a **global hotkey** that works even while Dota is focused in the foreground.

## Architecture

### Capture pipeline (mic → backend)

```
getUserMedia (mono, echo cancel, noise suppress)
  → AudioContext
    → AudioWorkletNode ("pcm-processor")
      → resample to 24kHz + convert to PCM16 (Int16Array)
        → postMessage to main thread
          → ws.send(binary)   // only while the push-to-talk gate is open
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

### Push-to-talk

The mic is **gated**: captured audio is only sent over the WS while the gate is open (server-side VAD still segments turns from what we send). Settings persist to `localStorage`; the key is rebindable from the UI (click the key button, then press the new key).

The global keyboard hook lives in the Electron main process (`electron/main.cjs`, via [`uiohook-napi`](https://www.npmjs.com/package/uiohook-napi) — global `keydown`/`keyup`, prebuilt, no compile). It forwards the bound key's down/up to the renderer over IPC (`electron/preload.cjs` → `window.desktopPtt`); `src/ptt.ts` applies the mode and flips the gate. Both **hold** and **toggle** (default) work globally — `keyup` is available, unlike Electron's built-in `globalShortcut`. The hook is **passive** (it doesn't swallow the key), so the bound key still works in-game. Default key is **F8**; rebind from the UI.

## Key files

| File | Role |
|------|------|
| `src/main.ts` | WebSocket client, UI handlers, control routing, desktop bridge wiring |
| `src/audio.ts` | `startMicCapture()` and `createAudioPlayer()` |
| `src/ptt.ts` | `PttController` — mic gate + hold/toggle mode, driven by IPC down/up |
| `src/pttSettings.ts` | Load/save settings (keycode, label, mode) to localStorage |
| `src/sound.ts` | Short Web Audio cue tones on mic open/close |
| `public/pcm-processor.js` | AudioWorklet: resample + PCM16 encode |
| `electron/main.cjs` | Electron main: window + global keyboard hook (uiohook-napi) → IPC |
| `electron/preload.cjs` | Exposes `window.desktopPtt` to the renderer |
| `vite.config.ts` | Dev server on :5173, proxies `/ws` → backend; relative `base` for Electron |

## Commands

```bash
npm install            # first time (pulls Electron — a few hundred MB)
npm run dev            # Vite dev server on :5173 (standalone)
npm run build          # tsc + vite build → dist/
npm run desktop        # start Vite (if needed) + Electron together; closing the app stops Vite too
npm run desktop:build  # build dist/ then package a desktop app → release/
```

The backend (`:3000`) must be running for Connect to work — see the root README.

## Run locally without building

One command:
```bash
npm run desktop
```
`scripts/desktop-dev.mjs` brings up the Vite dev server (if it isn't already) and Electron together. Electron loads `http://localhost:5173`, so you get hot reload **and** the global hotkey, no build step. **Closing the app window stops the Vite server too** — everything tears down as one. (If you'd started Vite separately with `npm run dev`, the launcher reuses it and leaves it running on exit.)

`npm run desktop:electron` runs only Electron (assumes Vite is already up).

(Opening `http://localhost:5173` in a plain browser shows the UI but the global hotkey won't work — `window.desktopPtt` is absent and the app logs a warning. Use `npm run desktop`.)

## Build a desktop app

```bash
npm run desktop:build  # vite build + electron-builder → release/
```
On Windows this produces a portable `.exe` in `release/`. The packaged app loads `dist/index.html` over `file://` and connects to the backend at `ws://localhost:3000/ws` directly (no Vite proxy). `electron-builder` config lives in `package.json` under `"build"`.

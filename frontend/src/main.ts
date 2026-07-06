import { startMicCapture, createAudioPlayer } from "./audio";
import { PttController } from "./ptt";
import { codeToUiohookName, isTypingTarget, labelForCode } from "./pttSettings";
import { playCue } from "./sound";
import type { PttMode } from "./types/ptt";

// --- UI elements ---

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const disconnectBtn = document.querySelector<HTMLButtonElement>("#disconnect")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const activityEl = document.querySelector<HTMLDivElement>("#activity")!;
const micIndicatorEl = document.querySelector<HTMLDivElement>("#mic-indicator")!;
const modeSelectEl = document.querySelector<HTMLSelectElement>("#ptt-mode")!;
const rebindBtn = document.querySelector<HTMLButtonElement>("#ptt-rebind")!;
const keyLabelEl = document.querySelector<HTMLElement>("#ptt-key")!;

let ws: WebSocket | null = null;
let mic: { stop: () => void } | null = null;
let player: ReturnType<typeof createAudioPlayer> | null = null;
let micGateOpen = false;
let botSpeaking = false;
let interruptedUntil = 0;
let rebinding = false;
let uiohookByName: Record<string, number> = {};

// The single "что сейчас происходит" line, derived entirely from local state:
// mic gate (человек говорит), audio playback (бот говорит), and a short flash
// after a barge-in. No server push needed beyond the audio + interrupt frames.
function renderActivity() {
  if (!ws) {
    activityEl.textContent = "";
    activityEl.className = "";
    return;
  }
  if (Date.now() < interruptedUntil) {
    activityEl.textContent = "⚡ Прервано";
    activityEl.className = "interrupted";
  } else if (micGateOpen) {
    activityEl.textContent = "🎙️ Ты говоришь";
    activityEl.className = "listening";
  } else if (botSpeaking) {
    activityEl.textContent = "🔊 Миша говорит";
    activityEl.className = "speaking";
  } else {
    activityEl.textContent = "… Тишина";
    activityEl.className = "idle";
  }
}

function sendControl(msg: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// --- Push-to-talk ---
// Key events come from two non-overlapping sources: the global hook (main
// process) while the window is NOT focused, and the window listeners below
// while it IS focused. Both feed pressDown/pressUp.

const ptt = new PttController((open) => {
  micGateOpen = open;
  // Closing the gate signals end-of-turn. Server VAD handles the normal case;
  // this forces a commit when the mic is cut mid-speech (no trailing silence
  // for VAD to detect), which would otherwise hang waiting for a response.
  if (!open) sendControl({ type: "mic_close" });
  playCue(open ? "on" : "off");
  setMicIndicator(open);
  renderActivity();
});

function setMicIndicator(open: boolean) {
  micIndicatorEl.className = open ? "live" : "muted";
  micIndicatorEl.textContent = open
    ? "🎙️ Микрофон включён"
    : `🔇 Микрофон выключен — ${labelForCode(ptt.getSettings().code)}`;
}

function renderKeyLabel() {
  keyLabelEl.textContent = labelForCode(ptt.getSettings().code);
}

// Tell the main process which keycode the global hook should watch.
function syncGlobalKey() {
  const desktop = window.desktopPtt;
  if (!desktop) return;
  const name = codeToUiohookName(ptt.getSettings().code);
  const keycode = uiohookByName[name];
  if (typeof keycode !== "number") {
    console.warn(
      `Клавиша ${labelForCode(ptt.getSettings().code)} не поддерживается глобально (в фоне). Работает только при фокусе.`,
    );
    void desktop.setKey(null);
    return;
  }
  void desktop.setKey(keycode);
}

modeSelectEl.value = ptt.getSettings().mode;
renderKeyLabel();
setMicIndicator(false);

modeSelectEl.addEventListener("change", () => {
  ptt.setMode(modeSelectEl.value as PttMode);
});

rebindBtn.addEventListener("click", () => {
  if (rebinding) return;
  rebinding = true;
  rebindBtn.classList.add("listening");
  keyLabelEl.textContent = "нажми клавишу…";
});

// Window key listeners — fire while the app window is focused.
window.addEventListener("keydown", (e) => {
  if (rebinding) {
    e.preventDefault();
    rebinding = false;
    rebindBtn.classList.remove("listening");
    rebindBtn.blur();
    if (e.code !== "Escape") {
      ptt.setCode(e.code);
      syncGlobalKey();
    }
    renderKeyLabel();
    setMicIndicator(micGateOpen);
    return;
  }
  if (e.code !== ptt.getSettings().code || isTypingTarget(e.target)) return;
  e.preventDefault(); // stop the key from also activating a focused button
  if (e.repeat) return;
  ptt.pressDown();
});

window.addEventListener("keyup", (e) => {
  if (e.code !== ptt.getSettings().code || isTypingTarget(e.target)) return;
  e.preventDefault();
  ptt.pressUp();
});

// --- Global hook bridge (Electron main) — fires while window is NOT focused ---

async function initDesktop() {
  const desktop = window.desktopPtt;
  if (!desktop) {
    console.warn("Запусти как десктоп-приложение (npm run desktop) — глобальный хоткей живёт там.");
    return;
  }
  uiohookByName = await desktop.keymap();
  desktop.onDown(() => ptt.pressDown());
  desktop.onUp(() => ptt.pressUp());
  syncGlobalKey();
  console.info(`PTT готов: клавиша ${labelForCode(ptt.getSettings().code)}, режим ${ptt.getSettings().mode}.`);
}

void initDesktop();

function setConnected(connected: boolean) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  statusEl.textContent = connected ? "Connected" : "Disconnected";
  statusEl.className = connected ? "connected" : "";
  renderActivity();
}

function disconnect() {
  ptt.disable();
  mic?.stop();
  mic = null;
  player?.stop();
  player = null;
  ws?.close();
  ws = null;
  setConnected(false);
}

// --- Control message types from backend ---
// The backend now only pushes audio (binary) and a single interrupt frame after
// a barge-in; transcripts, tool use and errors live in the backend log.

interface ControlMessage {
  type: "interrupt";
}

function handleControlMessage(msg: ControlMessage) {
  if (msg.type === "interrupt") {
    player?.flush();
    interruptedUntil = Date.now() + 1200;
    renderActivity();
    window.setTimeout(renderActivity, 1300);
  }
}

// --- Connect ---

connectBtn.addEventListener("click", async () => {
  try {
    connectBtn.disabled = true;
    statusEl.textContent = "Connecting...";
    console.info("Connecting to backend…");

    ws = new WebSocket("ws://localhost:3000/ws");
    ws.binaryType = "arraybuffer";

    player = createAudioPlayer((speaking) => {
      botSpeaking = speaking;
      renderActivity();
    });

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        player?.play(event.data);
      } else {
        try {
          const msg = JSON.parse(event.data as string) as ControlMessage;
          handleControlMessage(msg);
        } catch {
          console.warn("Unknown message:", event.data);
        }
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      disconnect();
    };

    ws.onclose = () => {
      console.info("WebSocket closed");
      disconnect();
    };

    await new Promise<void>((resolve, reject) => {
      ws!.onopen = () => resolve();
      ws!.onerror = () => reject(new Error("WebSocket connection failed"));
    });

    console.info("WebSocket connected, starting microphone…");

    mic = await startMicCapture((pcm16: ArrayBuffer) => {
      if (micGateOpen && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm16);
      }
    });

    ptt.enable();
    setConnected(true);
    // Drop focus so a bound key like Space/Enter can't "click" a focused button.
    connectBtn.blur();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const { code, mode } = ptt.getSettings();
    console.info(`Mic ready. ${mode === "hold" ? "Hold" : "Press"} ${labelForCode(code)} to talk.`);
  } catch (err) {
    console.error(err);
    disconnect();
  }
});

disconnectBtn.addEventListener("click", () => {
  disconnectBtn.blur();
  disconnect();
  console.info("Disconnected");
});

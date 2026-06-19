import { startMicCapture, createAudioPlayer } from "./audio";
import { PttController } from "./ptt";
import { codeToUiohookName, isTypingTarget, labelForCode } from "./pttSettings";
import { playCue } from "./sound";
import type { PttMode } from "./types/ptt";

// --- UI elements ---

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const disconnectBtn = document.querySelector<HTMLButtonElement>("#disconnect")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const logEl = document.querySelector<HTMLDivElement>("#log")!;
const micIndicatorEl = document.querySelector<HTMLDivElement>("#mic-indicator")!;
const modeSelectEl = document.querySelector<HTMLSelectElement>("#ptt-mode")!;
const rebindBtn = document.querySelector<HTMLButtonElement>("#ptt-rebind")!;
const keyLabelEl = document.querySelector<HTMLElement>("#ptt-key")!;

let ws: WebSocket | null = null;
let mic: { stop: () => void } | null = null;
let player: ReturnType<typeof createAudioPlayer> | null = null;
let micGateOpen = false;
let rebinding = false;
let uiohookByName: Record<string, number> = {};

function log(msg: string) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
}

// --- Push-to-talk ---
// Key events come from two non-overlapping sources: the global hook (main
// process) while the window is NOT focused, and the window listeners below
// while it IS focused. Both feed pressDown/pressUp.

const ptt = new PttController((open) => {
  micGateOpen = open;
  playCue(open ? "on" : "off");
  setMicIndicator(open);
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
    log(`⚠ Клавиша ${labelForCode(ptt.getSettings().code)} не поддерживается глобально (в фоне). Работает только при фокусе.`);
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
    log("⚠ Запусти как десктоп-приложение (npm run desktop) — глобальный хоткей живёт там.");
    return;
  }
  uiohookByName = await desktop.keymap();
  desktop.onDown(() => ptt.pressDown());
  desktop.onUp(() => ptt.pressUp());
  syncGlobalKey();
  log(`PTT готов: клавиша ${labelForCode(ptt.getSettings().code)}, режим ${ptt.getSettings().mode}.`);
}

void initDesktop();

function setConnected(connected: boolean) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  statusEl.textContent = connected ? "Connected" : "Disconnected";
  statusEl.className = connected ? "connected" : "";
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

interface ControlMessage {
  type: "connected" | "transcript" | "tool_call" | "tool_result" | "error" | "interrupt";
  role?: string;
  text?: string;
  name?: string;
  result?: string;
  message?: string;
}

function handleControlMessage(msg: ControlMessage) {
  switch (msg.type) {
    case "connected":
      log("Session connected to OpenAI. Start speaking.");
      break;
    case "transcript":
      if (msg.role === "user") log(`You: ${msg.text}`);
      else log(`Миша: ${msg.text}`);
      break;
    case "tool_call":
      log(`Tool call: ${msg.name}`);
      break;
    case "tool_result":
      log(`Tool result [${msg.name}]: ${msg.result}`);
      break;
    case "interrupt":
      player?.flush();
      break;
    case "error":
      log(`Error: ${msg.message}`);
      break;
  }
}

// --- Connect ---

connectBtn.addEventListener("click", async () => {
  try {
    connectBtn.disabled = true;
    statusEl.textContent = "Connecting...";
    log("Connecting to backend...");

    ws = new WebSocket("ws://localhost:3000/ws");
    ws.binaryType = "arraybuffer";

    player = createAudioPlayer();

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
      log("WebSocket error");
      disconnect();
    };

    ws.onclose = () => {
      log("WebSocket closed");
      disconnect();
    };

    await new Promise<void>((resolve, reject) => {
      ws!.onopen = () => resolve();
      ws!.onerror = () => reject(new Error("WebSocket connection failed"));
    });

    log("WebSocket connected, starting microphone...");

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
    log(`Mic ready. ${mode === "hold" ? "Hold" : "Press"} ${labelForCode(code)} to talk.`);
  } catch (err) {
    console.error(err);
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    disconnect();
  }
});

disconnectBtn.addEventListener("click", () => {
  disconnectBtn.blur();
  disconnect();
  log("Disconnected");
});

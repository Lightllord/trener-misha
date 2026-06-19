import { startMicCapture, createAudioPlayer } from "./audio";
import { PttController } from "./ptt";
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

function log(msg: string) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
}

// --- Push-to-talk ---
// Key events arrive from the Electron main process (global hook); the gate
// decides whether captured mic audio is forwarded over the WS.

const ptt = new PttController((open) => {
  micGateOpen = open;
  playCue(open ? "on" : "off");
  setMicIndicator(open);
});

function setMicIndicator(open: boolean) {
  micIndicatorEl.className = open ? "live" : "muted";
  micIndicatorEl.textContent = open
    ? "🎙️ Микрофон включён"
    : `🔇 Микрофон выключен — ${ptt.getSettings().label}`;
}

function renderKeyLabel() {
  keyLabelEl.textContent = ptt.getSettings().label;
}

modeSelectEl.value = ptt.getSettings().mode;
renderKeyLabel();
setMicIndicator(false);

modeSelectEl.addEventListener("change", () => {
  ptt.setMode(modeSelectEl.value as PttMode);
});

rebindBtn.addEventListener("click", async () => {
  const desktop = window.desktopPtt;
  if (!desktop) return;
  rebindBtn.classList.add("listening");
  keyLabelEl.textContent = "нажми клавишу…";
  const bound = await desktop.captureNext();
  ptt.setBinding(bound.keycode, bound.label);
  rebindBtn.classList.remove("listening");
  rebindBtn.blur();
  renderKeyLabel();
  setMicIndicator(micGateOpen);
});

// --- Global hotkey bridge (Electron main process) ---

async function initDesktop() {
  const desktop = window.desktopPtt;
  if (!desktop) {
    log("⚠ Запусти как десктоп-приложение (npm run desktop) — глобальный хоткей живёт там.");
    return;
  }
  desktop.onDown(() => ptt.pressDown());
  desktop.onUp(() => ptt.pressUp());
  const bound = await desktop.setKey(ptt.getSettings().keycode);
  ptt.setBinding(bound.keycode, bound.label);
  renderKeyLabel();
  setMicIndicator(micGateOpen);
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

    // Connect straight to the backend (no Vite proxy — we run as a desktop app).
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
    const { label, mode } = ptt.getSettings();
    log(`Mic ready. ${mode === "hold" ? "Hold" : "Press"} ${label} to talk.`);
  } catch (err) {
    console.error(err);
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    disconnect();
  }
});

disconnectBtn.addEventListener("click", () => {
  disconnect();
  log("Disconnected");
});

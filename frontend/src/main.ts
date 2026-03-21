import { startMicCapture, createAudioPlayer } from "./audio";

// --- UI elements ---

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const disconnectBtn = document.querySelector<HTMLButtonElement>("#disconnect")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const logEl = document.querySelector<HTMLDivElement>("#log")!;

let ws: WebSocket | null = null;
let mic: { stop: () => void } | null = null;
let player: ReturnType<typeof createAudioPlayer> | null = null;

function log(msg: string) {
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
}

function setConnected(connected: boolean) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  statusEl.textContent = connected ? "Connected" : "Disconnected";
  statusEl.className = connected ? "connected" : "";
}

function disconnect() {
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

    // 1. Open WebSocket to backend
    const wsUrl = `ws://${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    // 2. Create audio player for incoming audio
    player = createAudioPlayer();

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary = PCM16 audio from OpenAI via backend
        player?.play(event.data);
      } else {
        // JSON control message
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

    // 3. Wait for WS to open, then start mic
    await new Promise<void>((resolve, reject) => {
      ws!.onopen = () => resolve();
      ws!.onerror = () => reject(new Error("WebSocket connection failed"));
    });

    log("WebSocket connected, starting microphone...");

    // 4. Start mic capture, send PCM16 chunks over WS
    mic = await startMicCapture((pcm16: ArrayBuffer) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcm16);
      }
    });

    setConnected(true);
    log("Microphone active. Speak now.");
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

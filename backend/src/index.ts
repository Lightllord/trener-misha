import "./logger.js";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { RealtimeSession } from "@openai/agents/realtime";
import "dotenv/config";
import { agent } from "./agent.js";
import { checkAndAnalyzeDraft, resetDraftAnalysis } from "./draftAnalysis.js";
import { clearInsights } from "./insights.js";
import { createInsightDelivery } from "./insightDelivery.js";
import {
  clearConversation,
  formatConversationForPrompt,
  getRecentConversation,
  logTranscript,
} from "./conversationLog.js";
import { PICKER_CONTEXT_WINDOW_MS } from "./consts/conversationLog.js";
import { setDraft, setState, getState, clearGameData } from "./gameData.js";
import {
  processStateUpdate,
  takeEvents,
  takeFallbackStatus,
  startFallbackTimer,
  clearEventQueue,
} from "./gameEventQueue.js";

process.on("unhandledRejection", (err) => {
  console.error("[FATAL] Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("trener-misha backend is running");
});

app.post("/push/draft", (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || !Array.isArray(body.radiant) || !Array.isArray(body.dire)) {
    res.status(400).json({ error: "Invalid draft payload" });
    return;
  }
  setDraft(body as { radiant: string[]; dire: string[]; confidence: number[]; detectedAt: string });
  console.log("[push] Draft received:", (body.radiant as string[]).join(", "), "|", (body.dire as string[]).join(", "));
  checkAndAnalyzeDraft();
  res.json({ status: "ok" });
});

app.post("/push/state", (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body) {
    res.status(400).json({ error: "Invalid state payload" });
    return;
  }
  const prev = getState();
  setState(body);
  if (prev) {
    processStateUpdate(prev, body);
  }
  res.json({ status: "ok" });
});

const server = app.listen(PORT, () => {
  console.log(`[trener-misha] Backend listening on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", async (ws) => {
  console.log("[ws] Client connected");

  const session = new RealtimeSession(agent, {
    transport: "websocket",
    model: "gpt-realtime-1.5",
  });

  function send(msg: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Relay audio from OpenAI → browser (binary PCM16 24kHz)
  session.on("audio", (event) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(event.data as ArrayBuffer));
    }
  });

  session.on("agent_tool_start", (_ctx, _agent, toolDef) => {
    console.log(`[tool] start: ${toolDef.name}`);
    send({ type: "tool_call", name: toolDef.name });
  });

  session.on("agent_tool_end", (_ctx, _agent, toolDef, result) => {
    console.log(`[tool] end: ${toolDef.name}`);
    send({ type: "tool_result", name: toolDef.name, result: String(result) });
  });

  session.on("history_added", (item: Record<string, unknown>) => {
    const type = item.type as string | undefined;
    const role = item.role as string | undefined;
    const status = item.status as string | undefined;
    const content = item.content as Array<Record<string, unknown>> | undefined;

    if (type === "message" && content && (role === "user" || role === "assistant")) {
      const text = content
        .map((c) => (c.transcript as string) || (c.text as string) || "")
        .filter(Boolean)
        .join(" ");
      if (text && (role === "user" || status === "completed")) {
        send({ type: "transcript", role, text });
        logTranscript(role, text);
      }
    }
  });

  session.on("error", (err) => {
    console.error("[session] error:", err);
    send({ type: "error", message: String(err) });
  });

  let deliveryInterval: ReturnType<typeof setInterval> | null = null;
  const pickerAbort = new AbortController();

  // Connect to OpenAI
  try {
    await session.connect({ apiKey: process.env.OPENAI_API_KEY! });

    // When OpenAI detects user speech during response → interrupt frontend playback
    session.transport.on("audio_interrupted", () => {
      console.log("[vad] audio interrupted — flushing frontend playback");
      send({ type: "interrupt" });
    });

    // Track response activity to avoid race conditions
    let responseActive = false;

    session.transport.on("turn_started", () => {
      responseActive = true;
    });

    session.transport.on("turn_done", () => {
      responseActive = false;
      tryDeliver();
    });

    const delivery = createInsightDelivery({
      inject: (text) => injectMessage(text, true),
      isResponseActive: () => responseActive,
      getRecentDialogue: () =>
        formatConversationForPrompt(
          getRecentConversation(PICKER_CONTEXT_WINDOW_MS),
        ),
      signal: pickerAbort.signal,
    });

    function tryDeliver(): void {
      if (responseActive) return;
      if (delivery.tryDeliver()) return;

      // No insights → fall through to game events / fallback status
      const events = takeEvents();
      if (events) {
        console.log("[deliver] Game events");
        injectMessage(events.text, events.triggerResponse);
        return;
      }

      const fallback = takeFallbackStatus();
      if (fallback) {
        console.log("[deliver] Fallback status update");
        injectMessage(fallback.text, fallback.triggerResponse);
      }
    }

    function injectMessage(text: string, triggerResponse: boolean): void {
      responseActive = true; // assume response will start
      session.transport.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [{ type: "input_text", text }],
        },
      });
      if (triggerResponse) {
        session.transport.sendEvent({ type: "response.create" });
      } else {
        // No response triggered — reset flag so next delivery can proceed
        responseActive = false;
      }
    }

    // Safety net: try delivering every 5s
    deliveryInterval = setInterval(tryDeliver, 5_000);

    // Fallback timer: generate status updates every 2 min
    startFallbackTimer(tryDeliver);

    send({ type: "connected" });
    console.log("[ws] Session connected to OpenAI");
  } catch (err) {
    console.error("[ws] Failed to connect to OpenAI:", err);
    send({ type: "error", message: "Failed to connect to OpenAI" });
    ws.close();
    return;
  }

  // Relay audio from browser → OpenAI (binary PCM16 24kHz)
  ws.on("message", (data, isBinary) => {
    if (isBinary && Buffer.isBuffer(data)) {
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      session.sendAudio(arrayBuffer);
    }
  });

  ws.on("close", () => {
    console.log("[ws] Client disconnected");
    // pickerAbort stops any in-flight pickInsight call; the delivery closure
    // (with its pending slot) is garbage-collected with the WS handler scope.
    pickerAbort.abort();
    if (deliveryInterval) clearInterval(deliveryInterval);
    clearEventQueue();
    resetDraftAnalysis();
    clearInsights();
    clearConversation();
    clearGameData();
    session.close();
  });

  ws.on("error", (err) => {
    console.error("[ws] WebSocket error:", err);
    if (deliveryInterval) clearInterval(deliveryInterval);
    clearEventQueue();
    session.close();
  });
});

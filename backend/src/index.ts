import "./logger.js";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { RealtimeSession } from "@openai/agents/realtime";
import "dotenv/config";
import { agent } from "./agent.js";
import { checkAndAnalyzeDraft, resetDraftAnalysis } from "./draftAnalysis.js";
import {
  clearInsights,
  getAllInsights,
  getUnused,
  markUsed,
} from "./insights.js";
import { pickInsight } from "./insightPicker.js";
import type { Insight } from "./types/insight.js";
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
      }
    }
  });

  session.on("error", (err) => {
    console.error("[session] error:", err);
    send({ type: "error", message: String(err) });
  });

  let deliveryInterval: ReturnType<typeof setInterval> | null = null;
  let pendingInsightPick: Insight | null = null;
  let pickerInFlight = false;
  let connectionClosed = false;
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

    function isLive(insight: Insight): boolean {
      return getAllInsights().includes(insight);
    }

    function deliverInsight(insight: Insight): void {
      const suffix = insight.number !== null ? ` #${insight.number}` : "";
      console.log(`[deliver] insight: ${insight.name}${suffix}`);
      injectMessage(insight.payload, true);
      markUsed(insight); // only after successful inject
    }

    function tryDeliver(): void {
      if (responseActive) return;

      // Fast path — a prior picker finished while responseActive was true
      if (
        pendingInsightPick &&
        !pendingInsightPick.used &&
        isLive(pendingInsightPick)
      ) {
        const p = pendingInsightPick;
        pendingInsightPick = null;
        deliverInsight(p);
        return;
      }
      pendingInsightPick = null; // drop stale ref if any

      // Insights have highest priority
      const unused = getUnused();
      if (unused.length > 0) {
        if (unused.length === 1) {
          const only = unused[0];
          if (only) deliverInsight(only);
          return;
        }
        if (pickerInFlight) return; // one picker at a time
        pickerInFlight = true;
        pickInsight(unused, { signal: pickerAbort.signal })
          .then((chosen) => {
            if (connectionClosed) return;
            if (!chosen || chosen.used || !isLive(chosen)) return;
            if (responseActive) {
              pendingInsightPick = chosen;
              return;
            }
            deliverInsight(chosen);
          })
          .catch((err) => console.error("[deliver] picker failed:", err))
          .finally(() => {
            pickerInFlight = false;
          });
        return;
      }

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
    connectionClosed = true;
    pickerAbort.abort();
    pendingInsightPick = null;
    if (deliveryInterval) clearInterval(deliveryInterval);
    clearEventQueue();
    resetDraftAnalysis();
    clearInsights();
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

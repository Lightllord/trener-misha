import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { RealtimeSession } from "@openai/agents/realtime";
import "dotenv/config";
import { agent } from "./agent.js";
import { checkAndAnalyzeDraft, resetDraftAnalysis } from "./draftAnalysis.js";
import { takePending, clearPending } from "./pendingInsights.js";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("trener-misha backend is running");
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

  // Connect to OpenAI
  try {
    await session.connect({ apiKey: process.env.OPENAI_API_KEY! });

    // When OpenAI detects user speech during response → interrupt frontend playback
    session.transport.on("audio_interrupted", () => {
      console.log("[vad] audio interrupted — flushing frontend playback");
      send({ type: "interrupt" });
    });

    // On each turn_done: lazy draft check + deliver pending insights
    session.transport.on("turn_done", () => {
      checkAndAnalyzeDraft();

      const insight = takePending();
      if (!insight) return;

      console.log("[insight] Delivering pending draft analysis");
      session.transport.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `[Фоновый анализ драфта завершён]\n${insight}\n\nПредложи игроку: "У меня готов анализ драфта, рассказать?" Не рассказывай содержание сразу — дождись подтверждения.`,
            },
          ],
        },
      });

      session.transport.sendEvent({ type: "response.create" });
    });

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
    resetDraftAnalysis();
    clearPending();
    session.close();
  });

  ws.on("error", (err) => {
    console.error("[ws] WebSocket error:", err);
    session.close();
  });
});

import "./logger.js";
import "dotenv/config";
import { WebSocketServer } from "ws";
import { createIngestApp } from "./ingest/ingestApp.js";
import { VoiceSession } from "./realtime/voiceSession.js";
import { log, logError } from "./observability/log.js";
import { SERVER_PORT, WS_PATH } from "./consts/server.js";

process.on("unhandledRejection", (err) => logError("fatal", "unhandled rejection:", err));
process.on("uncaughtException", (err) => logError("fatal", "uncaught exception:", err));

const server = createIngestApp().listen(SERVER_PORT, () => {
  log("ws", `backend listening on http://localhost:${SERVER_PORT}`);
});

new WebSocketServer({ server, path: WS_PATH }).on("connection", (ws) => {
  void new VoiceSession(ws).start();
});

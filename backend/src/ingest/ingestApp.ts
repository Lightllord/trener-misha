import express, { type Express } from "express";
import cors from "cors";
import { checkAndAnalyzeDraft } from "../draftAnalysis.js";
import { setState, getState } from "../gameData.js";
import { processStateUpdate } from "../gameEventQueue.js";

// HTTP ingest for game data pushed from insight-app. No voice concerns.
export function createIngestApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.send("trener-misha backend is running");
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
    checkAndAnalyzeDraft();
    res.json({ status: "ok" });
  });

  return app;
}

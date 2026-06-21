import express, { type Express } from "express";
import cors from "cors";
import { checkAndAnalyzeDraft } from "../draftAnalysis.js";
import { setDraft, setState, getState } from "../gameData.js";
import { processStateUpdate } from "../gameEventQueue.js";
import { log } from "../observability/log.js";

// HTTP ingest for game data pushed from insight-app. No voice concerns.
export function createIngestApp(): Express {
  const app = express();
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
    setDraft(
      body as { radiant: string[]; dire: string[]; confidence: number[]; detectedAt: string },
    );
    log(
      "push",
      `draft received: ${(body.radiant as string[]).join(", ")} | ${(body.dire as string[]).join(", ")}`,
    );
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

  return app;
}

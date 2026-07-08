import express, { type Express } from "express";
import cors from "cors";
import { checkAndAnalyzeDraft, resetDraftAnalysis } from "../draftAnalysis.js";
import { setState, getState, clearGameData, setOtherHeroes } from "../gameData.js";
import { processStateUpdate, clearEventQueue } from "../gameEventQueue.js";
import { clearInsights } from "../insight/store.js";

// Game state lives in memory for as long as the backend process runs — it is
// NOT tied to the browser's WS connection, so a brief reconnect (e.g. a
// network blip) never loses the player's position, draft corrections, or the
// build plan. The only thing that should wipe it is an actual new match,
// detected here via matchId changing between two pushes.
function extractMatchId(data: Record<string, unknown> | null): string | null {
  const id = data?.matchId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

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
    const prevMatchId = extractMatchId(prev);
    const nextMatchId = extractMatchId(body);
    const isNewMatch = prevMatchId !== null && nextMatchId !== null && prevMatchId !== nextMatchId;

    if (isNewMatch) {
      clearGameData();
      clearEventQueue();
      resetDraftAnalysis();
      clearInsights();
    }

    setState(body);
    if (prev && !isNewMatch) {
      processStateUpdate(prev, body);
    }
    checkAndAnalyzeDraft();
    res.json({ status: "ok" });
  });

  // CV player-panel detections from insight-app, pushed on their own faster
  // cadence — decoupled from /push/state, which only arrives as fast as GSI's
  // own buffer/throttle allow. Misdetections are filtered against the draft
  // inside setOtherHeroes before they ever reach matchState.
  app.post("/push/player-detection", (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || !Array.isArray(body.otherHeroes)) {
      res.status(400).json({ error: "Invalid player-detection payload" });
      return;
    }
    const lastInspectGameTime = typeof body.lastEnemyInspectAt === "number" ? body.lastEnemyInspectAt : 0;
    setOtherHeroes(body.otherHeroes, lastInspectGameTime);
    res.json({ status: "ok" });
  });

  return app;
}

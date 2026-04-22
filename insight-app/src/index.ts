import "./logger.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MatchStateManager } from "./match-state.js";
import { DraftDetector } from "./draft-detector.js";
import type { RawGsiPayload } from "./types.js";

const PORT = 6074;
const BACKEND_URL = "http://localhost:3000";

const matchState = new MatchStateManager();
const draftDetector = new DraftDetector();

let backendDown = false;

let pushFailCount = 0;

function pushToBackend(path: string, data: unknown): void {
  fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((resp) => {
    if (!resp.ok) {
      console.warn(`[push] Backend returned ${resp.status} for ${path}`);
    }
    if (backendDown) {
      console.log(`[push] Backend connection restored after ${pushFailCount} failed attempts`);
      backendDown = false;
      pushFailCount = 0;
    }
  }).catch((err: unknown) => {
    pushFailCount++;
    if (!backendDown) {
      console.warn("[push] Backend unavailable:", err instanceof Error ? err.message : err);
      backendDown = true;
    } else if (pushFailCount % 30 === 0) {
      console.warn(`[push] Backend still down, ${pushFailCount} failed pushes`);
    }
  });
}

// Push draft updates to backend
draftDetector.onDraftChange((draft) => {
  pushToBackend("/push/draft", draft);
});

// При смене фазы на pre_game — запускаем детекцию драфта
matchState.onPhaseChange((newPhase, prevPhase) => {
  console.log(`[insight-app] Phase: ${prevPhase ?? "none"} → ${newPhase}`);

  if (newPhase === "pre_game" && prevPhase !== "pre_game") {
    draftDetector.start();
  }

  // Новый матч или выход — сброс
  if (newPhase === "hero_selection" && prevPhase === "post_game") {
    draftDetector.reset();
  }
});

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST") {
    try {
      const raw = await parseBody(req);
      const data = JSON.parse(raw) as RawGsiPayload;

      console.log("[POST] map:", !!data.map, "player:", !!data.player, "game_state:", data.map?.game_state ?? "none");

      matchState.update(data);

      // Push state to backend after every GSI update
      const state = matchState.current;
      if (state) {
        pushToBackend("/push/state", state);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (err) {
      console.error("[ERROR] Failed to parse body:", err);
      res.writeHead(400);
      res.end("Bad Request");
    }
    return;
  }

  res.writeHead(200);
  res.end("insight-app is running");
});

server.listen(PORT, () => {
  console.log(`[insight-app] GSI listener on http://localhost:${PORT}`);
});

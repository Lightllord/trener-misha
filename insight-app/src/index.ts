import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MatchStateManager } from "./match-state.js";
import { DraftDetector } from "./draft-detector.js";
import type { RawGsiPayload } from "./types.js";

const PORT = 6074;

const matchState = new MatchStateManager();
const draftDetector = new DraftDetector();

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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } catch (err) {
      console.error("[ERROR] Failed to parse body:", err);
      res.writeHead(400);
      res.end("Bad Request");
    }
    return;
  }

  // GET /state — текущее состояние матча для агента
  if (req.method === "GET" && req.url === "/state") {
    const state = matchState.current;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
    return;
  }

  // GET /draft — текущий драфт (составы команд)
  if (req.method === "GET" && req.url === "/draft") {
    const draft = draftDetector.current;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(draft));
    return;
  }

  res.writeHead(200);
  res.end("insight-app is running");
});

server.listen(PORT, () => {
  console.log(`[insight-app] GSI listener on http://localhost:${PORT}`);
});

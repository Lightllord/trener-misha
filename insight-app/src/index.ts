import "./logger.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MatchStateManager, otherPlayerToHeroState } from "./match-state.js";
import { DraftDetector } from "./draft-detector.js";
import { PlayerDetector } from "./player-detector.js";
import { probePython } from "./python-runtime.js";
import type { RawGsiPayload } from "./types.js";

const PORT = 6074;
const BACKEND_URL = "http://localhost:3000";

const matchState = new MatchStateManager();
const draftDetector = new DraftDetector();
const playerDetector = new PlayerDetector(
  "auto", // монитор определяется по окну Доты; см. cv/screen.py
  () => matchState.current?.heroPositions ?? {},
  () => matchState.current?.gameTime ?? 0,
  () => matchState.current?.hero.name ?? "",
);

let stopTimeoutId: ReturnType<typeof setTimeout> | null = null;
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

function pushState(): void {
  const state = matchState.current;
  if (!state) return;
  state.otherHeroes = playerDetector.getOtherPlayers().map(otherPlayerToHeroState);
  state.lastEnemyInspectAt = playerDetector.getLastInspectGameTime();
  pushToBackend("/push/state", state);
}

// Draft is part of MatchState now — record it and push the merged state.
draftDetector.onDraftChange((draft) => {
  matchState.setDraft(draft);
  pushState();
});

matchState.onPhaseChange((newPhase, prevPhase) => {
  console.log(`[insight-app] Phase: ${prevPhase ?? "none"} → ${newPhase}`);

  // Запускаем при входе в hero_selection из ЛЮБОЙ фазы: при старте insight-app
  // из меню переход бывает none → hero_selection (фаза loading не фиксируется),
  // поэтому привязка к prevPhase === "loading" пропускала детект. start()
  // идемпотентен (повторный вызов — no-op), так что лишний раз не навредит.
  if (newPhase === "hero_selection") {
    if (stopTimeoutId) { clearTimeout(stopTimeoutId); stopTimeoutId = null; }
    draftDetector.reset();
    draftDetector.start();
  }

  if (newPhase === "strategy" && prevPhase === "hero_selection") {
    stopTimeoutId = setTimeout(() => {
      console.log("[insight-app] Stopping draft polling (5s after strategy)");
      draftDetector.stop();
      stopTimeoutId = null;
    }, 5000);
  }

  if (newPhase === "playing") {
    playerDetector.reset();
    playerDetector.start();
  }

  if (prevPhase === "playing") {
    playerDetector.stop();
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
  // Zone editor UI
  if (req.method === "GET" && req.url === "/zone-editor") {
    try {
      const html = await readFile(join(process.cwd(), "zone-editor.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end("zone-editor.html not found");
    }
    return;
  }

  // Live hero positions for zone editor
  if (req.method === "GET" && req.url === "/api/hero-positions") {
    const state = matchState.current;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ heroPositions: state?.heroPositions ?? {} }));
    return;
  }

  if (req.method === "POST") {
    try {
      const raw = await parseBody(req);
      const data = JSON.parse(raw) as RawGsiPayload;

      console.log("[POST] map:", !!data.map, "player:", !!data.player, "game_state:", data.map?.game_state ?? "none");

      matchState.update(data);

      const hp = matchState.current?.heroPositions;
      if (hp && Object.keys(hp).length > 0) {
        console.log("[heroPositions]", JSON.stringify(hp));
      }

      // Push state to backend after every GSI update
      pushState();

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

async function main(): Promise<void> {
  const py = await probePython();
  if (!py) {
    console.error("[preflight] No Python found. Run `cd insight-app && uv sync`. Aborting.");
    process.exit(1);
  }
  const tag = py.versionOk ? "ok" : "version mismatch (need 3.12-3.14)";
  console.log(`[preflight] python: ${py.path} (${py.source}, ${py.version}) — ${tag}`);

  server.listen(PORT, () => {
    console.log(`[insight-app] GSI listener on http://localhost:${PORT}`);
  });
}

void main();

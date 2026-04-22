# backend

WebSocket relay between the browser frontend and the OpenAI Realtime API, plus an HTTP ingest for game data pushed from `insight-app`.

## Architecture

```
Frontend                   Backend                            OpenAI Realtime
   │                         │                                       │
   │── binary PCM16 chunks ─►│   session.sendAudio() ─────────────►  │
   │                         │                                       │
   │                         │   on('audio') ◄────────────────────   │
   │◄── binary PCM16 chunks ─│                                       │
   │                         │                                       │
   │◄── JSON control msgs ───│   on('history_added'),                │
   │                         │   on('agent_tool_start/end'),         │
   │                         │   transport.on('audio_interrupted'),  │
   │                         │   transport.on('turn_done')           │

insight-app ──POST /push/state──►  gameData  ──diffStates──► gameEventQueue
             POST /push/draft ──►  gameData  ──► checkAndAnalyzeDraft (async)

             Background work is injected into the live conversation on `turn_done`
             via `conversation.item.create` + `response.create` (system messages).
```

On each WebSocket connection:

1. Creates a `RealtimeSession` (WebSocket transport) with the `Тренер Миша` `RealtimeAgent` (`src/agent.ts`), model `gpt-realtime-1.5`.
2. Connects to OpenAI using the server-side `OPENAI_API_KEY`.
3. Relays binary audio in both directions (browser ↔ OpenAI).
4. Forwards session events as JSON control messages to the frontend.
5. Injects pending system messages (draft analysis, game events, status snapshots) between turns.
6. On disconnect: closes the OpenAI session, resets draft analysis, event queue, and in-memory game data.

## HTTP endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET` | `/` | — | Health check |
| `POST` | `/push/draft` | `{ radiant[], dire[], confidence[], detectedAt }` | Store latest draft snapshot. Triggers `checkAndAnalyzeDraft()` |
| `POST` | `/push/state` | `MatchState` (from insight-app) | Store latest game state; runs `diffStates(prev, curr)` to enqueue events |

The backend never polls `insight-app`; all game data is pushed in via these endpoints and held in-memory (`src/gameData.ts`).

## WebSocket protocol (frontend ↔ backend)

**Binary frames** — raw PCM16 24 kHz audio chunks, both directions.

**JSON control frames (backend → frontend):**
- `{ type: "connected" }` — OpenAI session is ready
- `{ type: "transcript", role: "user" | "assistant", text }` — speech transcript
- `{ type: "tool_call", name }` — tool execution started
- `{ type: "tool_result", name, result }` — tool execution finished
- `{ type: "interrupt" }` — server VAD detected user speech; frontend flushes playback
- `{ type: "error", message }` — session error

The frontend sends only binary audio; it sends no JSON.

## Background work delivered between turns

After every `turn_done` and on a 5s safety tick, the backend tries to inject one of the following as a system message (in priority order):

1. **Draft analysis** (`pendingInsights.ts`) — a long-running GPT analysis triggered once the draft reaches 10 heroes. See "Draft analysis" below.
2. **Game events** (`gameEventQueue.ts`) — batched, throttled diff of important changes: kills, deaths, level-ups, respawns, Aghs pickups, item purchases, buildings destroyed. Critical events (deaths, ally buildings) bypass the 30s throttle.
3. **Fallback status** (`gameEventQueue.ts`) — every ~2 min, if nothing else fired, a compact status snapshot (clock, score, KDA, GPM, level, items). Delivered silently (no `response.create`) so Миша has context without commenting.

## Voice tools (`src/tools/`)

Each file exports one `tool({ … })`. `src/tools/index.ts` re-exports them.

| Tool | File | Description |
|------|------|-------------|
| `get_joke` | `joke.ts` | Random joke |
| `run_analysis` | `analysis.ts` | Simulated slow analysis (3 s timeout) |
| `get_hero_info` | `heroInfo.ts` | Strengths, weaknesses, mechanics from `heroes_extend.json` |
| `list_heroes` | `heroList.ts` | Full hero list (for looking up exact names) |
| `get_draft` | `draft.ts` | Latest draft pushed by insight-app (screen-capture OCR) |
| `get_match_state` | `matchState.ts` | Latest parsed GSI state |
| `get_matchups` | `matchups.ts` | STRATZ: win rate vs every other hero (best/worst 5) |
| `get_builds` | `builds.ts` | STRATZ: starting items, boots, core items by game phase, neutrals |

## Draft analysis (`draftAnalysis.ts`)

Triggered lazily from `/push/draft`:

1. When a draft with 10 heroes arrives (and not yet analyzed), kick off a background `chat.completions` run against `gpt-5.4-mini`.
2. The model is given `get_hero_info`, `get_matchups`, `get_builds` as tools and iterates until it produces a final answer.
3. The answer is stored in `pendingInsights` → delivered on the next `turn_done` with a prompt for Миша to ask the user before sharing.
4. Reset on WS disconnect (new match).

## Other modules

| File | Role |
|------|------|
| `src/index.ts` | Express + WS server, session lifecycle, system-message injection |
| `src/agent.ts` | `RealtimeAgent` definition (voice, instructions, tool list) |
| `src/gameData.ts` | In-memory store for latest draft and game state (+ previous state) |
| `src/gameEventQueue.ts` | Event buffer, throttling, fallback-status generation |
| `src/stateDiff.ts` | `diffStates(prev, curr)` → `GameEvent[]` with Russian summaries |
| `src/pendingInsights.ts` | Single-slot queue for the next insight to inject |
| `src/draftAnalysis.ts` | Background GPT analysis with tool-use loop |
| `src/stratzApi.ts` | STRATZ GraphQL client; loads `data/stratz/{heroes,items}.json`; supports binding to a local IP via `STRATZ_LOCAL_ADDRESS` |
| `src/heroes.ts` | Loads `data/heroes_extend.json`, fuzzy hero lookup |
| `src/logger.ts` | Tees `console.log/warn/error` to `logs/backend.log` |

## Data files (`data/`)

- `heroes_extend.json` — hero notes (strengths, weaknesses, mechanics). Updated by `patch-updater`.
- `stratz/heroes.json`, `stratz/items.json` — STRATZ ID → display-name maps.
- `draft.json` — gitignored; last draft detected by `insight-app/cv/detect_draft.py`.

## Environment (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | yes | Realtime session + draft-analysis chat completions |
| `STRATZ_API_KEY` | for STRATZ tools | Authenticates the STRATZ GraphQL client |
| `STRATZ_LOCAL_ADDRESS` | no | Local IP to bind for STRATZ requests (bypass VPN) |

## Dependencies

| Package | Role |
|---------|------|
| `@openai/agents` | `RealtimeAgent`, `RealtimeSession`, `tool()` |
| `openai` | Chat completions for draft analysis |
| `express` | HTTP server (health + `/push/*`) |
| `ws` | WebSocket server mounted on Express |
| `zod` | Tool parameter schemas |
| `undici` | HTTP agent for `STRATZ_LOCAL_ADDRESS` binding |
| `dotenv` | Loads `.env` |
| `cors` | Cross-origin for the frontend dev server |

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 3000)
npm run build  # tsc → dist/
npm start      # node dist/index.js
```

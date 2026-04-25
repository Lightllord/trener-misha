# backend

WebSocket relay between the browser frontend and the OpenAI Realtime API, plus an HTTP ingest for game data pushed from `insight-app`. Architecture and rules for editors live in `backend/CLAUDE.md`.

## HTTP endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET`  | `/`            | — | Health check |
| `POST` | `/push/draft`  | `{ radiant[], dire[], confidence[], detectedAt }` | Store latest draft. Triggers `checkAndAnalyzeDraft()` |
| `POST` | `/push/state`  | `MatchState` (from insight-app) | Store latest game state; runs `diffStates` to enqueue events |

The backend never polls `insight-app`; data is pushed and held in-memory (`src/gameData.ts`).

## WebSocket protocol (frontend ↔ backend)

- **Binary frames** — raw PCM16 24 kHz audio, both directions.
- **JSON control frames (backend → frontend)**: `connected`, `transcript`, `tool_call`, `tool_result`, `interrupt`, `error`.
- Frontend sends only audio (no JSON).

After `turn_done` (and on a 5s safety tick), `tryDeliver()` injects one of: an insight (via `InsightPicker`), batched game events, or a fallback status snapshot. Details in `backend/CLAUDE.md`.

## Voice tools (`src/tools/`)

Each file exports one `tool({ … })`; `src/tools/index.ts` re-exports them.

| Tool | File | Description |
|------|------|-------------|
| `run_analysis`    | `analysis.ts`   | Simulated slow analysis (3 s timeout) |
| `get_hero_info`   | `heroInfo.ts`   | Strengths/weaknesses/mechanics from `heroes_extend.json` |
| `list_heroes`     | `heroList.ts`   | Full hero list |
| `get_draft`       | `draft.ts`      | Latest draft pushed by insight-app |
| `get_match_state` | `matchState.ts` | Latest parsed GSI state |
| `get_matchups`    | `matchups.ts`   | STRATZ: win rate vs every other hero (best/worst 5) |
| `get_builds`      | `builds.ts`     | STRATZ: starting items, boots, core items by game phase |

## Modules

| File | Role |
|------|------|
| `src/index.ts`           | HTTP + WS server, session lifecycle, `tryDeliver()` orchestration |
| `src/agent.ts`           | `RealtimeAgent` — voice, instructions, tool list |
| `src/gameData.ts`        | In-memory store for latest draft + game state |
| `src/gameEventQueue.ts`  | Event buffer, throttling, fallback-status generation |
| `src/stateDiff.ts`       | `diffStates(prev, curr)` → `GameEvent[]` |
| `src/draftAnalysis.ts`   | Background `gpt-5.4-mini` tool-use loop → produces a `draft_analysis` insight |
| `src/insight/store.ts`   | Named-insight store with per-name uniqueness + importance |
| `src/insight/picker.ts`  | `InsightPicker` class — picks what to deliver, owns background thinking, formats injections |
| `src/insight/helpers.ts` | Pure ranking + parsing helpers |
| `src/insight/markup.ts`  | XMLike rendering for picker input + injection |
| `src/conversation/log.ts`     | Rolling transcript log (`logTranscript`, `getRecentConversation`) |
| `src/conversation/markup.ts`  | `formatConversationAsXMLike()` |
| `src/xmlike/escape.ts`        | Shared `escapeXMLike()` |
| `src/stratzApi.ts`       | STRATZ GraphQL client; supports `STRATZ_LOCAL_ADDRESS` binding |
| `src/heroes.ts`          | Loads `data/heroes_extend.json` + fuzzy lookup |
| `src/logger.ts`          | Tees `console.log/warn/error` to `logs/backend.log` |

## Data (`data/`)

- `heroes_extend.json` — hero notes; updated by `patch-updater`.
- `stratz/heroes.json`, `stratz/items.json` — STRATZ ID → display-name maps.
- `draft.json` — gitignored; last draft detected by `insight-app/cv/detect_draft.py`.

## Environment (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY`       | yes              | Realtime session + draft analysis + picker |
| `STRATZ_API_KEY`       | for STRATZ tools | STRATZ GraphQL auth |
| `STRATZ_LOCAL_ADDRESS` | no               | Local IP to bind for STRATZ (bypass VPN) |

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 3000)
npm run build  # tsc → dist/
npm test       # node --test
npm start      # node dist/index.js
```

# trener-misha

Dota 2 real-time voice coaching assistant. Four subprojects:

## Project structure

```
frontend/
  index.html
  public/
    pcm-processor.js   — AudioWorklet processor (PCM16 24kHz capture)
  src/
    main.ts            — WS client + UI
    audio.ts           — mic capture + audio playback utilities
  vite.config.ts       — WS proxy to backend
backend/
  src/
    index.ts           — Express + WS server + RealtimeSession relay + insight injection
    agent.ts           — RealtimeAgent definition (Тренер Миша)
    tools/             — voice agent tools (one per file, re-exported via index.ts)
    heroes.ts          — hero data loader + fuzzy search (heroes_extend.json)
    gameData.ts        — in-memory store for draft/state pushed from insight-app
    draftAnalysis.ts   — background draft analysis (gpt-5.4-mini with tool use)
    insights.ts        — named-insight store with per-name uniqueness + importance
    insightPicker.ts   — LLM-based picker that chooses the next insight to deliver
    conversationLog.ts — rolling log of recent voice transcripts (picker context)
    types/             — shared type declarations (one file per domain)
    consts/            — shared constants (one file per domain)
insight-app/
  src/
    index.ts           — GSI listener (HTTP POST on :6074)
    draft-detector.ts  — screen capture draft detection (Python CV subprocess)
  cv/                  — Python OpenCV draft detector (spawned by draft-detector.ts)
    detect_draft.py    — screen capture + icon matching
    requirements.txt   — OpenCV, MSS, NumPy
patch-updater/
  src/
    scrape-patch.mjs   — Puppeteer scraper for dota2.com patch notes
    apply-patch-notes.mjs — Claude-powered hero notes updater
  patch-notes.json     — scraped patch data (gitignored)
docs/
  valve/               — Dota 2 GSI integration guide
```

## Conventions

- No `any` — use `unknown` + type narrowing
- Prefer native Node.js modules over third-party packages
- Keep dependencies minimal
- Types live in `<pkg>/src/types/`, constants in `<pkg>/src/consts/` — from the start, not as a later cleanup
- Tests end in `.spec.ts` and sit next to the module they cover; no test-only exports in production code

## Architecture

### Data flow

```
Dota 2 GSI → POST → insight-app (:6074) ─── POST /push/state ──→ Backend (:3000)
                      └─ DraftDetector ───── POST /push/draft ──→   (gameData store)

Frontend (:5173) ←─ WS ─→ Backend (:3000) ←─ WS ─→ OpenAI Realtime API (gpt-realtime-1.5)
                  audio+JSON               audio+events
```

insight-app pushes data to backend on every update. Backend stores it in-memory (`gameData.ts`).
Tools and draft analysis read from the local store, no polling.

### Voice conversation (realtime)

Browser ↔ Backend ↔ OpenAI. Backend is a relay with event hooks:
- Binary PCM16 24kHz audio passes through both directions untouched
- JSON control messages (backend → frontend): `connected`, `transcript`, `tool_call`, `tool_result`, `interrupt`, `error`
- Frontend → backend: audio only, no control messages
- VAD + interruption: handled server-side by OpenAI, exposed as `audio_interrupted` event

### Proactive insights (async, LLM-picked)

Insights are generic producer/consumer messages that Миша delivers when he's not talking. Each insight has a `name`, optional `number` (for non-unique types), `description`, `importance` (`low`/`medium`/`high`/`critical`), and a `payload` (the exact system text to inject). Producers call `addInsight(name, payload)`; the config for each name sets uniqueness + metadata.

Delivery loop in `index.ts:tryDeliver()`:
1. If there's a `pendingInsightPick` stashed from a prior picker run → inject it immediately, mark used.
2. Else `getUnused()`:
   - 0 insights → fall through to game-events / fallback-status path.
   - 1 insight → inject it directly (skip the picker).
   - Any `critical` insight → shortcut to `latestCritical()` (freshest critical), no model call.
   - ≥ 2 non-critical insights → call `pickInsight()` asynchronously. It sends insight metadata (name, number, description, importance, ageSeconds) **plus the last ~60 seconds of dialogue** (from `conversationLog.ts`) to `gpt-5.4-nano` with `reasoning_effort: "minimal"` and a 5s `AbortSignal.timeout`. Importance is a strong preference, not a hard rule — the model may override it if the recent dialogue points at a different insight. If parse or lookup fails, falls back to importance-then-freshness ranking.
3. When the picker resolves, if `responseActive` is still `true`, the chosen insight is stashed in `pendingInsightPick` so the next `tryDeliver` delivers it instantly.
4. `markUsed` flips only **after** a successful `injectMessage`.

Draft analysis producer (`draftAnalysis.ts`): on `POST /push/draft` → `checkAndAnalyzeDraft()` → `gpt-5.4-mini` background run → `addInsight("draft_analysis", <full system-message text>)`. The payload bakes in the "ask the player first" wrapper; delivery stays format-agnostic.

Reset on WS disconnect (new match): `pickerAbort.abort()`, `pendingInsightPick = null`, `clearInsights()`, `clearConversation()`.

## Voice agent tools

### Instant
- `get_hero_info` — detailed hero info (strengths, weaknesses, mechanics)
- `list_heroes` — all heroes in format usable with `get_hero_info`
- `get_draft` — current draft composition from screen capture
- `get_match_state` — live match state from GSI
- `get_matchups` — hero win rates vs all opponents (STRATZ API)
- `get_builds` — popular item builds by game phase (STRATZ API)

### Delayed
- `run_analysis` — simulates slow analysis (3s timeout)

## Commands

Each subproject runs independently from its own directory:

```bash
# Backend (port 3000)
cd backend && npm install && npm run dev

# Frontend (port 5173, proxies /ws → backend)
cd frontend && npm install && npm run dev

# Insight App (port 6074)
cd insight-app && npm install && npm run dev

# Patch Updater (offline tool, not a server)
cd patch-updater && npm install
npm run scrape                              # scrape patch notes from dota2.com
npm run scrape -- https://www.dota2.com/patches/7.41  # specific patch
npm run apply                               # update heroes_extend.json via Claude
npm run apply:dry                           # dry run (no writes)
npm run apply:resume                        # resume interrupted run
```

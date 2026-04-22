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
    insights.ts        — named-insight store with per-name uniqueness config
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

### Proactive draft analysis (async)

Triggered on `POST /push/draft` (insight-app push), delivered on the next `turn_done`:
1. `checkAndAnalyzeDraft()` — called from the `/push/draft` handler; reads draft from gameData; if 10 heroes picked and not yet analyzed → fire and forget
2. `analyzeInBackground()` — gpt-5.4-mini with `get_hero_info`, `get_matchups`, `get_builds` tools, reasoning_effort: medium
3. Result → `addInsight("draft_analysis", text)` in the `insights` store
4. On `turn_done` → `tryDeliver()` picks the first unused `draft_analysis` insight, injects it as a system message via `conversation.item.create` + `response.create`, and calls `markUsed`
5. Миша asks user "want to hear the analysis?" → user confirms → Миша delivers

Reset on WS disconnect (new match) via `clearInsights()`.

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

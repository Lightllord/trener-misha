# trener-misha

Dota 2 real-time voice coaching assistant. Three subprojects:

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
    draftAnalysis.ts   — background draft analysis (gpt-5.4-mini with tool use)
    pendingInsights.ts — in-memory queue for async insights → voice delivery
insight-app/
  src/
    index.ts           — GSI listener (HTTP POST on :6074)
    draft-detector.ts  — screen capture draft detection (Python CV subprocess)
docs/
  valve/               — Dota 2 GSI integration guide
```

## Conventions

- No `any` — use `unknown` + type narrowing
- Prefer native Node.js modules over third-party packages
- Keep dependencies minimal

## Architecture

### Data flow

```
Dota 2 GSI → POST → insight-app (:6074)
                      ├─ GET /state → match state (player perspective)
                      └─ GET /draft → team compositions (screen capture CV)

Frontend (:5173) ←─ WS ─→ Backend (:3000) ←─ WS ─→ OpenAI Realtime API (gpt-realtime-1.5)
                  audio+JSON               audio+events
```

### Voice conversation (realtime)

Browser ↔ Backend ↔ OpenAI. Backend is a relay with event hooks:
- Binary PCM16 24kHz audio passes through both directions untouched
- JSON control messages (backend → frontend): `connected`, `transcript`, `tool_call`, `tool_result`, `interrupt`, `error`
- Frontend → backend: audio only, no control messages
- VAD + interruption: handled server-side by OpenAI, exposed as `audio_interrupted` event

### Proactive draft analysis (async)

Triggered lazily on `turn_done` (agent finished speaking):
1. `checkAndAnalyzeDraft()` — fetches /draft from insight-app; if 10 heroes picked and not yet analyzed → fire and forget
2. `analyzeInBackground()` — gpt-5.4-mini with `get_hero_info` tool, reasoning_effort: medium
3. Result → `setPending()` in pendingInsights
4. Next `turn_done` → `takePending()` → inject as system message via `conversation.item.create` + `response.create`
5. Миша asks user "want to hear the analysis?" → user confirms → Миша delivers

Reset on WS disconnect (new match).

## Voice agent tools

### Instant
- `get_joke` — random joke
- `get_hero_info` — detailed hero info (strengths, weaknesses, mechanics)
- `list_heroes` — all heroes in format usable with `get_hero_info`
- `get_draft` — current draft composition from screen capture
- `get_match_state` — live match state from GSI

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
```

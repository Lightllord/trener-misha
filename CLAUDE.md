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
    index.ts           — Express + WS server + RealtimeSession relay
    agent.ts           — RealtimeAgent definition
    tools/             — tool definitions (one per file, re-exported via index.ts)
insight-app/
  src/
    index.ts           — GSI listener (HTTP POST on :6074)
docs/
  valve/               — Dota 2 GSI integration guide
```

## Conventions

- No `any` — use `unknown` + type narrowing
- Prefer native Node.js modules over third-party packages
- Keep dependencies minimal

## Voice agent

Single agent: Тренер Миша. Russian-speaking voice coach.
- Brief, conversational replies
- Instant tools → answer immediately
- Delayed tools → acknowledge, continue naturally, deliver result when ready

## Tools

### Instant
- `get_joke` — returns a random joke
- `get_hero_info` — detailed hero info (strengths, weaknesses, mechanics)
- `list_heroes` — list all heroes (names usable with `get_hero_info`)
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

# trener-misha

Dota 2 real-time voice coaching assistant powered by the OpenAI Realtime API.

## Architecture

```
┌──────────────┐   WebSocket    ┌──────────────┐   WebSocket    ┌──────────────┐
│   frontend   │◄──────────────►│   backend    │◄──────────────►│   OpenAI     │
│  :5173       │  PCM16 audio   │  :3000       │  RealtimeAPI   │  Realtime    │
│  Vite + TS   │  + JSON ctrl   │  Express+WS  │                │              │
└──────────────┘                └──────────────┘                └──────────────┘
                                       ▲
                                       │ POST /push/state
                                       │ POST /push/draft
                                       │
                                ┌──────────────┐
                                │ insight-app  │◄─── Dota 2 GSI POST
                                │  :6074       │
                                │  node:http   │
                                └──────────────┘
                                       │ spawn
                                       ▼
                                ┌──────────────┐
                                │ insight-app/ │
                                │   cv/        │
                                │  detect_draft.py
                                │  (OpenCV OCR)│
                                └──────────────┘
```

- **[backend/](backend/README.md)** — WS relay to OpenAI, `RealtimeAgent` + voice tools, STRATZ API client, async draft analysis, GSI event queue
- **[frontend/](frontend/README.md)** — browser audio client (AudioWorklet mic capture, PCM16 playback)
- **[insight-app/](insight-app/README.md)** — GSI listener + draft detector; parses game state and pushes updates to the backend. Contains `cv/` — the Python screen-capture draft detector it spawns as a subprocess
- **patch-updater/** — offline tool: Puppeteer scraper for dota2.com patch notes + Claude-powered hero-notes updater

## Prerequisites

- Node.js v24+ (use [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows))
- Python 3.10+ with `insight-app/cv/requirements.txt` installed (OpenCV, MSS, NumPy) — required for draft detection
- OpenAI API key with Realtime API access
- Optional: STRATZ API key — enables the `get_matchups` and `get_builds` voice tools and the background draft analysis

## Quick start

```bash
# 1. Set up environment
cp .env.example backend/.env
# Edit backend/.env — at minimum set OPENAI_API_KEY.
# Optionally add STRATZ_API_KEY (and STRATZ_LOCAL_ADDRESS to bypass a VPN).

# 2. Install & run each subproject (3 terminals)

# Terminal 1 — backend (port 3000)
cd backend && npm install && npm run dev

# Terminal 2 — frontend (port 5173, proxies /ws → backend)
cd frontend && npm install && npm run dev

# Terminal 3 — insight-app (port 6074)
cd insight-app && npm install && npm run dev
```

Open `http://localhost:5173`, click Connect, and start speaking.

## Dota 2 setup

To connect Dota 2 game state to the app, see the [GSI integration guide](docs/valve/README.md).

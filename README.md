# trener-misha

Dota 2 real-time voice coaching assistant powered by OpenAI Realtime API.

## Architecture

```
┌──────────────┐   WebSocket    ┌──────────────┐   WebSocket    ┌──────────────┐
│   frontend   │◄──────────────►│   backend    │◄──────────────►│   OpenAI     │
│  :5173       │  PCM16 audio   │  :3000       │  RealtimeAPI   │  Realtime    │
│  Vite + TS   │  + JSON ctrl   │  Express+WS  │                │              │
└──────────────┘                └──────────────┘                └──────────────┘
                                       ▲
                                       │ (future relay)
                                       │
                                ┌──────────────┐
                                │ insight-app  │◄─── Dota 2 GSI POST
                                │  :6074       │
                                │  raw HTTP    │
                                └──────────────┘
```

- **[backend/](backend/README.md)** — WS relay between browser and OpenAI, RealtimeAgent + tools
- **[frontend/](frontend/README.md)** — browser audio client (AudioWorklet mic capture, PCM16 playback)
- **[insight-app/](insight-app/README.md)** — GSI listener for Dota 2 game state

## Prerequisites

- Node.js v24+ (use [nvm](https://github.com/nvm-sh/nvm) or [nvm-windows](https://github.com/coreybutler/nvm-windows))
- OpenAI API key with Realtime API access

## Quick start

```bash
# 1. Set up environment
cp .env.example backend/.env
# Edit backend/.env — add your OPENAI_API_KEY

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

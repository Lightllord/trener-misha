# backend

WebSocket relay between the browser frontend and OpenAI Realtime API.

## Architecture

```
Frontend                        Backend                         OpenAI
   │                              │                               │
   │── binary PCM16 chunks ──►    │                               │
   │                         session.sendAudio() ────────────►    │
   │                              │                               │
   │                         on('audio') ◄───────────────────     │
   │    ◄── binary PCM16 chunks ──│                               │
   │                              │                               │
   │    ◄── JSON control msgs ────│   on('history_added')         │
   │                              │   on('agent_tool_start/end')  │
   │                              │   on('error')                 │
```

On each WebSocket connection:
1. Creates `RealtimeSession` with `RealtimeAgent` (WebSocket transport to OpenAI)
2. Connects to OpenAI using server-side API key (`session.connect()`)
3. Relays binary audio in both directions (browser ↔ OpenAI)
4. Forwards session events as JSON control messages to the frontend
5. On disconnect: closes the OpenAI session

## Transport events

| Event | Direction | Description |
|-------|-----------|-------------|
| `audio` | OpenAI → backend → frontend | PCM16 audio chunk from model response |
| `audio_interrupted` | OpenAI → backend → frontend | VAD detected user speech during response; frontend flushes playback |
| `history_added` | OpenAI → backend → frontend | Transcript of user/assistant message |
| `agent_tool_start` | OpenAI → backend → frontend | Tool execution started |
| `agent_tool_end` | OpenAI → backend → frontend | Tool execution finished with result |
| `error` | OpenAI → backend → frontend | Session error |

## WebSocket protocol (frontend ↔ backend)

**Binary messages:** raw PCM16 24kHz audio chunks (both directions)

**JSON control messages (backend → frontend):**
- `{ type: "connected" }` — OpenAI session ready
- `{ type: "transcript", role: "user" | "assistant", text }` — speech transcript
- `{ type: "tool_call", name }` — tool execution started
- `{ type: "tool_result", name, result }` — tool execution finished
- `{ type: "interrupt" }` — flush playback (VAD detected user speech)
- `{ type: "error", message }` — error

## Dependencies

| Package | Role |
|---------|------|
| `@openai/agents` | RealtimeAgent, RealtimeSession, tool definitions |
| `express` | HTTP server (health check endpoint) |
| `ws` | WebSocket server (mounted on Express) |
| `zod` | Tool parameter schemas |
| `dotenv` | Loads `.env` for `OPENAI_API_KEY` |
| `cors` | Cross-origin for frontend dev server |

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 3000)
npm run build  # tsc → dist/
npm start      # node dist/index.js
```

# backend

WebSocket relay between the browser frontend and the OpenAI Realtime API, an HTTP ingest for game data pushed from `insight-app`, and an LLM-driven insight pipeline. Coding rules for editors live in `.claude/rules/how-to-code-backend.md`.

## Setup

```bash
npm install
npm run dev    # tsx watch src/index.ts — hot reload, port 3000
npm run build  # tsc → dist/
npm start      # node dist/index.js (compiled output)
npm test       # node --test
```

Requires `.env` (see [Environment](#environment-env)). All code must compile cleanly with `npm run build`.

## Architecture

```
Dota 2 GSI ──► insight-app (:6074) ── POST /push/state ──► backend (gameData)
                  └─ DraftDetector ─┘  (draft merged into MatchState)

Frontend (:5173) ◄── WS ──► backend (:3000) ◄── WS ──► OpenAI Realtime API
                  audio + JSON              audio + events
```

The draft is part of the match state: `DraftDetector` feeds it into the insight-app `MatchStateManager`, and it ships inside `/push/state` (no separate draft endpoint). `gameData.ts` is the in-memory store for everything pushed in. Voice tools and the draft analyser read from it; nothing polls. The backend is a relay with hooks — binary PCM16 24 kHz audio passes through both directions untouched. Turn detection is **hybrid**: OpenAI's `semantic_vad` handles the normal case (speak → pause → it commits and responds), and interruption stays server-side, surfaced as `audio_interrupted`. But cutting the mic mid-speech sends no trailing silence, so VAD never fires and the turn hangs. To cover that, the client sends a `mic_close` text frame on gate close; if VAD saw real speech it never committed (`userSpeechPending`, armed by `input_audio_buffer.speech_started` and disarmed by `input_audio_buffer.committed`) the backend forces `input_audio_buffer.commit` + `response.create` and nudges the delivery window open. When VAD already committed the turn — or the key was tapped without speaking — `mic_close` is a no-op, so a bare tap never triggers a reply to silence.

## HTTP endpoints

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| `GET`  | `/`            | — | Health check |
| `POST` | `/push/state`  | `MatchState` (from insight-app, incl. `draft`) | Store latest game state; runs `diffStates` to enqueue events; triggers `checkAndAnalyzeDraft()` |

The backend never polls `insight-app`; data is pushed and held in-memory (`src/gameData.ts`).

## WebSocket protocol (frontend ↔ backend)

- **Binary frames** — raw PCM16 24 kHz audio, both directions.
- **JSON control frames (backend → frontend)**: `connected`, `transcript`, `tool_call`, `tool_result`, `interrupt`, `error`.
- Frontend sends only audio (no JSON).

## Insights pipeline

Insights are the "background analysis" channel — Миша delivers them between turns. Each insight has `name`, optional `number` (counter for non-unique kinds), `description`, `importance` (`low`/`medium`/`high`/`critical`), and `payload` (the exact system text to inject). Producers call `addInsight(name, payload)`; `INSIGHT_CONFIGS` per name sets uniqueness + metadata.

`InsightPicker` (`insight/picker.ts`) owns the "what do I deliver now?" decision. `tryDeliverInsight()` in `index.ts` asks `picker.getSomethingToDeliverNow(criticalOnly)`; if non-null, it injects `picker.formatForInjection(insight)`.

**Delivery trigger** — not `turn_done`. A single poll lane, gated on "the user isn't speaking". Two cooperating pieces in `src/deliveryWindow/`:

- **`DeliveryWindow`** — a pure observable constructed with the `RealtimeSession`. Subscribes to `turn_started` / `turn_done` / `audio_interrupted` / `transport_event` (filtering for `input_audio_buffer.speech_started/stopped`). The window is **open whenever the user is not speaking** (`isOpen()`); within it `state()` returns the concrete delivery state, layered over `isOpen()` + `deliveryBand()`:
  - `"full"` — model is also silent → deliver any insight into the pause;
  - `"interrupt"` — model is mid-response → only `critical` insights, delivered by cancelling and restarting the current output;
  - `"closed"` — user is speaking → do nothing.
  Also exposes `isResponseActive()`, `subscribe(cb)`, and setters (`setResponseActive`, `setUserSpeaking`) so callers can preempt the SDK on outgoing events. No timers, no insight awareness.
- **`DebouncedPoll`** — subscribes to the window. While open: waits 150 ms (debounce against a quick re-speak), fires once, then polls every 200 ms. It keeps polling through the model's turns (only user speech disarms it). Any close cancels both timers.

`index.ts` glue is two lines: `new DeliveryWindow(session)` and `new DebouncedPoll(dw, tryDeliverInsight)`. On each fire `tryDeliverInsight()` reads `dw.state()` for the band (only the picker's `criticalOnly` flag differs) and delivers via a single `injectMessage` — which cancels a live response first when one is in flight, so a `critical` insight barges in. Game events and fallback status keep the older path: `tryDeliver()` on `turn_done` + a 5 s safety tick, gated by `dw.isResponseActive()`.

A few constraints in here are easy to break:

- `getSomethingToDeliverNow()` marks its result used **itself** — the caller must inject immediately, there is no second chance to claim it.
- `injectMessage` cancels a live response (`response.cancel`) **before** it flips `dw.setResponseActive(true)` — that read decides whether to barge, so the order matters. The synchronous `setResponseActive(true)` then runs *before* `response.create`, so a parallel poll/event tick can't double-inject in the ms before the SDK echoes `turn_started`. Keep that ordering.
- `DebouncedPoll` has no public stop — its lifecycle is owned by the window: `DeliveryWindow.dispose()` broadcasts a final `isOpen=false` that lands in the same close-path that cancels the timers. Don't add a stop method.
- Producers own the insight payload text; the picker wraps it in `<insight-N>` for delivery but never edits it.

**Pick order** (`getSomethingToDeliverNow()`, synchronous, marks its result used itself):

1. **Critical shortcut** — `latestCritical(unused)` wins outright; background thinking is kicked over the remaining non-critical candidates so the next pick is ready.
2. **Stashed thinking result** — if the last background pick is still live and unused, return it.
3. **Single unused** — return it directly (no thinking).
4. **≥ 2 non-critical unused** — schedule thinking, return `null`.

In the `interrupt` band (`criticalOnly = true`, model mid-response) only step 1 runs: a `critical` insight is returned (and barges in), otherwise `null` — nothing else delivers and no thinking is scheduled. The set that barges into live speech is exactly `importance: "critical"`; there is no separate flag.

The thinking step (private `think()` → `gpt-5.4-nano`, `reasoning_effort: "minimal"`, `PICKER_TIMEOUT_MS`) gets only the non-critical candidates plus the last ~60 s of dialogue. Importance is a soft preference; on parse/timeout failure it falls back to importance-then-freshness.

**Lifecycle** — on WS close: `pickerAbort.abort()` cancels in-flight thinking; `deliveryWindow.dispose()` detaches transport listeners and broadcasts a final `isOpen=false`; `clearInsights()` + `clearConversation()` drop per-match state.

## Voice tools (`src/tools/`)

Each file exports one `tool({ … })`; `src/tools/index.ts` re-exports them. Tools come in two flavors — instant (synchronous data lookup) and delayed (kick off background work, return a placeholder).

| Tool | File | Source / behavior |
|------|------|-------------------|
| `get_hero_info`   | `heroInfo.ts`   | `heroes_extend.json` |
| `list_heroes`     | `heroList.ts`   | Full hero list |
| `get_match_state` | `matchState.ts` | Latest parsed GSI state, incl. the CV draft and the player's position (`playerPosition`, 1-5) |
| `set_player_position` | `setPlayerPosition.ts` | Records the player's position (1-5) in game state; asked for via the `ask_player_position` insight at draft start |
| `get_matchups`    | `matchups.ts`   | STRATZ: win rate vs every hero (best/worst 5) |
| `get_builds`      | `builds.ts`     | STRATZ: starting items, boots, core items by phase |

## Adding to the backend

**A new insight kind:**
1. Extend `InsightName` in `insight/types/insight.ts`.
2. Add an entry to `INSIGHT_CONFIGS` in `insight/consts/insights.ts` (`unique`, `description`, `importance`).
3. Producer calls `addInsight("<new_name>", <fully-formed system message>)` — the producer owns the wrapping text.

**A voice tool:** add `src/tools/<name>.ts` exporting one `tool({ … })`, re-export it from `src/tools/index.ts`, and add it to the agent's `tools` list in `src/agent.ts`.

## Modules

Non-obvious navigation only — files whose role isn't already implied by their name.

| File | Role |
|------|------|
| `src/index.ts`           | HTTP + WS server, session lifecycle, `tryDeliver()` orchestration |
| `src/agent.ts`           | `RealtimeAgent` — system instructions, voice, tool list |
| `src/gameData.ts`        | In-memory, push-only store for the latest match state (the draft is a field on it) + the agent's manual draft corrections and player-position overlays — nothing polls it |
| `src/gameEventQueue.ts`  | Event buffer + throttling + fallback-status generation |
| `src/stateDiff.ts`       | `diffStates(prev, curr)` → `GameEvent[]` |
| `src/draftAnalysis.ts`   | Background `gpt-5.4-mini` tool-use loop → produces a `draft_analysis` insight |
| `src/insight/store.ts`   | In-memory insight store keyed by name. Per-name uniqueness from `INSIGHT_CONFIGS` — unique kinds replace in place, others append with an incrementing `number`; tracks used/unused so the picker claims each item once |
| `src/insight/picker.ts`  | `InsightPicker` — picks what to deliver, owns background thinking, formats injections |
| `src/deliveryWindow/deliveryWindow.ts` | `DeliveryWindow` — observable gate over the session transport; open while the user is silent, `state()` = full/interrupt/closed |
| `src/deliveryWindow/debouncedPoll.ts`  | `DebouncedPoll` — 150 ms debounce + 200 ms poll while the window is open; no public stop (the window owns its lifecycle) |
| `src/stratzApi.ts`       | STRATZ GraphQL client; supports `STRATZ_LOCAL_ADDRESS` binding (bypass VPN) |
| `src/heroes.ts`          | Loads `heroes_extend.json` + fuzzy name lookup |
| `src/logger.ts`          | Patches `console.*` to also append to `logs/backend.log` |
| `src/observability/log.ts` | `log(scope, msg)` / `logError(...)` — tags every line with a `[scope]` |
| `src/observability/sessionLog.ts` | `attachSessionDiagnostics(session)` — narrates the full turn lifecycle (speech → commit → response started → done+status, transcription failures, rate limits) so a stall is visible by the missing step |

## Data (`data/`)

- `heroes_extend.json` — hero notes; updated by `patch-updater`.
- `stratz/heroes.json`, `stratz/items.json` — STRATZ ID → display-name maps.

## Environment (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY`       | yes              | Realtime session + draft analysis + picker |
| `STRATZ_API_KEY`       | for STRATZ tools | STRATZ GraphQL auth |
| `STRATZ_LOCAL_ADDRESS` | no               | Local IP to bind for STRATZ (bypass VPN) |

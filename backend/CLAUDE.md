# backend

Voice coach relay + game-data ingest + LLM-driven insight pipeline.
See `backend/README.md` for endpoints, modules table, env vars, and run commands.
This file is the rule-set for AI agents editing the backend.

## Architecture in one breath

```
Dota 2 GSI → POST → insight-app (:6074) ── POST /push/state ──► backend (gameData)
                      └─ DraftDetector ─── POST /push/draft ──► backend (gameData)

Frontend (:5173) ◄── WS ──► backend (:3000) ◄── WS ──► OpenAI Realtime API
                  audio + JSON              audio + events
```

`gameData.ts` is the in-memory store for everything pushed in. Voice tools and the draft analyser read from it; nothing polls.

## Voice conversation (realtime)

Backend is a relay with hooks:
- Binary PCM16 24 kHz audio passes through both directions untouched.
- JSON control messages (backend → frontend): `connected`, `transcript`, `tool_call`, `tool_result`, `interrupt`, `error`.
- Frontend → backend: audio only.
- VAD + interruption: server-side at OpenAI, exposed locally as `audio_interrupted`.

## Insights pipeline

Insights are the "background analysis" channel — Миша delivers them between turns. Each insight has `name`, optional `number` (counter for non-unique kinds), `description`, `importance` (`low`/`medium`/`high`/`critical`), and `payload` (the exact system text to inject). Producers call `addInsight(name, payload)`. The config registry per name sets uniqueness + metadata.

`InsightPicker` (in `insight/picker.ts`) owns the "what do I deliver now?" decision. `tryDeliverInsight()` in `index.ts` asks `picker.getSomethingToDeliverNow()`; if non-null, injects `picker.formatForInjection(insight)`.

The trigger for `tryDeliverInsight()` is **not** `turn_done`. It comes from two cooperating pieces in `backend/src/deliveryWindow/`:

- **`DeliveryWindow`** — a pure observable that takes the `RealtimeSession` in its constructor, subscribes to `turn_started` / `turn_done` / `audio_interrupted` / `transport_event` (filtering for `input_audio_buffer.speech_started/stopped`) on its own, and exposes `isOpen()`, `isResponseActive()`, `subscribe(cb)`, plus public setters (`setResponseActive`, `setUserSpeaking`) so callers can preempt the SDK on outgoing events. No timers, no debounce, no awareness of insights.
- **`DebouncedPoll`** — independent class. Subscribes to the window in its constructor. While the window is open: waits 300 ms (debounce against the speech_stopped → turn_started race), then fires once and polls every 3 s. Any close cancels both timers via the subscription callback. **No public stop method** — lifecycle is owned by the window: `window.dispose()` broadcasts a final `isOpen=false` to subscribers, which lands in the same close-path that cancels timers.

`index.ts` glue is two lines: `new DeliveryWindow(session)` and `new DebouncedPoll(dw, tryDeliverInsight)`. `injectMessage` synchronously calls `dw.setResponseActive(true)` before sending `response.create` so a parallel poll/event tick can't double-inject in the ms before the SDK echoes `turn_started`.

Game events and fallback status keep their old path: `tryDeliver()` runs on `turn_done` and a 5s safety tick, gated by `dw.isResponseActive()`.

`getSomethingToDeliverNow()` is synchronous and **marks the result used itself** — the caller is expected to inject immediately. Branches in order:
1. **Critical shortcut** — `latestCritical(unused)` wins outright. Background thinking is kicked over the remaining non-critical candidates so the next pick is ready.
2. **Stashed thinking result** — if the last background pick is still live and unused, return it.
3. **Single unused** — return it directly (no thinking).
4. **≥ 2 non-critical unused** — schedule thinking, return `null`.

The thinking step (private `think()` on the picker → `gpt-5.4-nano`, `reasoning_effort: "minimal"`, `PICKER_TIMEOUT_MS`) receives only non-critical candidates plus the last ~60 s of dialogue. Importance is a soft preference; the model may pick differently based on what the player and coach are currently discussing. On parse/timeout failure it falls back to importance-then-freshness.

The `protected callModel()` method wraps the OpenAI call. **Specs subclass and override it** — there is no test-only constructor parameter on the class.

### XMLike markup — nested tags only, no attributes

Both the picker prompt and the voice-model injection are wrapped in `<insight-N>` blocks with nested `<name>`, `<importance>`, `<description>`, `<payload>`, `<note>` (and `<number>`, `<age-seconds>` for picker input). **Don't add attributes** — the system prompt teaches the model to read by tag name only. The shared escape lives in `xmlike/escape.ts`.

`N` in injection tags is a per-connection counter (`InsightPicker.injectionCounter`); in picker input it is the array index. Different roles, same tag family for attention.

### Lifecycle

On WS close: `pickerAbort.abort()` cancels in-flight thinking; `deliveryWindow.dispose()` detaches transport listeners and broadcasts a final `isOpen=false` (any `DebouncedPoll` subscribed cancels its timers via the normal close path); `clearInsights()` + `clearConversation()` drop per-match state. The picker, poll, and window instances are garbage-collected with the WS handler scope.

## Adding a new insight kind

1. Extend `InsightName` in `insight/types/insight.ts`.
2. Add an entry to `INSIGHT_CONFIGS` in `insight/consts/insights.ts` with `unique`, `description`, `importance`.
3. Producer calls `addInsight("<new_name>", <fully-formed system message>)`. The producer owns the wrapping text; the picker wraps it in `<insight-N>` for delivery but does not edit the payload.

## Adding a voice tool

`src/tools/<name>.ts` exports a single `tool({ … })`. Register it via `src/tools/index.ts` re-export and add it to the agent's `tools` list in `src/agent.ts`. Tools live in two flavors — instant (synchronous data lookup) and delayed (kick off background work, return placeholder). See `backend/README.md` for the current set.

## File organization recap

- One class **or** module-level functions per file; never mix.
- Pure helpers separate from the class that uses them (e.g. `insight/helpers.ts` vs `insight/picker.ts`).
- Markup/rendering separate from logic (e.g. `insight/markup.ts`, `conversation/markup.ts`).
- Generic infrastructure (e.g. `deliveryWindow/`) lives outside `insight/` — does not depend on the insight domain. Domain-specific scheduling (debounce + poll) is a separate file from the observable.
- Types in `<folder>/types/`, constants in `<folder>/consts/`. Same convention applies inside subfolders.
- Tests beside the source, `*.spec.ts`. The picker spec subclasses `InsightPicker` to stub `callModel`. `DeliveryWindow` is tested with a fake transport; `debouncedPoll` with `mock.timers`.

# insight-app

Local process that runs on the player's machine. Two jobs:

1. Listen for Dota 2 Game State Integration (GSI) HTTP POSTs on `:6074`, parse them into a structured `MatchState`, and push the snapshot to the backend (`POST /push/state`).
2. Spawn the Python draft detector (`cv/detect_draft.py`) during hero selection; detected picks are merged into the `MatchState` and shipped with the same `POST /push/state` (no separate draft endpoint).

## Architecture

Raw `node:http` server (no framework) on port 6074.

```
Dota 2 ──POST JSON──► insight-app (:6074)
                           │
                           │ MatchStateManager.update(raw)
                           │   - tracks matchid, resets state on new match
                           │   - derives phase from game_state
                           │   - parses player, hero, abilities, inventory
                           │   - reconstructs buildings from minimap + GSI
                           │
                           │ On phase change → hero_selection:
                           │   spawn `python cv/detect_draft.py --watch`
                           │   stdout = JSON lines { radiant, dire, confidence }
                           │   → MatchStateManager.setDraft(draft)
                           │
                           └── POST /push/state ──► backend (:3000)
                               (draft included in MatchState)
```

If the backend is down, pushes are logged once and silently skipped — nothing is buffered. A recovery message is printed when pushes start succeeding again.

## Match state parsing (`match-state.ts`)

- `MatchStateManager.update(raw)` is called on every GSI packet.
- Resets on new `matchid` or empty packet (between matches).
- Derives `phase` from `DOTA_GAMERULES_STATE_*` (hero_selection / strategy / loading / pre_game / playing / post_game).
- Parses player stats, hero (status, Aghs, talents, buybacks), abilities, inventory (main / stash / teleport / neutral + component).
- Buildings are reconstructed across updates: once a structure is seen on the minimap, it stays in `allyBuildings` / `enemyBuildings` with `destroyed: true` after it disappears. HP/%HP comes from the GSI `buildings` section (ally only; enemy HP is not reported by GSI).
- `onPhaseChange((newPhase, prevPhase) => …)` — wiring point used by `index.ts` to start the draft detector.

## Draft detector (`draft-detector.ts`)

- Wraps a Python subprocess: `python -u cv/detect_draft.py --watch --monitor <n>`.
- Reads JSON lines from stdout, validates the shape, stamps `detectedAt`.
- Notifies listeners via `onDraftChange(listener)`; `index.ts` records the draft on `MatchStateManager.setDraft()`, so it ships inside `MatchState` via `/push/state` (no separate draft endpoint or file).
- `reset()` stops the process and drops the in-memory draft (called on post_game → hero_selection).

## Files

| File | Role |
|------|------|
| `src/index.ts` | HTTP server, backend push with failure tracking, phase-change wiring |
| `src/match-state.ts` | GSI → structured `MatchState` parser, minimap building tracking |
| `src/draft-detector.ts` | Python CV subprocess lifecycle + stdout parsing |
| `src/types.ts` | `MatchState`, `GamePhase`, and raw GSI payload types |
| `src/logger.ts` | Tees `console.log/warn/error` to `logs/insight-app.log` |
| `cv/` | Python screen-capture draft detector (OpenCV + MSS). Spawned as a subprocess by `draft-detector.ts`. See [Python setup](#python-setup) below. |
| `src/python-runtime.ts` | Resolves the project-local Python interpreter (`.venv` → system fallback) and probes its version on startup |
| `pyproject.toml`, `uv.lock`, `.python-version` | Python dep manifest, lockfile, pinned interpreter version. `uv sync` materialises `.venv/`. |

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 6074)
npm run build  # tsc → dist/
npm start      # node dist/index.js
```

For GSI setup instructions, see [docs/valve/README.md](../docs/valve/README.md).

## Python setup

The draft detector is a Python subprocess. Python deps live in [`uv`](https://docs.astral.sh/uv/)-managed project files: `pyproject.toml` declares dependencies, `uv.lock` pins exact versions, `.python-version` pins the interpreter (3.13). All three are committed; the `.venv/` itself is not.

One-time setup (any machine):

```bash
cd insight-app
uv sync
```

`uv sync` reads the lockfile, downloads the pinned Python if missing, creates `.venv/`, installs deps. Idempotent — safe to re-run.

Install `uv` itself if needed: `winget install astral-sh.uv` (Windows) or see https://docs.astral.sh/uv/getting-started/install/.

On `npm run dev` the pre-flight resolves Python (venv first, then system `python`), reads its version, and logs a `[preflight]` line. If no Python is found at all, it warns. Module-level dep failures surface from the detector subprocess itself, not from the pre-flight.

# insight-app

Local process that runs on the player's machine. Two jobs:

1. Listen for Dota 2 Game State Integration (GSI) HTTP POSTs on `:6074`, parse them into a structured `MatchState`, and push the snapshot to the backend (`POST /push/state`).
2. Spawn the Python draft detector (`cv/detect_draft.py`) when the game enters the `pre_game` phase and push detected picks to the backend (`POST /push/draft`).

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
                           ├── POST /push/state ──► backend (:3000)
                           │
                           │ On phase change → pre_game:
                           │   spawn `python cv/detect_draft.py --watch`
                           │   stdout = JSON lines { radiant, dire, confidence }
                           │
                           └── POST /push/draft ──► backend (:3000)
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
- Persists to `backend/data/draft.json` and notifies listeners via `onDraftChange(listener)`.
- `reset()` stops the process and deletes the draft file (called on post_game → hero_selection).

## Files

| File | Role |
|------|------|
| `src/index.ts` | HTTP server, backend push with failure tracking, phase-change wiring |
| `src/match-state.ts` | GSI → structured `MatchState` parser, minimap building tracking |
| `src/draft-detector.ts` | Python CV subprocess lifecycle + stdout parsing |
| `src/types.ts` | `MatchState`, `GamePhase`, and raw GSI payload types |
| `src/logger.ts` | Tees `console.log/warn/error` to `logs/insight-app.log` |

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 6074)
npm run build  # tsc → dist/
npm start      # node dist/index.js
```

For GSI setup instructions, see [docs/valve/README.md](../docs/valve/README.md).

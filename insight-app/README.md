# insight-app

Local application running on the player's machine. Listens for Dota 2 Game State Integration (GSI) events.

## Architecture

Minimal HTTP server (raw `node:http`, no frameworks) on port 6074.

```
Dota 2 ──POST JSON──► insight-app (:6074)
                            │
                            ├── logs game state to console
                            └── (future) relay to backend
```

Dota 2 sends POST requests with JSON payloads containing game state snapshots (hero, items, map, abilities, etc.) on every state change during a match.

## GSI data format

Each POST body is a JSON object. Key top-level sections:

| Section | Content |
|---------|---------|
| `map` | Game time, game state, win team, clock |
| `player` | Gold, kills, deaths, assists, hero |
| `hero` | Health, mana, level, abilities, items |
| `abilities` | Ability levels and cooldowns |
| `items` | Inventory and backpack contents |
| `previously` | Previous values of changed fields |

For GSI setup instructions, see [docs/valve/README.md](../docs/valve/README.md).

## Future

- Relay normalized game state to the backend via WebSocket
- Backend feeds game context into the voice agent for real-time coaching

## Commands

```bash
npm run dev    # tsx watch src/index.ts (port 6074)
npm run build  # tsc → dist/
npm start      # node dist/index.js
```

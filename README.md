# trener-misha

Dota 2 coaching assistant that receives real-time game state via [Game State Integration (GSI)](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration) and provides coaching feedback.

## Quick start

```bash
npm install
npm run dev
```

The server starts on `http://localhost:6074`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |

## Dota 2 setup

To connect Dota 2 to the server, see the [GSI integration guide](docs/valve/README.md).

## Documentation

See [docs/](docs/README.md) for full documentation index.

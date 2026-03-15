# Dota 2 Game State Integration (GSI)

GSI is a Valve feature that sends real-time game state data to a local HTTP endpoint.

## Config file setup

1. Copy the example config to your Dota 2 cfg directory:

   ```
   <Steam>/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration_trener_misha.cfg
   ```

   The source file is [`gamestate_integration_trener_misha.cfg.example`](../../gamestate_integration_trener_misha.cfg.example) in the project root. Remove the `.example` suffix when copying.

2. Restart Dota 2 if it was already running.

## Config fields

| Field | Value | Description |
|-------|-------|-------------|
| `uri` | `http://localhost:6074` | Where Dota 2 sends game state data |
| `timeout` | `5.0` | HTTP request timeout in seconds |
| `buffer` | `0.5` | Minimum interval between updates (seconds) |
| `throttle` | `0.5` | Additional delay when data hasn't changed (seconds) |
| `heartbeat` | `30.0` | Interval for heartbeat updates when idle (seconds) |
| `data` | `provider`, `map`, `player`, `hero`, `abilities`, `items` | Which data sections to include (`1` = enabled) |

## Launch options

No special Dota 2 launch options are required for GSI. Optionally add `-console` to enable the in-game console for debugging.

## Verify it works

1. Start the dev server:
   ```bash
   npm run dev
   ```
2. Launch Dota 2 and start a bot match.
3. Watch the server logs — you should see incoming game state updates.

# trener-misha

Dota 2 coaching assistant. Receives real-time game state via Dota 2 Game State Integration (GSI) over HTTP.

## Stack
- Node.js + TypeScript (strict)
- Native `node:http` server on port 6074
- tsx for dev (hot reload)

## Conventions
- No `any` — use `unknown` + type narrowing
- Prefer native Node.js modules over third-party packages
- Keep dependencies minimal

## Commands
- `npm run dev` — dev server with hot reload
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output

## Project structure
- `src/` — source code
- `src/index.ts` — HTTP server entry point
- `docs/` — project documentation
- `docs/valve/` — Dota 2 GSI integration guide
- `gamestate_integration_trener_misha.cfg.example` — Dota 2 GSI config example (copy to Dota 2 cfg directory)
- `.opencode/agents/` — OpenCode agent configs

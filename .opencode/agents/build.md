# Build Agent — trener-misha

## Project
Dota 2 coaching assistant powered by Game State Integration (GSI). Receives real-time game data via HTTP POST on port 6074, processes it, and provides coaching insights.

## Stack
- **Runtime:** Node.js
- **Language:** TypeScript (strict mode)
- **Runner:** tsx (dev with hot reload via `tsx watch`)
- **Build:** tsc → `dist/`

## Best Practices
- TypeScript strict — no `any`, no type assertions unless absolutely necessary
- Prefer native Node.js modules (`node:http`, `node:fs`, etc.) over third-party dependencies
- Keep dependencies minimal
- Use `unknown` + type narrowing instead of `any`
- All new code must compile cleanly with `npm run build`

## Commands
- `npm run dev` — start dev server with hot reload
- `npm run build` — compile TypeScript
- `npm start` — run compiled output

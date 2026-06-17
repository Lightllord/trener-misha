# trener-misha

Real-time voice coaching assistant. See [README.md](README.md) for the project pitch, prerequisites, and how to run.

This file is the canonical, agent-agnostic rule-set (Claude Code reads it via `CLAUDE.md` → `@AGENTS.md`; opencode/Codex/Cursor read `AGENTS.md` natively).

## Layout

Loosely-coupled subprojects, each with its own `package.json` (or none, for the Python piece):

- `backend/` — WS relay to the OpenAI Realtime API + HTTP ingest for game data + insight pipeline. **Backend coding rules live in `.claude/rules/how-to-code-backend.md`.**
- `frontend/` — browser audio client (Vite + TS).
- `insight-app/` — local GSI listener and Python draft detector (CV-based).
- `patch-updater/` — offline tool that scrapes patch notes and updates hero data.
- `docs/` — long-form docs (e.g. Valve GSI integration guide).

If a subproject grows its own conventions, add a per-area rule under `.claude/rules/` rather than bloating this file.

## Conventions (apply everywhere)

- No `any` — use `unknown` + type narrowing.
- Prefer native Node.js modules over third-party packages.
- Keep dependencies minimal.
- Types in `<pkg>/src/types/`, constants in `<pkg>/src/consts/` — from the start, not as a later cleanup. Inside a folder, mirror the structure (e.g. `insight/types/picker.ts`).
- Tests end in `.spec.ts` and sit next to the module they cover. **No test-only exports in production code** — tests subclass to override `protected` methods or directly mutate exported state when needed.
- Soft cap of 300 lines per file. Split by concern when approaching it.
- Default to writing no comments. Only add one when the WHY is non-obvious — a hidden constraint, a subtle invariant, or a workaround. Identifier names should carry the WHAT.
- One class **or** module-level functions per file; do not mix orchestration logic with pure helpers in the same file.

## Where to put docs

| Audience | Location |
|---|---|
| Project pitch, prerequisites, quick start | `README.md` (root) |
| Subproject usage, endpoints, modules table | `<pkg>/README.md` |
| Cross-cutting conventions, monorepo layout | this file (`AGENTS.md`) |
| Per-area coding rules for AI agents | `.claude/rules/<name>.md` with a `paths:` front-matter so it loads only when working in that area |

When refactoring: update prose **and** any code-level comments that lose accuracy. If you move a module, update the subproject README and the relevant rule file.

## Commands

Each subproject runs independently from its own directory:

```bash
cd backend && npm install && npm run dev      # port 3000
cd frontend && npm install && npm run dev     # port 5173 (proxies /ws → backend)
cd insight-app && npm install && npm run dev  # port 6074

# patch-updater is an offline tool, not a server — see patch-updater/README.md
```

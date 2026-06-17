---
paths:
  - "backend/**"
---

# How to code the backend

<purpose>
Evergreen guidance for writing backend code — principles, invariants, checklist, examples. The backend is a WS relay to the OpenAI Realtime API + an HTTP game-data ingest + an LLM-driven insight pipeline. For the map (architecture, endpoints, pipeline mechanics, modules, env, run commands) read `backend/README.md`.
</purpose>

## Conventions

<conventions>
- Strict TypeScript. New code must compile cleanly with `npm run build` (`tsc → dist/`).
- One class **or** module-level functions per file — never both. Pure helpers live apart from the class that uses them; markup/rendering lives apart from logic.
- Generic infrastructure stays domain-agnostic: `deliveryWindow/` must not import from `insight/`.
- No test-only exports or constructor params in production code. Specs subclass and override `protected` methods (see the example with id="3").
- Treat every external payload (GSI, STRATZ) as `unknown` and narrow it explicitly before use.
</conventions>

## Review checklist

<checklist>
<element id="1">**Types** — no `any`, no unsafe assertions; `unknown` narrowed explicitly.</element>
<element id="2">**Security** — external input (GSI/STRATZ) validated; no `eval`/`Function`; no prototype-pollution vectors.</element>
<element id="3">**Performance** — no needless allocations in the request hot path; no sync I/O in an async context.</element>
<element id="4">**Error handling** — every async path catches; an HTTP response is always sent (no hanging request).</element>
<element id="5">**Style** — consistent naming, no dead or commented-out code.</element>
</checklist>

## Examples

<examples>
<example id="1">
HTTP handler — validate, then always respond:

```ts
// BAD — throws on a bad payload before responding; the request hangs
app.post("/push/state", (req, res) => {
  const state = parseState(req.body);   // may throw
  store.set(state);
  res.sendStatus(204);
});

// GOOD
app.post("/push/state", (req, res) => {
  const state = parseState(req.body);
  if (!state) return res.status(400).json({ error: "bad state" });
  store.set(state);
  res.sendStatus(204);
});
```
</example>

<example id="2">
No `any` — narrow `unknown`:

```ts
// BAD
const heroName = (raw: any) => raw.localized_name;

// GOOD
function heroName(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const name = (raw as Record<string, unknown>).localized_name;
  return typeof name === "string" ? name : null;
}
```
</example>

<example id="3">
No test-only seam — subclass to override `protected`:

```ts
// BAD — test plumbing leaks into the production constructor
export class InsightPicker {
  constructor(private callModelForTests?: ModelFn) {}
}

// GOOD — the real method is protected; the spec subclasses it
export class InsightPicker {
  protected async callModel(input: string): Promise<string> { /* OpenAI call */ }
}

// picker.spec.ts
class StubPicker extends InsightPicker {
  protected async callModel() { return '{"index":0}'; }
}
```
</example>

</examples>

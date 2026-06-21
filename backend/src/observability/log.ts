// Thin facade over console so every line carries a consistent `[scope]` tag.
// Output still flows through the console patched in logger.ts, so it lands in
// both the terminal and logs/backend.log.
export function log(scope: string, msg: string): void {
  console.log(`[${scope}] ${msg}`);
}

export function logError(scope: string, msg: string, err?: unknown): void {
  if (err === undefined) console.error(`[${scope}] ${msg}`);
  else console.error(`[${scope}] ${msg}`, err);
}

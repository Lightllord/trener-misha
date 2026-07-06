import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";

// Two file sinks mirror everything that goes through console:
//   logs/backend.log        — persistent, compact, appended across all runs.
//   .temp/logs/<stamp>.log  — fresh per process start, verbose. Objects/Errors
//                             are inspected (stack traces, nested fields) instead
//                             of JSON.stringify'd, so an Error is never "{}" and
//                             an object is never "[object Object]".
const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "backend.log");

const SESSION_DIR = join(process.cwd(), ".temp", "logs");
const SESSION_FILE = join(SESSION_DIR, `session-${fileStamp()}.log`);

// 2026-07-07T14-30-05 — filesystem-safe (no colons) and sorts chronologically.
function fileStamp(): string {
  return new Date().toISOString().replace(/:/g, "-").split(".")[0]!;
}

let dirsReady: Promise<unknown> | null = null;
function ensureDirs(): Promise<unknown> {
  if (!dirsReady) {
    dirsReady = Promise.all([
      mkdir(LOG_DIR, { recursive: true }),
      mkdir(SESSION_DIR, { recursive: true }),
    ]);
  }
  return dirsReady;
}

function timestamp(): string {
  return new Date().toISOString();
}

// Compact, console-parity rendering for backend.log.
function compact(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return inspect(a);
  }
}

// Full-fidelity rendering for the session file — inspect keeps Error stacks and
// expands nested objects.
function verbose(a: unknown): string {
  return typeof a === "string" ? a : inspect(a, { depth: 6, breakLength: 120 });
}

function writeLine(level: string, args: unknown[]): void {
  const ts = timestamp();
  const compactLine = `${ts} [${level}] ${args.map(compact).join(" ")}\n`;
  const verboseLine = `${ts} [${level}] ${args.map(verbose).join(" ")}\n`;
  ensureDirs()
    .then(() =>
      Promise.all([appendFile(LOG_FILE, compactLine), appendFile(SESSION_FILE, verboseLine)]),
    )
    .catch(() => {});
}

const originalLog = console.log.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  originalLog(...args);
  writeLine("INFO", args);
};

console.warn = (...args: unknown[]) => {
  originalWarn(...args);
  writeLine("WARN", args);
};

console.error = (...args: unknown[]) => {
  originalError(...args);
  writeLine("ERROR", args);
};

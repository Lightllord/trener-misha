import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "backend.log");

let ready = false;

async function ensureDir(): Promise<void> {
  if (ready) return;
  await mkdir(LOG_DIR, { recursive: true });
  ready = true;
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeLine(level: string, args: unknown[]): void {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  const line = `${timestamp()} [${level}] ${msg}\n`;
  ensureDir().then(() => appendFile(LOG_FILE, line)).catch(() => {});
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

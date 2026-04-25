import { MAX_LOG_ENTRIES } from "./consts/log.js";
import type {
  ConversationEntry,
  ConversationRole,
} from "./types/log.js";

let log: ConversationEntry[] = [];

export function logTranscript(
  role: ConversationRole,
  text: string,
  nowMs: number = Date.now(),
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  log.push({ role, text: trimmed, at: nowMs });
  if (log.length > MAX_LOG_ENTRIES) {
    log = log.slice(-MAX_LOG_ENTRIES);
  }
}

export function getRecentConversation(
  windowMs: number,
  nowMs: number = Date.now(),
): ConversationEntry[] {
  const cutoff = nowMs - windowMs;
  return log.filter((e) => e.at >= cutoff);
}

export function getAllConversation(): readonly ConversationEntry[] {
  return log;
}

export function clearConversation(): void {
  log = [];
}

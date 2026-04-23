import { MAX_LOG_ENTRIES } from "./consts/conversationLog.js";
import type {
  ConversationEntry,
  ConversationRole,
} from "./types/conversationLog.js";

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

export function formatConversationForPrompt(
  entries: readonly ConversationEntry[],
): string {
  if (entries.length === 0) return "(no recent dialogue)";
  return entries
    .map((e) => `${e.role === "user" ? "Player" : "Coach"}: ${e.text}`)
    .join("\n");
}

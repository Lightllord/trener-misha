import { escapeXMLike } from "../xmlike/escape.js";
import type { ConversationEntry } from "./types/log.js";

export function formatConversationAsXMLike(
  entries: readonly ConversationEntry[],
): string {
  if (entries.length === 0) {
    return "<message-history></message-history>";
  }
  const lines = entries.map((entry) => {
    const from = entry.role === "user" ? "Player" : "Coach";
    return `<message><from>${from}</from><text>${escapeXMLike(entry.text)}</text></message>`;
  });
  return ["<message-history>", ...lines, "</message-history>"].join("\n");
}

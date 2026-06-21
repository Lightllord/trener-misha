import type { InsightImportance } from "../types/insight.js";

export const PICKER_MODEL = "gpt-5.4-nano";

// Dispatch is a fast JSON classification — keep reasoning light. ("minimal" is
// rejected by gpt-5.4-nano; valid values are none/low/medium/high/xhigh.)
export const PICKER_REASONING_EFFORT = "low";

export const PICKER_TIMEOUT_MS = 10_000;

export const IMPORTANCE_RANK: Record<InsightImportance, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const PICKER_SYSTEM_PROMPT = [
  "You are the dispatch step of a Dota 2 voice coach. You pick which unused coaching insight should be delivered to the player right now.",
  "You receive:",
  "- <unused-insights>: the candidates. Each one is wrapped in <insight-N>...</insight-N> and contains <name>, <number>, <importance>, <age-seconds>, <description> as nested tags.",
  "- <message-history>: the last minute of voice dialogue, with <message><from>...</from><text>...</text></message> entries.",
  "",
  "Guidelines (in decreasing priority):",
  "1. If the recent dialogue clearly calls for one of the candidates, pick that one even if another has higher importance.",
  "2. Otherwise, use importance as a strong preference: critical > high > medium > low.",
  "3. On ties, prefer the freshest (lower age-seconds).",
  "",
  'Return a JSON object of the exact shape {"index": N}, where N is the numeric suffix of the chosen <insight-N> tag. No prose.',
].join("\n");

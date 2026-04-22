import OpenAI from "openai";
import type {
  Insight,
  InsightImportance,
  InsightName,
} from "./types/insight.js";

export interface PickerSummaryItem {
  name: InsightName;
  number: number | null;
  description: string;
  importance: InsightImportance;
  ageSeconds: number;
}

export type ModelChooser = (args: {
  system: string;
  user: string;
  signal?: AbortSignal;
}) => Promise<string>;

const SYSTEM_PROMPT = [
  "You choose which unused coaching insight to deliver to a Dota 2 player right now.",
  "You will receive a JSON array; each entry has: name, number, description, importance, ageSeconds.",
  "Rules:",
  "1. Higher importance wins (critical > high > medium > low).",
  "2. On ties, prefer the freshest (lower ageSeconds).",
  "3. Return the chosen insight as a JSON object: {\"name\": \"<name>\", \"number\": <int or null>}.",
  "Respond with ONLY that JSON object. No prose.",
].join("\n");

const IMPORTANCE_RANK: Record<InsightImportance, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function summarizeForPicker(
  unused: readonly Insight[],
  nowMs: number,
): PickerSummaryItem[] {
  return unused.map((i) => ({
    name: i.name,
    number: i.number,
    description: i.description,
    importance: i.importance,
    ageSeconds: Math.max(0, Math.round((nowMs - i.createdAt) / 1000)),
  }));
}

export function importanceFallback(
  unused: readonly Insight[],
): Insight | null {
  if (unused.length === 0) return null;
  return [...unused].sort((a, b) => {
    const byImportance = IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance];
    if (byImportance !== 0) return byImportance;
    return b.createdAt - a.createdAt;
  })[0] ?? null;
}

export function resolvePick(
  raw: string,
  unused: readonly Insight[],
): Insight | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const rec = parsed as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : null;
  if (!name) return null;

  const rawNumber = rec.number;
  const number: number | null =
    rawNumber === null || rawNumber === undefined
      ? null
      : typeof rawNumber === "number" && Number.isInteger(rawNumber)
      ? rawNumber
      : null;

  return (
    unused.find((i) => i.name === name && i.number === number) ?? null
  );
}

let cachedOpenAI: OpenAI | null = null;
function getDefaultOpenAI(): OpenAI {
  if (!cachedOpenAI) cachedOpenAI = new OpenAI();
  return cachedOpenAI;
}

const defaultChooser: ModelChooser = async ({ system, user, signal }) => {
  const openai = getDefaultOpenAI();
  const res = await openai.chat.completions.create(
    {
      model: "gpt-5.4-nano",
      reasoning_effort: "minimal",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { signal },
  );
  return res.choices[0]?.message?.content ?? "";
};

export interface PickInsightDeps {
  chooser?: ModelChooser;
  signal?: AbortSignal;
  now?: () => number;
}

export async function pickInsight(
  unused: readonly Insight[],
  deps: PickInsightDeps = {},
): Promise<Insight | null> {
  if (unused.length === 0) return null;
  if (unused.length === 1) return unused[0] ?? null;

  const chooser = deps.chooser ?? defaultChooser;
  const now = deps.now ?? Date.now;

  const summary = summarizeForPicker(unused, now());
  const userMsg = JSON.stringify(summary);

  try {
    const internal = AbortSignal.timeout(5_000);
    const signal = deps.signal
      ? AbortSignal.any([internal, deps.signal])
      : internal;

    const raw = await chooser({ system: SYSTEM_PROMPT, user: userMsg, signal });
    const pick = resolvePick(raw, unused);
    return pick ?? importanceFallback(unused);
  } catch (err) {
    console.error("[insightPicker] model call failed:", err);
    return importanceFallback(unused);
  }
}

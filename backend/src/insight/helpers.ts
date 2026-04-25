import { IMPORTANCE_RANK } from "./consts/picker.js";
import type { Insight } from "./types/insight.js";
import type { PickerSummaryItem } from "./types/picker.js";

export function summarizeForPicker(
  unused: readonly Insight[],
  nowMs: number,
): PickerSummaryItem[] {
  return unused.map((insight, index) => ({
    index,
    name: insight.name,
    number: insight.number,
    description: insight.description,
    importance: insight.importance,
    ageSeconds: Math.max(0, Math.round((nowMs - insight.createdAt) / 1000)),
  }));
}

export function importanceFallback(
  unused: readonly Insight[],
): Insight | null {
  if (unused.length === 0) {
    return null;
  }
  return [...unused].sort((a, b) => {
    const byImportance =
      IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance];
    if (byImportance !== 0) {
      return byImportance;
    }
    return b.createdAt - a.createdAt;
  })[0] ?? null;
}

export function latestCritical(unused: readonly Insight[]): Insight | null {
  let best: Insight | null = null;
  for (const insight of unused) {
    if (insight.importance !== "critical") {
      continue;
    }
    if (best === null || insight.createdAt > best.createdAt) {
      best = insight;
    }
  }
  return best;
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
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const rec = parsed as Record<string, unknown>;

  // Prompted shape is {"index": N}; the {name, number} branch is a safety net
  // for hallucinated formats — both are still ranked by importanceFallback if
  // neither resolves.
  const rawIndex = rec.index;
  if (typeof rawIndex === "number" && Number.isInteger(rawIndex)) {
    const candidate = unused[rawIndex];
    if (candidate !== undefined) {
      return candidate;
    }
  }

  const rawName = rec.name;
  if (typeof rawName === "string") {
    const rawNumber = rec.number;
    const number: number | null =
      rawNumber === null || rawNumber === undefined
        ? null
        : typeof rawNumber === "number" && Number.isInteger(rawNumber)
        ? rawNumber
        : null;
    return (
      unused.find((i) => i.name === rawName && i.number === number) ?? null
    );
  }

  return null;
}

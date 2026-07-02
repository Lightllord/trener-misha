import { log } from "../observability/log.js";
import { INSIGHT_CONFIGS } from "./consts/insights.js";
import type {
  Insight,
  InsightConfig,
  InsightName,
} from "./types/insight.js";

let insights: Insight[] = [];
const counters = new Map<InsightName, number>();

function isExpired(insight: Insight): boolean {
  return Date.now() > insight.createdAt + insight.ttlMs;
}

function getConfig(name: InsightName): InsightConfig {
  const config = INSIGHT_CONFIGS[name];
  if (!config) {
    throw new Error(`Unknown insight name: ${String(name)}`);
  }
  return config;
}

export function addInsight(name: InsightName, payload: string): Insight | null {
  const config = getConfig(name);

  if (config.unique && insights.some((i) => i.name === name && !i.used && !isExpired(i))) {
    return null;
  }

  let number: number | null = null;
  if (!config.unique) {
    const next = (counters.get(name) ?? 0) + 1;
    counters.set(name, next);
    number = next;
  }

  const insight: Insight = {
    name,
    used: false,
    unique: config.unique,
    number,
    payload,
    description: config.description,
    importance: config.importance,
    ttlMs: config.ttlMs,
    createdAt: Date.now(),
  };
  log("insight", `PUSHED: ${insight.name}: ${insight.importance}: ${insight.description}`);
  insights.push(insight);
  return insight;
}

export function getLatest(): Insight | null {
  for (let i = insights.length - 1; i >= 0; i--) {
    const candidate = insights[i];
    if (candidate && !isExpired(candidate)) return candidate;
  }
  return null;
}

export function getLatestUnused(): Insight | null {
  for (let i = insights.length - 1; i >= 0; i--) {
    const candidate = insights[i];
    if (candidate && !candidate.used && !isExpired(candidate)) return candidate;
  }
  return null;
}

export function getAllInsights(): readonly Insight[] {
  return insights.filter((i) => !isExpired(i));
}

export function getUnused(): Insight[] {
  return insights.filter((i) => !i.used && !isExpired(i));
}

export function getByName(name: InsightName): Insight[] {
  return insights.filter((i) => i.name === name && !isExpired(i));
}

export function getLatestUnusedByName(name: InsightName): Insight | null {
  for (let i = insights.length - 1; i >= 0; i--) {
    const candidate = insights[i];
    if (candidate && candidate.name === name && !candidate.used && !isExpired(candidate)) return candidate;
  }
  return null;
}

export function getByNameAndNumber(
  name: InsightName,
  number: number | null,
): Insight | null {
  return insights.find((i) => i.name === name && i.number === number && !isExpired(i)) ?? null;
}

export function markUsed(insight: Insight): void {
  insight.used = true;
}

export function clearInsights(): void {
  insights = [];
  counters.clear();
}

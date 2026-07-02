import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GuideData, GuideEntry } from "./types/guide.js";

let guideData: GuideData | null = null;

async function loadGuides(): Promise<GuideData> {
  if (guideData !== null) {
    return guideData;
  }

  const dataPath = join(__dirname, "..", "data", "guides.json");

  try {
    const raw = await readFile(dataPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid guide data format: expected an array");
    }

    guideData = parsed.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`Invalid guide at index ${index}: expected object`);
      }

      const entry = item as Record<string, unknown>;

      if (
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        typeof entry.description !== "string" ||
        typeof entry.voiceText !== "string" ||
        (entry.agentComment !== null && typeof entry.agentComment !== "string")
      ) {
        throw new Error(`Invalid guide at index ${index}: missing required fields`);
      }

      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        voiceText: entry.voiceText,
        agentComment: entry.agentComment,
      } satisfies GuideEntry;
    });

    return guideData;
  } catch (error) {
    console.error("[guides] Failed to load guide data:", error);
    throw error;
  }
}

export async function getAllGuides(): Promise<GuideData> {
  return loadGuides();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((w) => w.length >= 3);
}

function wordsMatch(a: string, b: string): boolean {
  const stem = Math.min(a.length, b.length, 5);
  return a.slice(0, stem) === b.slice(0, stem);
}

function score(queryWords: string[], entry: GuideEntry): number {
  const entryWords = tokenize(`${entry.name} ${entry.description}`);
  let hits = 0;
  for (const q of queryWords) {
    if (entryWords.some((e) => wordsMatch(q, e))) {
      hits += 1;
    }
  }
  return hits;
}

export async function findGuide(query: string): Promise<GuideEntry | null> {
  if (!query || query.trim().length === 0) {
    return null;
  }

  const guides = await loadGuides();
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  const byId = guides.find((g) => g.id.toLowerCase() === lower);
  if (byId) {
    return byId;
  }

  const queryWords = tokenize(trimmed);
  let best: GuideEntry | null = null;
  let bestScore = 0;
  for (const entry of guides) {
    const s = score(queryWords, entry);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }

  return best;
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hero, HeroData } from "./types/hero.js";

let heroData: HeroData | null = null;

async function loadHeroes(): Promise<HeroData> {
  if (heroData !== null) {
    return heroData;
  }

  // Use relative path from the compiled dist directory
  const dataPath = join(__dirname, "..", "data", "heroes_extend.json");

  try {
    const raw = await readFile(dataPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid hero data format: expected an array");
    }

    // Validate basic structure
    heroData = parsed.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`Invalid hero at index ${index}: expected object`);
      }

      const unknownItem = item as Record<string, unknown>;

      if (
        typeof unknownItem.id !== "number" ||
        typeof unknownItem.displayName !== "string" ||
        typeof unknownItem.shortName !== "string" ||
        typeof unknownItem.notes !== "string" ||
        typeof unknownItem.complete !== "boolean"
      ) {
        throw new Error(
          `Invalid hero at index ${index}: missing required fields`,
        );
      }

      return {
        id: unknownItem.id,
        displayName: unknownItem.displayName,
        shortName: unknownItem.shortName,
        notes: unknownItem.notes,
        complete: unknownItem.complete,
      } satisfies Hero;
    });

    return heroData;
  } catch (error) {
    console.error("[heroes] Failed to load hero data:", error);
    throw error;
  }
}

function fuzzyMatchHero(query: string, heroes: readonly Hero[]): Hero | null {
  const lowerQuery = query.toLowerCase();

  // First, try exact match on shortName (case-insensitive)
  const exactMatch = heroes.find((h) => h.shortName.toLowerCase() === lowerQuery);
  if (exactMatch) {
    return exactMatch;
  }

  // Try exact match on displayName (case-insensitive)
  const exactNameMatch = heroes.find(
    (h) => h.displayName.toLowerCase() === lowerQuery
  );
  if (exactNameMatch) {
    return exactNameMatch;
  }

  // Try partial match on displayName
  const partialMatch = heroes.find((h) =>
    h.displayName.toLowerCase().includes(lowerQuery)
  );
  if (partialMatch) {
    return partialMatch;
  }

  // Try partial match on shortName
  const partialShortMatch = heroes.find((h) =>
    h.shortName.toLowerCase().includes(lowerQuery)
  );
  if (partialShortMatch) {
    return partialShortMatch;
  }

  return null;
}

export async function findHero(query: string): Promise<Hero | null> {
  if (!query || query.trim().length === 0) {
    return null;
  }

  const heroes = await loadHeroes();
  return fuzzyMatchHero(query.trim(), heroes);
}

export async function getAllHeroes(): Promise<HeroData> {
  return loadHeroes();
}

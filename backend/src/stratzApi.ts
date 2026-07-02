/**
 * STRATZ GraphQL API client + local constants (heroes/items by ID)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.STRATZ_API_KEY ?? "";
const API_ENDPOINT = "https://api.stratz.com/graphql";
const LOCAL_ADDRESS = process.env.STRATZ_LOCAL_ADDRESS ?? "";

/** Undici dispatcher that binds to a specific local IP to bypass VPN */
const stratzDispatcher = LOCAL_ADDRESS
  ? new Agent({ connect: { localAddress: LOCAL_ADDRESS } })
  : undefined;

interface StratzHero {
  id: number;
  displayName: string;
  shortName: string;
}

export interface StratzItem {
  id: number;
  displayName: string | null;
}

interface StratzAbility {
  id: number;
  displayName: string;
  isTalent: boolean;
}

let heroesMap: Map<number, StratzHero> | null = null;
let itemsMap: Map<number, StratzItem> | null = null;
let abilitiesMap: Map<number, StratzAbility> | null = null;

async function loadConstants(): Promise<void> {
  if (heroesMap && itemsMap && abilitiesMap) return;

  const dataDir = join(__dirname, "..", "data", "stratz");

  const [heroesRaw, itemsRaw, abilitiesRaw] = await Promise.all([
    readFile(join(dataDir, "heroes.json"), "utf-8"),
    readFile(join(dataDir, "items.json"), "utf-8"),
    readFile(join(dataDir, "abilities.json"), "utf-8"),
  ]);

  const heroes = JSON.parse(heroesRaw) as StratzHero[];
  const items = JSON.parse(itemsRaw) as StratzItem[];
  const abilities = JSON.parse(abilitiesRaw) as StratzAbility[];

  heroesMap = new Map(heroes.map((h) => [h.id, h]));
  itemsMap = new Map(items.map((i) => [i.id, i]));
  abilitiesMap = new Map(abilities.map((a) => [a.id, a]));
}

export async function getHeroesMap(): Promise<Map<number, StratzHero>> {
  await loadConstants();
  return heroesMap!;
}

export async function getItemsMap(): Promise<Map<number, StratzItem>> {
  await loadConstants();
  return itemsMap!;
}

export async function getAbilitiesMap(): Promise<Map<number, StratzAbility>> {
  await loadConstants();
  return abilitiesMap!;
}

function normalizeStratzName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Find Stratz hero by name or ID */
export async function findStratzHero(
  input: string,
): Promise<StratzHero | null> {
  const heroes = await getHeroesMap();

  // Try numeric ID
  const id = parseInt(input, 10);
  if (!isNaN(id)) return heroes.get(id) ?? null;

  const normalized = normalizeStratzName(input);

  for (const h of heroes.values()) {
    if (h.shortName.toLowerCase() === normalized) return h;
    if (normalizeStratzName(h.displayName) === normalized) return h;
  }

  // Partial match
  for (const h of heroes.values()) {
    if (h.displayName.toLowerCase().includes(normalized)) return h;
    if (h.shortName.toLowerCase().includes(normalized)) return h;
  }

  return null;
}

/** Find Stratz item by display name (exact, then partial match). */
export async function findStratzItem(input: string): Promise<StratzItem | null> {
  const items = await getItemsMap();
  const normalized = normalizeStratzName(input);

  for (const it of items.values()) {
    if (it.displayName && normalizeStratzName(it.displayName) === normalized) return it;
  }
  for (const it of items.values()) {
    if (it.displayName && normalizeStratzName(it.displayName).includes(normalized)) return it;
  }
  return null;
}

export async function queryStratz<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  if (!API_KEY) {
    throw new Error(
      "STRATZ_API_KEY not configured. Add it to backend/.env",
    );
  }

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "STRATZ_API",
    },
    body: JSON.stringify({ query, variables }),
    ...(stratzDispatcher ? { dispatcher: stratzDispatcher } : {}),
  } as RequestInit);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STRATZ HTTP ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}

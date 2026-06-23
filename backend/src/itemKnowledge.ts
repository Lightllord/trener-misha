/**
 * Read-only access to the static Dota knowledge base used by the item-advice
 * subagent: ability/item tag notes, the tag glossary, enriched item data and
 * detailed hero ability files. All loaders cache the parsed JSON in memory.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { findHero } from "./heroes.js";
import type {
  ItemImportance,
  MechanicsGlossary,
  NotesFile,
  TaggedEntity,
} from "./types/knowledge.js";

const dataDir = join(__dirname, "..", "data");
const abilityDir = join(dataDir, "heroes_abbility");

let mechanics: MechanicsGlossary | null = null;
let heroNotes: NotesFile | null = null;
let itemNotes: NotesFile | null = null;
let itemImportance: ItemImportance | null = null;
let itemsEnriched: Array<Record<string, unknown>> | null = null;
let abilityFiles: string[] | null = null;

async function loadJson<T>(relPath: string): Promise<T> {
  const raw = await readFile(join(dataDir, relPath), "utf-8");
  return JSON.parse(raw) as T;
}

/** Strip everything but lowercase alphanumerics for fuzzy name matching. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getMechanics(): Promise<MechanicsGlossary> {
  if (!mechanics) mechanics = await loadJson<MechanicsGlossary>("mecanics_list.json");
  return mechanics;
}

export async function getHeroTags(
  name: string,
): Promise<{ key: string; entity: TaggedEntity } | null> {
  if (!heroNotes) heroNotes = await loadJson<NotesFile>("hero-notes.json");

  const hero = await findHero(name);
  const candidates = [hero?.shortName, name].filter(
    (v): v is string => typeof v === "string",
  );

  for (const candidate of candidates) {
    const entity = heroNotes[candidate];
    if (entity) return { key: candidate, entity };
  }

  const target = normalize(name);
  for (const [key, entity] of Object.entries(heroNotes)) {
    if (normalize(key) === target) return { key, entity };
  }
  return null;
}

function resolveNotesKey(notes: NotesFile, name: string): string | null {
  if (notes[name]) return name;
  const target = normalize(name);
  let partial: string | null = null;
  for (const key of Object.keys(notes)) {
    const nk = normalize(key);
    if (nk === target) return key;
    if (!partial && (nk.includes(target) || target.includes(nk))) partial = key;
  }
  return partial;
}

export async function getItemTags(
  name: string,
): Promise<{ key: string; entity: TaggedEntity } | null> {
  if (!itemNotes) itemNotes = await loadJson<NotesFile>("item-notes.json");
  const key = resolveNotesKey(itemNotes, name);
  return key ? { key, entity: itemNotes[key] } : null;
}

/** Item internal names that are worth recommending (importance === 1). */
export async function getCandidateItems(): Promise<string[]> {
  if (!itemImportance)
    itemImportance = await loadJson<ItemImportance>("items-importance.json");
  return Object.entries(itemImportance)
    .filter(([, v]) => v === 1)
    .map(([k]) => k);
}

/** Detailed item entry (cost, ability descriptions, bonuses) by display or internal name. */
export async function getItemDetail(
  name: string,
): Promise<Record<string, unknown> | null> {
  if (!itemsEnriched)
    itemsEnriched = await loadJson<Array<Record<string, unknown>>>(
      "items-enriched.json",
    );

  const target = normalize(name);
  let partial: Record<string, unknown> | null = null;
  for (const entry of itemsEnriched) {
    const display = entry.displayName;
    if (typeof display !== "string") continue;
    const nd = normalize(display);
    if (nd === target) return entry;
    if (!partial && (nd.includes(target) || target.includes(nd))) partial = entry;
  }
  return partial;
}

/** Detailed ability file (numbers, cooldowns, talents) for a hero. */
export async function getHeroAbilityDetail(
  name: string,
): Promise<unknown | null> {
  if (!abilityFiles) abilityFiles = await readdir(abilityDir);

  const hero = await findHero(name);
  const target = normalize(hero?.displayName ?? name);

  const slug = (file: string) => normalize(file.replace(/-abilities\.json$/i, ""));
  const match =
    abilityFiles.find((f) => slug(f) === target) ??
    abilityFiles.find((f) => slug(f).includes(target) || target.includes(slug(f)));

  if (!match) return null;
  const raw = await readFile(join(abilityDir, match), "utf-8");
  return JSON.parse(raw) as unknown;
}

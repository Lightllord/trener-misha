/**
 * Read-only access to the static Dota knowledge base used by the item-advice
 * subagent: ability/item tag notes, the tag glossary, enriched item data,
 * detailed hero ability files, and Aghanim's Scepter/Shard descriptions.
 * All loaders cache the parsed JSON in memory.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { findHero } from "./heroes.js";
import type {
  AghanimInfo,
  HeroAbilityDetail,
  ItemImportance,
  MechanicsGlossary,
  NotesFile,
  TaggedEntity,
} from "./types/knowledge.js";

interface AghsDescRaw {
  hero_name: string;
  has_scepter: boolean;
  scepter_desc: string;
  scepter_skill_name: string;
  scepter_new_skill: boolean;
  has_shard: boolean;
  shard_desc: string;
  shard_skill_name: string;
  shard_new_skill: boolean;
}

const dataDir = join(__dirname, "..", "data");
const abilityDir = join(dataDir, "heroes_abbility");

let mechanics: MechanicsGlossary | null = null;
let heroNotes: NotesFile | null = null;
let itemNotes: NotesFile | null = null;
let itemImportance: ItemImportance | null = null;
let itemsEnriched: Array<Record<string, unknown>> | null = null;
let abilityFiles: string[] | null = null;
let aghsDesc: Map<string, AghsDescRaw> | null = null;

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

/** Candidate items (importance === 1) that carry at least one of the given tags. */
export async function findItemsByTags(
  tags: string[],
): Promise<Array<{ item: string; entity: TaggedEntity }>> {
  if (!itemNotes) itemNotes = await loadJson<NotesFile>("item-notes.json");
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  if (!wanted.size) return [];

  const candidates = await getCandidateItems();
  const matches: Array<{ item: string; entity: TaggedEntity }> = [];
  for (const key of candidates) {
    const entity = itemNotes[key];
    if (!entity) continue;
    const hasTag = entity.abilities.some((a) =>
      a.scenarios.some((s) => s.tags.some((t) => wanted.has(t.toLowerCase()))),
    );
    if (hasTag) matches.push({ item: key, entity });
  }
  return matches;
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

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

async function loadAghsDesc(): Promise<Map<string, AghsDescRaw>> {
  if (!aghsDesc) {
    const raw = await loadJson<AghsDescRaw[]>("aghs_desc.json");
    aghsDesc = new Map(raw.map((r) => [r.hero_name, r]));
  }
  return aghsDesc;
}

/** What Aghanim's Scepter/Shard give this hero (odota/dotaconstants), for hero-specific tagging. */
export async function getAghanimInfo(name: string): Promise<AghanimInfo | null> {
  const hero = await findHero(name);
  if (!hero) return null;

  const map = await loadAghsDesc();
  const raw = map.get(`npc_dota_hero_${hero.shortName}`);
  if (!raw) return null;

  return {
    heroName: hero.displayName,
    hasScepter: raw.has_scepter,
    scepterDesc: stripHtml(raw.scepter_desc),
    scepterSkillName: raw.scepter_skill_name,
    scepterNewSkill: raw.scepter_new_skill,
    hasShard: raw.has_shard,
    shardDesc: stripHtml(raw.shard_desc),
    shardSkillName: raw.shard_skill_name,
    shardNewSkill: raw.shard_new_skill,
  };
}

/** Detailed ability file (numbers, cooldowns, talents) for a hero. */
export async function getHeroAbilityDetail(
  name: string,
): Promise<HeroAbilityDetail | null> {
  if (!abilityFiles) abilityFiles = await readdir(abilityDir);

  const hero = await findHero(name);
  const target = normalize(hero?.displayName ?? name);

  const slug = (file: string) => normalize(file.replace(/-abilities\.json$/i, ""));
  const match =
    abilityFiles.find((f) => slug(f) === target) ??
    abilityFiles.find((f) => slug(f).includes(target) || target.includes(slug(f)));

  if (!match) return null;
  const raw = await readFile(join(abilityDir, match), "utf-8");
  return JSON.parse(raw) as HeroAbilityDetail;
}

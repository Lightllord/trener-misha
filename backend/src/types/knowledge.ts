export interface TagSideEffect {
  target: string;
  tags: string[];
}

export interface TagScenario {
  target: string;
  tags: string[];
  sideEffects: TagSideEffect[];
}

export interface TaggedAbility {
  name: string;
  scenarios: TagScenario[];
}

export interface TaggedEntity {
  abilities: TaggedAbility[];
}

export type NotesFile = Record<string, TaggedEntity>;

/** Tag name → human-readable meaning (mecanics_list.json) */
export type MechanicsGlossary = Record<string, string>;

/** Item internal name → 1 (relevant) | 0 (noise), from items-importance.json */
export type ItemImportance = Record<string, number>;

export interface HeroAbility {
  name: string;
  hotkey: string;
  description: string;
  type: string;
  traits: Record<string, string>;
}

export interface HeroTalent {
  level: number;
  left: string;
  right: string;
}

/** Detailed per-hero ability file under data/heroes_abbility/. */
export interface HeroAbilityDetail {
  heroName: string;
  innateAbility: HeroAbility | null;
  abilities: HeroAbility[];
  talents: HeroTalent[];
  roles: string[];
  facets: string[];
}

/** What Aghanim's Scepter/Shard give a hero, from data/aghs_desc.json (odota/dotaconstants). */
export interface AghanimInfo {
  heroName: string;
  hasScepter: boolean;
  scepterDesc: string;
  scepterSkillName: string;
  scepterNewSkill: boolean;
  hasShard: boolean;
  shardDesc: string;
  shardSkillName: string;
  shardNewSkill: boolean;
}

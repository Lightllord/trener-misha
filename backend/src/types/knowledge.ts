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

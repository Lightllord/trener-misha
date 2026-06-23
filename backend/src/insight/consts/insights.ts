import type { InsightConfig, InsightName } from "../types/insight.js";

export const INSIGHT_CONFIGS: Record<InsightName, InsightConfig> = {
  draft_analysis: {
    unique: true,
    description:
      "Background analysis of the current draft: matchups, counters, recommended item build.",
    importance: "high",
    ttlMs: 120_000,
  },
  item_advice: {
    unique: false,
    description:
      "Answer to the player's item question — which item to buy and why, based on hero/item mechanics and typical builds.",
    importance: "high",
    ttlMs: 120_000,
  },
  hero_death: {
    unique: false,
    description: "Player just died — deliver a short tactical tip on what likely went wrong and how to avoid it next life.",
    importance: "high",
    ttlMs: 30_000,
  },
  hero_missing: {
    unique: false,
    description: "An enemy hero has not been visible on the minimap for over a minute — warn the player it may be setting up a gank.",
    importance: "medium",
    ttlMs: 30_000,
  },
  enemies_nearby: {
    unique: false,
    description: "Three or more enemy heroes are within 1500 units of the player — critical proximity warning.",
    importance: "critical",
    ttlMs: 10_000,
  },
  roshan_threat: {
    unique: false,
    description: "Three or more enemy heroes spotted near Roshan pit — they may be attempting to take Roshan.",
    importance: "high",
    ttlMs: 30_000,
  },
  player_kill: {
    unique: false,
    description: "Player got a kill — briefly acknowledge and give a follow-up tip if relevant.",
    importance: "medium",
    ttlMs: 20_000,
  },
  level_up: {
    unique: false,
    description: "Player leveled up — mention if the level is a power spike (6, 12, 18, 25).",
    importance: "low",
    ttlMs: 15_000,
  },
  respawned: {
    unique: false,
    description: "Player respawned — brief reminder of nearest objective or safe farming spot.",
    importance: "low",
    ttlMs: 20_000,
  },
  aghs_scepter: {
    unique: false,
    description: "Player obtained Aghanim's Scepter — mention the upgrade effect on their hero.",
    importance: "high",
    ttlMs: 30_000,
  },
  aghs_shard: {
    unique: false,
    description: "Player obtained Aghanim's Shard — mention the upgrade effect on their hero.",
    importance: "high",
    ttlMs: 30_000,
  },
  item_purchased: {
    unique: false,
    description: "Player purchased an item — acknowledge and give a brief usage tip if relevant.",
    importance: "low",
    ttlMs: 30_000,
  },
  enemy_key_item: {
    unique: false,
    description:
      "An enemy hero acquired a key item — warn the player about its impact and how to play around it.",
    importance: "high",
    ttlMs: 30_000,
  },
  enemy_inspect_reminder: {
    unique: false,
    description:
      "The player hasn't inspected any enemy hero for several minutes — remind them to click enemies and check their items and levels.",
    importance: "medium",
    ttlMs: 30_000,
  },
  ally_building_destroyed: {
    unique: false,
    description: "An allied building was destroyed — critical map event, comment on impact and next steps.",
    importance: "critical",
    ttlMs: 30_000,
  },
  enemy_building_destroyed: {
    unique: false,
    description: "An enemy building was destroyed — acknowledge the objective and suggest follow-up.",
    importance: "high",
    ttlMs: 30_000,
  },
};

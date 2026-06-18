import type { InsightConfig, InsightName } from "../types/insight.js";

export const INSIGHT_CONFIGS: Record<InsightName, InsightConfig> = {
  draft_analysis: {
    unique: true,
    description:
      "Background analysis of the current draft: matchups, counters, recommended item build.",
    importance: "high",
  },
  hero_death: {
    unique: false,
    description: "Player just died — deliver a short tactical tip on what likely went wrong and how to avoid it next life.",
    importance: "critical",
  },
  hero_missing: {
    unique: false,
    description: "An enemy hero has not been visible on the minimap for over a minute — warn the player it may be setting up a gank.",
    importance: "medium",
  },
  enemies_nearby: {
    unique: false,
    description: "Three or more enemy heroes are within 1500 units of the player — critical proximity warning.",
    importance: "critical",
  },
  roshan_threat: {
    unique: false,
    description: "Three or more enemy heroes spotted near Roshan pit — they may be attempting to take Roshan.",
    importance: "high",
  },
  player_kill: {
    unique: false,
    description: "Player got a kill — briefly acknowledge and give a follow-up tip if relevant.",
    importance: "medium",
  },
  level_up: {
    unique: false,
    description: "Player leveled up — mention if the level is a power spike (6, 11, 16, 25).",
    importance: "low",
  },
  respawned: {
    unique: false,
    description: "Player respawned — brief reminder of nearest objective or safe farming spot.",
    importance: "low",
  },
  aghs_scepter: {
    unique: false,
    description: "Player obtained Aghanim's Scepter — mention the upgrade effect on their hero.",
    importance: "high",
  },
  aghs_shard: {
    unique: false,
    description: "Player obtained Aghanim's Shard — mention the upgrade effect on their hero.",
    importance: "high",
  },
  item_purchased: {
    unique: false,
    description: "Player purchased an item — acknowledge and give a brief usage tip if relevant.",
    importance: "low",
  },
  ally_building_destroyed: {
    unique: false,
    description: "An allied building was destroyed — critical map event, comment on impact and next steps.",
    importance: "critical",
  },
  enemy_building_destroyed: {
    unique: false,
    description: "An enemy building was destroyed — acknowledge the objective and suggest follow-up.",
    importance: "high",
  },
};

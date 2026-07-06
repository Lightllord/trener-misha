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
    ttlMs: 90_000,
  },
  build_plan: {
    unique: true,
    description:
      "Full-game item build plan for the player's hero and position: ordered purchase plan that closes enemy mechanics and synergises with the hero, cross-checked against typical STRATZ builds.",
    importance: "high",
    ttlMs: 300_000,
  },
  score_change: {
    unique: false,
    description:
      "The player's kills/deaths/assists changed and the event wasn't picked for an instant callout — a single death, or a short flurry of kills/deaths/assists (a team fight, batched into one report). A lone kill or lone assist never reaches this insight — those are either delivered instantly or dropped. React accordingly: give a short tactical tip after a death, or summarize the fight when the payload covers several events.",
    importance: "high",
    ttlMs: 10_000,
  },
  score_change_instant: {
    unique: false,
    description:
      "Immediate, low-latency reaction to a single kill, death, or assist that just happened, fired instead of waiting for the team-fight batching window. React the same way you would to the equivalent score_change event (kill ack, death + short tactical tip, or assist ack), just faster.",
    importance: "high",
    ttlMs: 5_000,
  },
  hero_missing: {
    unique: false,
    description: "An enemy hero has not been visible on the minimap for over a minute — tell the player where the hero was last seen, then warn it may be setting up a gank.",
    importance: "medium",
    ttlMs: 30_000,
  },
  enemies_nearby: {
    unique: false,
    description: "Three or more enemy heroes are within 1500 units of the player — critical proximity warning.",
    importance: "critical",
    ttlMs: 7_000,
  },
  roshan_threat: {
    unique: false,
    description: "Three or more enemy heroes spotted near Roshan pit — they may be attempting to take Roshan.",
    importance: "high",
    ttlMs: 10_000,
  },
  level_up: {
    unique: false,
    description: "Player reached a key level (6, 10, 12, 15, 18, 20, 25, 30) — note the power spike or new ability.",
    importance: "low",
    ttlMs: 5_000,
  },
  respawned: {
    unique: false,
    description: "Player respawned — brief reminder of nearest objective or safe farming spot.",
    importance: "low",
    ttlMs: 8_000,
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
    ttlMs: 10_000,
  },
  enemy_key_item: {
    unique: false,
    description:
      "An enemy hero acquired one or more key items in the same shopping trip (batched into one report) — warn the player about their impact and how to play around them.",
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
    ttlMs: 20_000,
  },
  enemy_building_destroyed: {
    unique: false,
    description: "An enemy building was destroyed — acknowledge the objective and suggest follow-up.",
    importance: "high",
    ttlMs: 5_000,
  },
  ask_player_position: {
    unique: true,
    description:
      "Draft has started and the player's position (1-5) is not yet known — ask the player which position they're playing and save it with set_player_position.",
    importance: "high",
    ttlMs: 180_000,
  },
  excess_gold: {
    unique: false,
    description:
      "Player is holding a lot of unspent gold (2000+, or 2000+ plus buyback cost after 30 minutes) — remind them to go shop.",
    importance: "medium",
    ttlMs: 60_000,
  },
  tormentor_incoming: {
    unique: true,
    description: "Tormentor spawns in one minute (at the 20:00 game clock) in the bottom rift near the portal — give the player a heads-up.",
    importance: "medium",
    ttlMs: 15_000,
  },
  tormentor_spawned: {
    unique: true,
    description: "Tormentor just spawned — suggest the player try to group up with the team and take it.",
    importance: "high",
    ttlMs: 20_000,
  },
  wisdom_altar_incoming: {
    unique: false,
    description: "The wisdom altar spawns in one minute (every 7 minutes starting at 7:00) — suggest the player try to contest it.",
    importance: "medium",
    ttlMs: 20_000,
  },
};

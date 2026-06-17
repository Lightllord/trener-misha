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
    interrupts: true,
  },
  roshan_threat: {
    unique: false,
    description: "Three or more enemy heroes spotted near Roshan pit — they may be attempting to take Roshan.",
    importance: "high",
  },
};

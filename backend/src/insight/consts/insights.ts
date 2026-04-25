import type { InsightConfig, InsightName } from "../types/insight.js";

export const INSIGHT_CONFIGS: Record<InsightName, InsightConfig> = {
  draft_analysis: {
    unique: true,
    description:
      "Background analysis of the current draft: matchups, counters, recommended item build.",
    importance: "high",
  },
};

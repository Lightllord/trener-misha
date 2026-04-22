import type { InsightConfig, InsightName } from "../types/insight.js";

export const INSIGHT_CONFIGS: Record<InsightName, InsightConfig> = {
  draft_analysis: { unique: true },
};

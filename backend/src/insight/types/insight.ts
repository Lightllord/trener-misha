export type InsightName =
  | "draft_analysis"
  | "hero_death"
  | "hero_missing"
  | "enemies_nearby"
  | "roshan_threat";

export type InsightImportance = "low" | "medium" | "high" | "critical";

export interface InsightConfig {
  unique: boolean;
  description: string;
  importance: InsightImportance;
}

export interface Insight {
  name: InsightName;
  used: boolean;
  unique: boolean;
  number: number | null;
  payload: string;
  description: string;
  importance: InsightImportance;
  createdAt: number;
}

export type InsightName = "draft_analysis";

export interface InsightConfig {
  unique: boolean;
}

export interface Insight {
  name: InsightName;
  used: boolean;
  unique: boolean;
  number: number | null;
  payload: string;
  createdAt: number;
}

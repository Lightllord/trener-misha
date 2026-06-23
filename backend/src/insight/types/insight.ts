export type InsightName =
  | "draft_analysis"
  | "item_advice"
  | "hero_death"
  | "hero_missing"
  | "enemies_nearby"
  | "roshan_threat"
  | "player_kill"
  | "level_up"
  | "respawned"
  | "aghs_scepter"
  | "aghs_shard"
  | "item_purchased"
  | "enemy_key_item"
  | "enemy_inspect_reminder"
  | "ally_building_destroyed"
  | "enemy_building_destroyed";

export type InsightImportance = "low" | "medium" | "high" | "critical";

export interface InsightConfig {
  unique: boolean;
  description: string;
  importance: InsightImportance;
  ttlMs: number;
}

export interface Insight {
  name: InsightName;
  used: boolean;
  unique: boolean;
  number: number | null;
  payload: string;
  description: string;
  importance: InsightImportance;
  ttlMs: number;
  createdAt: number;
}

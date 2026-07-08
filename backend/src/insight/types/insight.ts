export type InsightName =
  | "draft_analysis"
  | "build_plan"
  | "score_change"
  | "score_change_instant"
  | "hero_missing"
  | "enemies_nearby"
  | "roshan_threat"
  | "level_up"
  | "respawned"
  | "aghs_scepter"
  | "aghs_shard"
  | "item_purchased"
  | "enemy_key_item"
  | "enemy_inspect_reminder"
  | "ally_building_destroyed"
  | "enemy_building_destroyed"
  | "ask_player_position"
  | "excess_gold"
  | "tormentor_incoming"
  | "tormentor_spawned"
  | "wisdom_altar_incoming";

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

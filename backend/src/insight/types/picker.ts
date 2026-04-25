import type { InsightImportance, InsightName } from "./insight.js";

export interface PickerSummaryItem {
  index: number;
  name: InsightName;
  number: number | null;
  description: string;
  importance: InsightImportance;
  ageSeconds: number;
}

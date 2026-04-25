import { escapeXMLike } from "../xmlike/escape.js";
import type { Insight } from "./types/insight.js";
import type { PickerSummaryItem } from "./types/picker.js";

const INTERRUPTION_NOTE =
  "If you get interrupted or the conversation shifts before you finish delivering this, remember it and resume as soon as the dialogue allows. Do not silently drop it.";

export function formatInsightsAsPickerXMLike(
  summary: readonly PickerSummaryItem[],
): string {
  if (summary.length === 0) {
    return "<unused-insights></unused-insights>";
  }
  const items = summary.map((item) => {
    const numberText = item.number === null ? "null" : String(item.number);
    return [
      `<insight-${item.index}>`,
      `<name>${escapeXMLike(item.name)}</name>`,
      `<number>${numberText}</number>`,
      `<importance>${item.importance}</importance>`,
      `<age-seconds>${item.ageSeconds}</age-seconds>`,
      `<description>${escapeXMLike(item.description)}</description>`,
      `</insight-${item.index}>`,
    ].join("\n");
  });
  return ["<unused-insights>", ...items, "</unused-insights>"].join("\n");
}

export function buildPickerUserMessage(
  insightsBlock: string,
  historyBlock: string,
): string {
  return [insightsBlock, "", historyBlock].join("\n");
}

export function formatInsightForInjection(
  insight: Insight,
  sequence: number,
): string {
  const tag = `insight-${sequence}`;
  return [
    `<${tag}>`,
    `<name>${escapeXMLike(insight.name)}</name>`,
    `<importance>${insight.importance}</importance>`,
    `<description>${escapeXMLike(insight.description)}</description>`,
    `<payload>`,
    insight.payload,
    `</payload>`,
    `<note>${INTERRUPTION_NOTE}</note>`,
    `</${tag}>`,
  ].join("\n");
}

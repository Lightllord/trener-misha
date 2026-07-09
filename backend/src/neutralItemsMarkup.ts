/** Renders scraped neutral-item tier data into the text the voice agent reads aloud. */

import type { NeutralItemData } from "./types/neutralItem.js";

const TOP_ITEMS_PER_TIER = 3;
const TOP_ENCHANTMENTS_PER_TIER = 2;

export function formatNeutralItems(data: NeutralItemData): string {
  const head = `Нейтральные предметы для ${data.hero} (dota2protracker):`;

  const lines = Object.entries(data.tiers).map(([tierName, tier]) => {
    const topItems = tier.items
      .slice(0, TOP_ITEMS_PER_TIER)
      .map((it) => `${it.name} (${it.winRate} wr, ${it.pickRate} pick)`)
      .join(", ");
    const topEnchantments = tier.enchantments
      .slice(0, TOP_ENCHANTMENTS_PER_TIER)
      .map((e) => `${e.name} (${e.winRate} wr)`)
      .join(", ");

    const enchantmentsTail = topEnchantments ? ` | чары: ${topEnchantments}` : "";
    return `${tierName}: ${topItems}${enchantmentsTail}`;
  });

  return [head, ...lines].join("\n");
}

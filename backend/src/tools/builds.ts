import { tool } from "@openai/agents/realtime";
import { z } from "zod";
import {
  queryStratz,
  findStratzHero,
  getItemsMap,
} from "../stratzApi.js";

interface ItemPurchase {
  itemId: number;
  time: number;
  matchCount: number;
  winCount: number;
  winsAverage: number;
}

interface StartingPurchase {
  itemId: number;
  wasGiven: boolean;
  matchCount: number;
  winCount: number;
  winsAverage: number;
}

interface BootPurchase {
  itemId: number;
  time: number;
  timeAverage: number;
  matchCount: number;
  winCount: number;
  winAverage: number;
}

interface NeutralItem {
  itemId: number;
  matchCount: number;
  winCount: number;
  equippedMatchCount: number;
  equippedMatchWinCount: number;
}

interface BuildsResponse {
  data: {
    heroStats: {
      itemFullPurchase?: ItemPurchase[];
      itemStartingPurchase?: StartingPurchase[];
      itemBootPurchase?: BootPurchase[];
      itemNeutral?: NeutralItem[];
    };
  };
  errors?: Array<{ message: string }>;
}

/** Aggregate items by ID, summing match/win counts */
function aggregateItems(
  items: Array<{ itemId: number; matchCount: number; winCount: number }>,
): Array<{
  itemId: number;
  matchCount: number;
  winCount: number;
  winRate: number;
}> {
  const map = new Map<
    number,
    { matchCount: number; winCount: number }
  >();

  for (const item of items) {
    if (item.matchCount === 0) continue;
    const existing = map.get(item.itemId);
    if (existing) {
      existing.matchCount += item.matchCount;
      existing.winCount += item.winCount;
    } else {
      map.set(item.itemId, {
        matchCount: item.matchCount,
        winCount: item.winCount,
      });
    }
  }

  return Array.from(map.entries())
    .map(([itemId, data]) => ({
      itemId,
      matchCount: data.matchCount,
      winCount: data.winCount,
      winRate:
        data.matchCount > 0
          ? (data.winCount / data.matchCount) * 100
          : 0,
    }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

export const buildsTool = tool({
  name: "get_builds",
  description:
    "Get popular item builds for a hero from STRATZ API — starting items, boots, core items by game phase. Use when user asks what to buy, item build, or build order.",
  parameters: z.object({
    hero_name: z
      .string()
      .describe("Hero name or ID to look up builds for (English)"),
  }),
  execute: async ({ hero_name }) => {
    try {
      const hero = await findStratzHero(hero_name);
      if (!hero) {
        return `Не нашли героя "${hero_name}". Попробуйте другое название.`;
      }

      // Fetch all 4 item categories in one request
      const query = `
        query GetHeroBuilds($heroId: Short!) {
          heroStats {
            itemFullPurchase(heroId: $heroId, matchLimit: 50) {
              itemId
              time
              matchCount
              winCount
              winsAverage
            }
            itemStartingPurchase(heroId: $heroId) {
              itemId
              wasGiven
              matchCount
              winCount
              winsAverage
            }
            itemBootPurchase(heroId: $heroId) {
              itemId
              time
              timeAverage
              matchCount
              winCount
              winAverage
            }
            itemNeutral(heroId: $heroId) {
              itemId
              matchCount
              winCount
              equippedMatchCount
              equippedMatchWinCount
            }
          }
        }
      `;

      const data = await queryStratz<BuildsResponse>(query, {
        heroId: hero.id,
      });

      if (data.errors) {
        return `Ошибка STRATZ API: ${data.errors[0]?.message ?? "unknown"}`;
      }

      const stats = data.data?.heroStats;
      if (!stats) {
        return `Нет данных о билдах для ${hero.displayName}.`;
      }

      const itemsMap = await getItemsMap();
      const name = (id: number) =>
        itemsMap.get(id)?.displayName ?? `Item ${id}`;

      let result = `Item builds for ${hero.displayName} (STRATZ data):\n`;

      // Starting items
      if (stats.itemStartingPurchase?.length) {
        const top = aggregateItems(
          stats.itemStartingPurchase.map((i) => ({
            itemId: i.itemId,
            matchCount: i.matchCount,
            winCount: i.winCount,
          })),
        ).slice(0, 6);

        result += "\nSTARTING ITEMS:\n";
        for (const i of top) {
          result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
        }
      }

      // Boots
      if (stats.itemBootPurchase?.length) {
        const top = aggregateItems(
          stats.itemBootPurchase.map((i) => ({
            itemId: i.itemId,
            matchCount: i.matchCount,
            winCount: i.winCount,
          })),
        ).slice(0, 4);

        result += "\nBOOTS:\n";
        for (const i of top) {
          result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
        }
      }

      // Full purchase — categorized by time
      if (stats.itemFullPurchase?.length) {
        const valid = stats.itemFullPurchase.filter(
          (i) => i.matchCount > 0,
        );

        const early = aggregateItems(
          valid
            .filter((i) => i.time > 0 && i.time < 15)
            .map((i) => ({
              itemId: i.itemId,
              matchCount: i.matchCount,
              winCount: i.winCount,
            })),
        ).slice(0, 6);

        const mid = aggregateItems(
          valid
            .filter((i) => i.time >= 15 && i.time < 30)
            .map((i) => ({
              itemId: i.itemId,
              matchCount: i.matchCount,
              winCount: i.winCount,
            })),
        ).slice(0, 6);

        const late = aggregateItems(
          valid
            .filter((i) => i.time >= 30)
            .map((i) => ({
              itemId: i.itemId,
              matchCount: i.matchCount,
              winCount: i.winCount,
            })),
        ).slice(0, 6);

        if (early.length) {
          result += "\nEARLY GAME (0-15 min):\n";
          for (const i of early) {
            result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
          }
        }

        if (mid.length) {
          result += "\nMID GAME (15-30 min):\n";
          for (const i of mid) {
            result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
          }
        }

        if (late.length) {
          result += "\nLATE GAME (30+ min):\n";
          for (const i of late) {
            result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
          }
        }
      }

      // Neutral items
      if (stats.itemNeutral?.length) {
        const top = aggregateItems(
          stats.itemNeutral.map((i) => ({
            itemId: i.itemId,
            matchCount: i.matchCount,
            winCount: i.winCount,
          })),
        ).slice(0, 5);

        result += "\nNEUTRAL ITEMS:\n";
        for (const i of top) {
          result += `  ${name(i.itemId)} — ${i.winRate.toFixed(0)}% wr, ${i.matchCount} games\n`;
        }
      }

      return result;
    } catch (error) {
      console.error("[get_builds] Error:", error);
      return `Ошибка при запросе билдов: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

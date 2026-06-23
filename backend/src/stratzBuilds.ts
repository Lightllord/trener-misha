/**
 * Compact STRATZ build summary for a hero — what items are typically bought,
 * by game phase. Shared by background analysis subagents.
 */

import {
  queryStratz,
  findStratzHero,
  getItemsMap,
} from "./stratzApi.js";

interface PhasedPurchase {
  itemId: number;
  time: number;
  matchCount: number;
  winCount: number;
}

interface FlatPurchase {
  itemId: number;
  matchCount: number;
  winCount: number;
}

interface BuildsResponse {
  data: {
    heroStats: {
      itemFullPurchase?: PhasedPurchase[];
      itemStartingPurchase?: FlatPurchase[];
      itemBootPurchase?: FlatPurchase[];
    };
  };
  errors?: Array<{ message: string }>;
}

function aggregate(
  items: FlatPurchase[],
): Array<{ id: number; matchCount: number; winRate: number }> {
  const map = new Map<number, { mc: number; wc: number }>();
  for (const i of items) {
    if (!i.matchCount) continue;
    const e = map.get(i.itemId);
    if (e) {
      e.mc += i.matchCount;
      e.wc += i.winCount;
    } else {
      map.set(i.itemId, { mc: i.matchCount, wc: i.winCount });
    }
  }
  return Array.from(map.entries())
    .map(([id, d]) => ({ id, matchCount: d.mc, winRate: (d.wc / d.mc) * 100 }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

export async function fetchBuildsSummary(heroName: string): Promise<string> {
  const hero = await findStratzHero(heroName);
  if (!hero) return `Hero "${heroName}" not found in STRATZ.`;

  const query = `
    query GetHeroBuilds($heroId: Short!) {
      heroStats {
        itemFullPurchase(heroId: $heroId, matchLimit: 50) {
          itemId time matchCount winCount
        }
        itemStartingPurchase(heroId: $heroId) {
          itemId matchCount winCount
        }
        itemBootPurchase(heroId: $heroId) {
          itemId matchCount winCount
        }
      }
    }
  `;

  const data = await queryStratz<BuildsResponse>(query, { heroId: hero.id });
  if (data.errors) return `STRATZ error: ${data.errors[0]?.message}`;

  const stats = data.data?.heroStats;
  if (!stats) return `No build data for ${hero.displayName}.`;

  const itemsMap = await getItemsMap();
  const iname = (id: number) => itemsMap.get(id)?.displayName ?? `Item ${id}`;
  const fmt = (rows: Array<{ id: number; winRate: number }>) =>
    rows.map((i) => `${iname(i.id)} (${i.winRate.toFixed(0)}%)`).join(", ");

  let result = `Typical builds for ${hero.displayName} (STRATZ):\n`;

  if (stats.itemStartingPurchase?.length) {
    result += "\nSTARTING: " + fmt(aggregate(stats.itemStartingPurchase).slice(0, 5));
  }
  if (stats.itemBootPurchase?.length) {
    result += "\nBOOTS: " + fmt(aggregate(stats.itemBootPurchase).slice(0, 3));
  }
  if (stats.itemFullPurchase?.length) {
    const valid = stats.itemFullPurchase.filter((i) => i.matchCount > 0);
    const early = aggregate(valid.filter((i) => i.time > 0 && i.time < 15)).slice(0, 5);
    const mid = aggregate(valid.filter((i) => i.time >= 15 && i.time < 30)).slice(0, 5);
    const late = aggregate(valid.filter((i) => i.time >= 30)).slice(0, 5);
    if (early.length) result += "\nEARLY (0-15m): " + fmt(early);
    if (mid.length) result += "\nMID (15-30m): " + fmt(mid);
    if (late.length) result += "\nLATE (30m+): " + fmt(late);
  }

  return result;
}

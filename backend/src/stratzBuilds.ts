/**
 * Compact STRATZ build summary for a hero — what items are typically bought,
 * by game phase. Shared by background analysis subagents.
 */

import {
  queryStratz,
  findStratzHero,
  findStratzItem,
  getItemsMap,
} from "./stratzApi.js";
import { RARE_PURCHASE_THRESHOLD_PCT } from "./consts/stratz.js";
import type { ItemPurchaseRate } from "./types/stratz.js";

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

interface HeroStats {
  itemFullPurchase?: PhasedPurchase[];
  itemStartingPurchase?: FlatPurchase[];
  itemBootPurchase?: FlatPurchase[];
}

interface BuildsResponse {
  data: {
    heroStats: HeroStats;
  };
  errors?: Array<{ message: string }>;
}

const HERO_BUILDS_QUERY = `
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

const heroStatsCache = new Map<number, Promise<HeroStats | null>>();

function fetchHeroStats(heroId: number): Promise<HeroStats | null> {
  if (!heroStatsCache.has(heroId)) {
    heroStatsCache.set(
      heroId,
      queryStratz<BuildsResponse>(HERO_BUILDS_QUERY, { heroId }).then((d) =>
        d.errors ? null : d.data?.heroStats ?? null,
      ),
    );
  }
  return heroStatsCache.get(heroId)!;
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

  const stats = await fetchHeroStats(hero.id);
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

/** Share of matches (on this hero) that included each requested item, per STRATZ. */
export async function fetchItemPurchaseRates(
  heroName: string,
  itemNames: string[],
): Promise<ItemPurchaseRate[]> {
  const hero = await findStratzHero(heroName);
  if (!hero || !itemNames.length) return [];

  const stats = await fetchHeroStats(hero.id);
  if (!stats) {
    return itemNames.map((item) => ({ item, matchCount: 0, purchaseRate: 0, winRate: 0, rare: true }));
  }

  const combined = aggregate([
    ...(stats.itemFullPurchase ?? []),
    ...(stats.itemStartingPurchase ?? []),
    ...(stats.itemBootPurchase ?? []),
  ]);
  const byId = new Map(combined.map((r) => [r.id, r]));

  const bootTop = aggregate(stats.itemBootPurchase ?? [])[0]?.matchCount;
  const samplesAnchor = bootTop || Math.max(...combined.map((r) => r.matchCount), 1);

  const results: ItemPurchaseRate[] = [];
  for (const name of itemNames) {
    const item = await findStratzItem(name);
    const row = item ? byId.get(item.id) : undefined;
    const matchCount = row?.matchCount ?? 0;
    const purchaseRate = (matchCount / samplesAnchor) * 100;
    results.push({
      item: item?.displayName ?? name,
      matchCount,
      purchaseRate,
      winRate: row?.winRate ?? 0,
      rare: purchaseRate < RARE_PURCHASE_THRESHOLD_PCT,
    });
  }
  return results;
}

/**
 * Background neutral-item lookup. Triggered by the request_neutral_items
 * realtime tool. Scrapes dota2protracker.com for the hero, formats the
 * tiered items/enchantments, and delivers the result as a neutral_items
 * insight so the voice turn doesn't block on the scrape.
 */

import { findHero } from "./heroes.js";
import { scrapeNeutralItems } from "./neutralItemsScraper.js";
import { formatNeutralItems } from "./neutralItemsMarkup.js";
import { addInsight } from "./insight/store.js";
import { log, logError } from "./observability/log.js";

export function requestNeutralItems(heroName: string): void {
  log("neutral-items", `started — looking up neutral items for ${heroName}`);
  fetchInBackground(heroName).catch((err) => {
    logError("neutral-items", "background scrape failed:", err);
    addInsight(
      "neutral_items",
      `[Не удалось получить нейтральные предметы для ${heroName}] Извинись перед игроком, что не получилось посмотреть нейтралки, и предложи попросить ещё раз.`,
    );
  });
}

async function fetchInBackground(heroName: string): Promise<void> {
  const hero = await findHero(heroName);
  const data = await scrapeNeutralItems(hero?.displayName ?? heroName);

  addInsight(
    "neutral_items",
    `${formatNeutralItems(data)}\n\nОзвучь игроку топ нейтральный предмет и чару по актуальным тирам кратко, по делу, без простыни цифр.`,
  );
}

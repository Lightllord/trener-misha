import puppeteer, { type Browser, type Page } from "puppeteer";
import type { NeutralItemData, NeutralItemTier } from "./types/neutralItem.js";
import { log } from "./observability/log.js";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;
const cache = new Map<string, { data: NeutralItemData; expiresAt: number }>();

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    log("neutral-items-scraper", "launching browser");
    browserPromise = puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ["--window-position=-2400,-2400", "--window-size=1280,800"],
    });
  }
  return browserPromise;
}

async function waitForCloudflare(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes("Выполнение проверки безопасности") && text.length > 500) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Cloudflare challenge did not clear in time");
}

async function scrapeTiers(page: Page): Promise<Record<string, NeutralItemTier>> {
  return page.evaluate(() => {
    const headings = [...document.querySelectorAll("div")].filter(
      (el) => el.children.length === 0 && /^Tier \d$/.test(el.textContent?.trim() ?? ""),
    );

    const tiers: Record<string, { items: unknown[]; enchantments: unknown[] }> = {};

    for (const heading of headings) {
      const tierName = heading.textContent?.trim() ?? "";
      const container = heading.parentElement;
      if (!container) continue;
      const images = [...container.querySelectorAll('img[src*="/static/items/"]')];

      const items: Array<{ name: string; pickRate: string; winRate: string }> = [];
      const enchantments: Array<{ name: string; pickRate: string; winRate: string }> = [];

      for (const img of images) {
        const card = img.parentElement?.parentElement?.parentElement;
        if (!card) continue;
        const spans = card.querySelectorAll("span");
        if (spans.length < 2) continue;

        const entry = {
          name: (img as HTMLImageElement).alt,
          pickRate: spans[0]?.textContent?.trim() ?? "",
          winRate: (spans[1]?.textContent?.trim() ?? "").replace(/ wr$/, ""),
        };

        if ((img as HTMLImageElement).src.includes("enhancement_")) enchantments.push(entry);
        else items.push(entry);
      }

      tiers[tierName] = { items, enchantments };
    }

    return tiers;
  }) as Promise<Record<string, NeutralItemTier>>;
}

export async function scrapeNeutralItems(heroDisplayName: string): Promise<NeutralItemData> {
  const key = normalize(heroDisplayName);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const url = `https://dota2protracker.com/hero/${encodeURIComponent(heroDisplayName)}`;
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    log("neutral-items-scraper", `loading ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });
    await waitForCloudflare(page);

    const tiers = await scrapeTiers(page);
    const data: NeutralItemData = { hero: heroDisplayName, url, tiers };
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } finally {
    await page.close();
  }
}

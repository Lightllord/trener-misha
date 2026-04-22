import puppeteer from "puppeteer";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..");

const PATCH_URL = process.argv[2] || "https://www.dota2.com/patches/7.41";

async function scrapePatch(url) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (["image", "font", "media"].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );

  console.log(`Loading ${url} ...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 8000));

  const rawData = await page.evaluate(() => {
    const body = document.body.innerText;

    const noteEls = document.querySelectorAll(".eSxyZNZqYCF1Y3wTL5PaK");
    const notes = [];
    for (const el of noteEls) {
      const text = el.innerText.trim();
      if (text) notes.push(text);
    }

    const version = window.location.pathname.split("/").pop() || "";

    return { body, notes, version };
  });

  await browser.close();
  return rawData;
}

/** Parse the raw page text into structured sections */
function parsePatchText(fullText) {
  const markers = ["общие изменения", "general changes"];
  const lowerText = fullText.toLowerCase();
  let startIdx = -1;
  for (const m of markers) {
    const idx = lowerText.indexOf(m);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) startIdx = idx;
  }
  if (startIdx === -1) return { error: "Could not find patch content start marker" };

  const content = fullText.substring(startIdx);
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  const topSections = new Set([
    "общие изменения",
    "цели на карте",
    "изменения ландшафта",
    "изменения нейтральных крипов",
    "изменения предметов",
    "герои",
    "general changes",
    "map objectives",
    "landscape changes",
    "neutral creep changes",
    "item changes",
    "heroes",
    "mechanics changes",
    "изменения артефактов",
    "neutral item changes",
    "изменения героев",
    "hero changes",
  ]);

  const sections = [];
  let current = null;

  for (const line of lines) {
    if (topSections.has(line.toLowerCase())) {
      if (current) sections.push(current);
      current = { title: line, notes: [] };
      continue;
    }
    if (!current) {
      current = { title: "General", notes: [] };
    }
    current.notes.push(line);
  }
  if (current) sections.push(current);

  return { sections };
}

try {
  const rawData = await scrapePatch(PATCH_URL);

  console.log(`\nVersion: ${rawData.version}`);
  console.log(`DOM note elements found: ${rawData.notes.length}`);
  console.log(`Full text length: ${rawData.body.length} chars`);

  const parsed = parsePatchText(rawData.body);

  const output = {
    version: rawData.version,
    url: PATCH_URL,
    ...parsed,
    rawNotes: rawData.notes,
    fullText: rawData.body.substring(
      Math.max(0, rawData.body.toLowerCase().indexOf("общие изменения"))
    ),
  };

  const outFile = join(OUT_DIR, "patch-notes.json");
  await writeFile(outFile, JSON.stringify(output, null, 2), "utf-8");

  if (parsed.sections) {
    console.log(`\nParsed ${parsed.sections.length} sections:`);
    for (const s of parsed.sections) {
      console.log(`  [${s.title}] — ${s.notes.length} lines`);
    }
  }

  console.log(`\nSaved → ${outFile}`);
} catch (err) {
  console.error("Scrape failed:", err);
  process.exit(1);
}

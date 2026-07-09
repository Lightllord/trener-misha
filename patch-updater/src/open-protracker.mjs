import puppeteer from "puppeteer";

const hero = process.argv[2] ?? "Drow Ranger";
const url = `https://dota2protracker.com/hero/${encodeURIComponent(hero)}`;

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  args: ["--start-maximized"],
});
const [page] = await browser.pages();
await page.goto(url, { waitUntil: "networkidle2" });

console.log(`Opened ${url}`);

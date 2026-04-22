import { readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// ── Config ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const PROJECT_ROOT = join(PKG_ROOT, "..");

const HEROES_PATH = join(PROJECT_ROOT, "heroes_extend.json");
const HEROES_BACKEND_PATH = join(PROJECT_ROOT, "backend", "data", "heroes_extend.json");
const PROGRESS_PATH = join(PKG_ROOT, ".patch-progress.json");
const DEFAULT_PATCH_PATH = join(PKG_ROOT, "patch-notes.json");

const CONCURRENCY = 3;
const MAX_RETRIES = 2;

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESUME = args.includes("--resume");
const patchFlagIdx = args.indexOf("--patch");
const PATCH_PATH = patchFlagIdx !== -1 ? args[patchFlagIdx + 1] : DEFAULT_PATCH_PATH;

// ── Helpers ─────────────────────────────────────────────────────────────────

class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /overloaded/i,
  /credit/i,
  /quota/i,
  /billing/i,
  /capacity/i,
  /exceeded.*limit/i,
];

function isRateLimitError(text) {
  return RATE_LIMIT_PATTERNS.some((p) => p.test(text));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withConcurrency(items, fn, limit) {
  const results = [];
  const executing = new Set();
  for (const item of items) {
    const p = fn(item).then((r) => {
      executing.delete(p);
      return r;
    });
    executing.add(p);
    results.push(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

const SYSTEM_PROMPT_FILE = join(PKG_ROOT, ".system-prompt.txt");

function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", [
      "-p", "-",
      "--system-prompt-file", SYSTEM_PROMPT_FILE,
      "--output-format", "text",
      "--max-turns", "1",
    ], { shell: true, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim();
        if (isRateLimitError(msg)) {
          reject(new RateLimitError(`Rate limit: ${msg}`));
        } else {
          reject(new Error(`claude exited with code ${code}: ${msg}`));
        }
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", reject);

    // Send prompt via stdin, then close it
    proc.stdin.write(userPrompt);
    proc.stdin.end();

    // Timeout
    setTimeout(() => {
      proc.kill();
      reject(new Error("claude timed out after 120s"));
    }, 120_000);
  });
}

// ── Step 1: Parse hero changes from patch notes ─────────────────────────────

function parseHeroChanges(patchData, heroNames) {
  const heroSection = patchData.sections.find(
    (s) => s.title.toLowerCase() === "изменения героев" || s.title.toLowerCase() === "hero changes"
  );

  if (!heroSection) {
    console.error("Секция героев не найдена в патчноутах!");
    console.log("Доступные секции:", patchData.sections.map((s) => s.title).join(", "));
    process.exit(1);
  }

  const heroNamesUpper = new Set(heroNames.map((n) => n.toUpperCase()));
  const heroChanges = new Map();
  let currentHero = null;

  for (const line of heroSection.notes) {
    if (heroNamesUpper.has(line) && line !== currentHero) {
      currentHero = line;
      heroChanges.set(currentHero, []);
    } else if (currentHero) {
      heroChanges.get(currentHero).push(line);
    }
  }

  return heroChanges;
}

// ── Step 2: LLM update via Claude CLI ───────────────────────────────────────

const SYSTEM_PROMPT = `You update Dota 2 hero analysis notes based on patch changes.

CRITICAL FORMAT RULES:
1. The output must start IMMEDIATELY with "strenges:" (this exact spelling, NOT "strengths")
2. Three sections with EXACT names: "strenges:", "weaknes:", "core_mecanics:" (these misspellings are intentional and MUST be preserved)
3. Use the same bullet style as the input ("* " or "- ")
4. NO preamble, NO explanations, NO markdown formatting, NO "Here are..." — just the raw notes text
5. Write in English

CONTENT RULES:
- Only modify bullets directly affected by the patch
- Add new bullets if patch introduces new mechanics/strengths/weaknesses
- Remove bullets only if patch completely invalidates them (ability removed etc.)
- Keep unchanged content verbatim

Example output format:
strenges:

* First strength point
* Second strength point

weaknes:

* First weakness point

core_mecanics:

* First mechanic point`;

/** Fix common LLM deviations from the required format */
function normalizeNotes(text) {
  // Strip preamble — everything before the first section header
  const firstSection = text.search(/\b(strenges|strengths?|weaknes|weakness|core[_ ]?mecanics|core[_ ]?mechanics):/i);
  if (firstSection > 0) text = text.substring(firstSection);

  // Strip trailing explanations after the last bullet
  const lastBullet = Math.max(text.lastIndexOf("\n*"), text.lastIndexOf("\n-"));
  if (lastBullet > 0) {
    const nextNewline = text.indexOf("\n", lastBullet + 1);
    // Keep content up to the end of the last bullet line
    if (nextNewline > 0) {
      const afterBullets = text.substring(nextNewline).trim();
      // If what follows doesn't look like a section header or bullet, trim it
      if (afterBullets && !afterBullets.match(/^(strenges|weaknes|core)/i) && !afterBullets.startsWith("*") && !afterBullets.startsWith("-")) {
        text = text.substring(0, nextNewline);
      }
    }
  }

  // Fix section name spelling
  text = text.replace(/\bstrengths?:/gi, "strenges:");
  text = text.replace(/\bweakness(es)?:/gi, "weaknes:");
  text = text.replace(/\bcore[_ ]?mechanics:/gi, "core_mecanics:");

  // Remove markdown bold/headers from section names
  text = text.replace(/\*\*(strenges|weaknes|core_mecanics):\*\*/g, "$1:");
  text = text.replace(/^#+\s*/gm, "");
  text = text.replace(/^---+$/gm, "");

  return text.trim();
}

async function updateHeroNotes(hero, changes, version) {
  const userPrompt = `Hero: ${hero.displayName}

Current notes:
${hero.notes}

Patch ${version} changes:
${changes.join("\n")}

Return the updated notes.`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let text = await callClaude(userPrompt);
      if (!text) throw new Error("Empty response");
      text = normalizeNotes(text);

      const valid = validateNotes(text, hero.notes);
      if (valid.ok) return text;

      console.warn(`  ⚠ ${hero.displayName}: валидация не пройдена (${valid.reason}), попытка ${attempt + 1}`);
    } catch (err) {
      if (err instanceof RateLimitError) throw err; // don't retry, propagate up
      console.warn(`  ⚠ ${hero.displayName}: ошибка (${err.message}), попытка ${attempt + 1}`);
      if (attempt < MAX_RETRIES - 1) await sleep(2000);
    }
  }

  console.warn(`  ✗ ${hero.displayName}: не удалось обновить, оставляю оригинал`);
  return null;
}

function validateNotes(text, original) {
  if (!text.includes("strenges:")) return { ok: false, reason: "missing strenges:" };
  if (!text.includes("weaknes:")) return { ok: false, reason: "missing weaknes:" };
  if (!text.includes("core_mecanics:") && !text.includes("core\\_mecanics:"))
    return { ok: false, reason: "missing core_mecanics:" };

  for (const section of ["strenges:", "weaknes:"]) {
    const idx = text.indexOf(section);
    const nextSection = text.indexOf(":", idx + section.length);
    const sectionText = nextSection > -1 ? text.substring(idx, nextSection) : text.substring(idx);
    if (!sectionText.includes("*") && !sectionText.includes("-")) {
      return { ok: false, reason: `${section} has no bullets` };
    }
  }

  const ratio = text.length / original.length;
  if (ratio < 0.4) return { ok: false, reason: `too short (${Math.round(ratio * 100)}%)` };
  if (ratio > 2.5) return { ok: false, reason: `too long (${Math.round(ratio * 100)}%)` };

  return { ok: true };
}

// ── Step 3: Progress tracking ───────────────────────────────────────────────

async function loadProgress() {
  if (!RESUME || !existsSync(PROGRESS_PATH)) return {};
  try {
    return JSON.parse(await readFile(PROGRESS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function saveProgress(progress) {
  await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf-8");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📖 Загрузка данных...");

  // Write system prompt to file (avoids Windows arg length limits)
  await writeFile(SYSTEM_PROMPT_FILE, SYSTEM_PROMPT, "utf-8");

  const [patchRaw, heroesRaw] = await Promise.all([
    readFile(PATCH_PATH, "utf-8"),
    readFile(HEROES_PATH, "utf-8"),
  ]);

  const patchData = JSON.parse(patchRaw);
  const heroes = JSON.parse(heroesRaw);
  const version = patchData.version || "unknown";

  console.log(`Патч: ${version}`);
  console.log(`Героев в базе: ${heroes.length}`);

  const heroByUpper = new Map(heroes.map((h) => [h.displayName.toUpperCase(), h]));
  const heroNames = heroes.map((h) => h.displayName);

  const heroChanges = parseHeroChanges(patchData, heroNames);
  console.log(`Героев с изменениями в патче: ${heroChanges.size}`);

  const toProcess = [];
  const unmatched = [];
  for (const [upperName, changes] of heroChanges) {
    const hero = heroByUpper.get(upperName);
    if (hero) {
      toProcess.push({ hero, changes });
    } else {
      unmatched.push(upperName);
    }
  }

  if (unmatched.length > 0) {
    console.warn(`\n⚠ Не найдены в heroes_extend.json: ${unmatched.join(", ")}`);
  }

  console.log(`Героев к обработке: ${toProcess.length}`);

  if (DRY_RUN) {
    console.log("\n── DRY RUN ──────────────────────────────────────");
    for (const { hero, changes } of toProcess) {
      console.log(`\n${hero.displayName} (${changes.length} изменений):`);
      for (const c of changes.slice(0, 5)) console.log(`  ${c}`);
      if (changes.length > 5) console.log(`  ... и ещё ${changes.length - 5}`);
    }
    console.log("\n── Конец dry run. Для реального запуска уберите --dry-run ──");
    return;
  }

  const progress = await loadProgress();
  const skipped = new Set(Object.keys(progress));
  const remaining = toProcess.filter((p) => !skipped.has(String(p.hero.id)));

  if (skipped.size > 0) {
    console.log(`Пропуск уже обработанных: ${skipped.size}`);
  }
  console.log(`Осталось обработать: ${remaining.length}\n`);

  let completed = 0;
  let updated = 0;
  let failed = 0;
  let consecutiveErrors = 0;
  let stopped = false;

  let rateLimitHit = false;

  await withConcurrency(
    remaining,
    async ({ hero, changes }) => {
      if (stopped) return;

      try {
        const result = await updateHeroNotes(hero, changes, version);
        completed++;

        if (result) {
          hero.notes = result;
          progress[String(hero.id)] = true;
          updated++;
          consecutiveErrors = 0;
          console.log(`  ✓ ${hero.displayName} [${completed}/${remaining.length}]`);
        } else {
          progress[String(hero.id)] = false;
          failed++;
          consecutiveErrors++;
          console.log(`  ✗ ${hero.displayName} (оставлен оригинал) [${completed}/${remaining.length}]`);

          if (consecutiveErrors >= 3) {
            stopped = true;
            console.error(`\n🛑 ${consecutiveErrors} ошибок подряд — похоже, лимиты исчерпаны.`);
            console.error(`   Прогресс сохранён. Продолжить позже: npm run apply:resume`);
          }
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          stopped = true;
          rateLimitHit = true;
          console.error(`\n🛑 Лимит API исчерпан: ${err.message}`);
          console.error(`   Прогресс сохранён. Продолжить позже: npm run apply:resume`);
        } else {
          throw err;
        }
      }

      await saveProgress(progress);
    },
    CONCURRENCY,
  );

  if (stopped) {
    const notProcessed = remaining.length - completed;
    const output = JSON.stringify(heroes, null, 2) + "\n";
    await writeFile(HEROES_PATH, output, "utf-8");
    await copyFile(HEROES_PATH, HEROES_BACKEND_PATH);
    console.log(`\n📝 Частичный результат сохранён (${updated} обновлено, ${notProcessed} осталось).`);
    if (rateLimitHit) {
      console.log(`⏳ Подождите пока лимиты восстановятся, затем: npm run apply:resume`);
    }
    process.exit(1);
  }

  console.log(`\n📝 Запись результатов...`);
  const output = JSON.stringify(heroes, null, 2) + "\n";
  await writeFile(HEROES_PATH, output, "utf-8");
  await copyFile(HEROES_PATH, HEROES_BACKEND_PATH);

  if (existsSync(PROGRESS_PATH)) await unlink(PROGRESS_PATH);
  if (existsSync(SYSTEM_PROMPT_FILE)) await unlink(SYSTEM_PROMPT_FILE);

  console.log(`\n✅ Готово!`);
  console.log(`  Обновлено: ${updated}`);
  console.log(`  Не удалось (оставлен оригинал): ${failed}`);
  console.log(`  Записано в: ${HEROES_PATH}`);
  console.log(`  Скопировано в: ${HEROES_BACKEND_PATH}`);
}

main().catch((err) => {
  console.error("Фатальная ошибка:", err);
  process.exit(1);
});

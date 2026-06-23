import { diffStates } from "./stateDiff.js";
import { addInsight, markUsed } from "./insight/store.js";
import { getCandidateItems } from "./itemKnowledge.js";
import { log } from "./observability/log.js";
import type { Insight, InsightName } from "./insight/types/insight.js";

const MISSING_THRESHOLD_S = 60;
const MISSING_REFIRE_MS = 120_000;
const NEARBY_COOLDOWN_MS = 30_000;
const NEARBY_RADIUS = 1500;
const ROSHAN_COOLDOWN_MS = 30_000;
const INSPECT_REMINDER_THRESHOLD_S = 300;
const INSPECT_REMINDER_COOLDOWN_MS = 120_000;

const ROSHAN_ZONES = new Set([
  "roshpit_bot",
  "roshpit_top",
  "top_pre_rosh",
  "bot_pre_rosh",
]);

const missingNotified = new Map<string, number>();
const missingInsights = new Map<string, Insight>();
let lastNearbyMs = 0;
let lastRoshanMs = 0;
let lastInspectReminderMs = 0;

// Enemy hero name -> key items already reported, so a single pickup fires once
// even as the hero flickers in and out of vision.
const notifiedEnemyItems = new Map<string, Set<string>>();
let keyItemSet: Set<string> | null = null;

interface HeroPos {
  x: number;
  y: number;
  zone: string;
  lastSeen: number;
  team: string;
  visible: boolean;
}

function heroDist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function checkHeroInsights(state: Record<string, unknown>): void {
  if ((state.phase as string | undefined) !== "playing") return;

  const heroPositions = state.heroPositions as Record<string, HeroPos> | undefined;
  if (!heroPositions) return;

  const player = state.player as { team?: string } | undefined;
  const hero = state.hero as { position?: { x: number; y: number }; alive?: boolean } | undefined;
  const gameTime = (state.gameTime as number | undefined) ?? 0;

  if (!player?.team || !hero?.position) return;

  const enemyTeam = player.team === "radiant" ? "dire" : "radiant";
  const enemyEntries = Object.entries(heroPositions).filter(([, h]) => h.team === enemyTeam);

  const now = Date.now();

  for (const [name, h] of enemyEntries) {
    if (!h.visible && gameTime - h.lastSeen > MISSING_THRESHOLD_S) {
      const lastFired = missingNotified.get(name) ?? 0;
      if (now - lastFired > MISSING_REFIRE_MS) {
        missingNotified.set(name, now);
        const shortName = name.replace("npc_dota_hero_", "");
        const missingFor = Math.floor(gameTime - h.lastSeen);
        const insight = addInsight(
          "hero_missing",
          `Вражеский герой ${shortName} не появлялся на карте ${missingFor} секунд` +
            ` (последний раз замечен: ${h.zone}). Возможно готовит ганк — будь осторожен.`,
        );
        if (insight) missingInsights.set(name, insight);
      }
    } else if (h.visible) {
      missingNotified.delete(name);
      const pending = missingInsights.get(name);
      if (pending) {
        markUsed(pending);
        missingInsights.delete(name);
      }
    }
  }

  if (hero.alive && now - lastNearbyMs > NEARBY_COOLDOWN_MS) {
    const { x: px, y: py } = hero.position;
    const nearby = enemyEntries.filter(
      ([, h]) => h.visible && heroDist(px, py, h.x, h.y) < NEARBY_RADIUS,
    );
    if (nearby.length >= 3) {
      lastNearbyMs = now;
      const names = nearby.map(([n]) => n.replace("npc_dota_hero_", "")).join(", ");
      addInsight(
        "enemies_nearby",
        `${nearby.length} вражеских героя в радиусе ${NEARBY_RADIUS} единиц от тебя: ${names}. Опасность!`,
      );
    }
  }

  if (now - lastRoshanMs > ROSHAN_COOLDOWN_MS) {
    const atRoshan = enemyEntries.filter(([, h]) => h.visible && ROSHAN_ZONES.has(h.zone));
    if (atRoshan.length >= 3) {
      lastRoshanMs = now;
      const names = atRoshan.map(([n]) => n.replace("npc_dota_hero_", "")).join(", ");
      addInsight(
        "roshan_threat",
        `${atRoshan.length} вражеских героя замечены у рошана: ${names}. Возможно пикают рошана — пора реагировать.`,
      );
    }
  }
}

function checkInspectReminder(state: Record<string, unknown>): void {
  if ((state.phase as string | undefined) !== "playing") return;

  const gameTime = (state.gameTime as number | undefined) ?? 0;
  const lastInspect = (state.lastEnemyInspectAt as number | undefined) ?? 0;
  const elapsed = gameTime - lastInspect;
  if (elapsed <= INSPECT_REMINDER_THRESHOLD_S) return;

  const now = Date.now();
  if (now - lastInspectReminderMs < INSPECT_REMINDER_COOLDOWN_MS) return;
  lastInspectReminderMs = now;

  const mins = Math.floor(elapsed / 60);
  addInsight(
    "enemy_inspect_reminder",
    `Игрок уже около ${mins} минут не осматривал предметы и уровни врагов.` +
      ` Напомни ему кликать по вражеским героям, чтобы видеть их прогресс и подстраивать игру.`,
  );
}

interface EnemyHero {
  name?: string;
  team?: string;
  inventory?: { main?: { name?: string }[] };
}

function heroItemNames(hero: EnemyHero): string[] {
  return (hero.inventory?.main ?? [])
    .map((slot) => slot?.name)
    .filter((n): n is string => typeof n === "string" && n !== "empty")
    .map((n) => n.replace(/^item_/, ""));
}

async function checkEnemyKeyItems(state: Record<string, unknown>): Promise<void> {
  if ((state.phase as string | undefined) !== "playing") return;

  const otherHeroes = state.otherHeroes as EnemyHero[] | undefined;
  const player = state.player as { team?: string } | undefined;
  if (!otherHeroes || !player?.team) return;

  if (!keyItemSet) keyItemSet = new Set(await getCandidateItems());

  const enemyTeam = player.team === "radiant" ? "dire" : "radiant";

  for (const hero of otherHeroes) {
    if (!hero.name || hero.team !== enemyTeam) continue;

    let seen = notifiedEnemyItems.get(hero.name);
    if (!seen) {
      seen = new Set();
      notifiedEnemyItems.set(hero.name, seen);
    }

    for (const item of heroItemNames(hero)) {
      if (!keyItemSet.has(item) || seen.has(item)) continue;
      seen.add(item);
      const shortName = hero.name.replace("npc_dota_hero_", "");
      const clean = item.replaceAll("_", " ");
      addInsight(
        "enemy_key_item",
        `Вражеский герой ${shortName} собрал важный предмет: ${clean}.` +
          ` Предупреди игрока о его влиянии и как против него играть.`,
      );
    }
  }
}

export function processStateUpdate(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): void {
  checkHeroInsights(curr);
  checkInspectReminder(curr);
  void checkEnemyKeyItems(curr).catch((err) =>
    log("insight", `enemy key-item check failed: ${String(err)}`),
  );

  const events = diffStates(prev, curr);
  for (const e of events) {
    if (e.type === "player_died") {
      const c = curr as {
        player?: { kills?: number; deaths?: number; assists?: number };
        hero?: { level?: number; respawnSeconds?: number };
      };
      const kda = `${c.player?.kills ?? 0}/${c.player?.deaths ?? 0}/${c.player?.assists ?? 0}`;
      const level = c.hero?.level ?? 0;
      const respawn = c.hero?.respawnSeconds ?? 0;
      addInsight(
        "hero_death",
        `Игрок только что погиб. KDA: ${kda}, уровень ${level}, респаун через ${respawn}с.` +
          ` Дай короткий тактический совет — что скорее всего привело к смерти` +
          ` и как избежать этого в следующей жизни. 1-2 предложения, без воды.`,
      );
    } else {
      addInsight(e.type as InsightName, e.summary);
    }
  }
}

export function clearEventQueue(): void {
  missingNotified.clear();
  missingInsights.clear();
  notifiedEnemyItems.clear();
  lastNearbyMs = 0;
  lastRoshanMs = 0;
  lastInspectReminderMs = 0;
}

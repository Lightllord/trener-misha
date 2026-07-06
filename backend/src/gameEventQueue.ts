import { diffStates } from "./stateDiff.js";
import { addInsight, markUsed } from "./insight/store.js";
import { getCandidateItems } from "./itemKnowledge.js";
import { getPlayerPosition } from "./gameData.js";
import { log } from "./observability/log.js";
import { clearScoreInsightState, handleScoreEvent, updateLiveScore } from "./scoreInsight.js";
import type { Insight, InsightName } from "./insight/types/insight.js";
import type { ScoreKind } from "./scoreInsight.js";

const MISSING_THRESHOLD_S = 60;
const MISSING_REFIRE_MS = 120_000;
const NEARBY_COOLDOWN_MS = 30_000;
const NEARBY_RADIUS = 1500;
const ROSHAN_COOLDOWN_MS = 30_000;
const INSPECT_REMINDER_THRESHOLD_S = 300;
const INSPECT_REMINDER_COOLDOWN_MS = 120_000;
const EXCESS_GOLD_THRESHOLD = 2000;
const EXCESS_GOLD_BUYBACK_GAME_TIME_S = 30 * 60;
const EXCESS_GOLD_REMINDER_COOLDOWN_MS = 120_000;

// New key items on the same enemy hero landing within this window (one shopping
// trip) are batched into one enemy_key_item report instead of firing per item.
const ENEMY_ITEM_BUFFER_MS = 6_000;

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
let lastExcessGoldMs = 0;

// Enemy hero name -> key items already reported, so a single pickup fires once
// even as the hero flickers in and out of vision.
const notifiedEnemyItems = new Map<string, Set<string>>();
let keyItemSet: Set<string> | null = null;

// Enemy hero name -> key items picked up in the current buffering window, flushed as one insight.
const enemyItemBuffers = new Map<string, { items: string[]; timer: ReturnType<typeof setTimeout> }>();

// Kick off loading at import so the set is ready before game states arrive;
// both the enemy item-awareness check and the player item-purchase event filter
// on it (only importance === 1 items are worth announcing).
void getCandidateItems()
  .then((items) => (keyItemSet = new Set(items)))
  .catch((err) => log("insight", `key-item set load failed: ${String(err)}`));

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
        const lastZone = h.zone.replaceAll("_", " ");
        const insight = addInsight(
          "hero_missing",
          `Вражеский герой ${shortName} не появлялся на карте ${missingFor} секунд.` +
            ` Последний раз его видели в районе: ${lastZone}.` +
            ` Обязательно проговори игроку это последнее известное место, прежде чем предупредить — возможно, герой готовит ганк оттуда.`,
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

function checkExcessGold(state: Record<string, unknown>): void {
  if ((state.phase as string | undefined) !== "playing") return;

  const player = state.player as { gold?: number } | undefined;
  const hero = state.hero as { buybackCost?: number } | undefined;
  const gameTime = (state.gameTime as number | undefined) ?? 0;
  if (typeof player?.gold !== "number") return;

  // After 30 minutes buyback matters, so keep enough gold in reserve for it
  // before flagging the rest as "excess" that should be spent.
  const buybackReserve = gameTime >= EXCESS_GOLD_BUYBACK_GAME_TIME_S ? (hero?.buybackCost ?? 0) : 0;
  const threshold = EXCESS_GOLD_THRESHOLD + buybackReserve;
  if (player.gold < threshold) return;

  const now = Date.now();
  if (now - lastExcessGoldMs < EXCESS_GOLD_REMINDER_COOLDOWN_MS) return;
  lastExcessGoldMs = now;

  const reserveNote = buybackReserve > 0
    ? ` (порог включает резерв на байбек: ${buybackReserve})`
    : "";
  addInsight(
    "excess_gold",
    `У игрока на руках ${player.gold} золота${reserveNote}. Напомни закупиться предметами, чтобы деньги не простаивали.`,
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
      bufferEnemyKeyItem(hero.name, item);
    }
  }
}

function bufferEnemyKeyItem(heroName: string, item: string): void {
  const existing = enemyItemBuffers.get(heroName);
  if (existing) {
    existing.items.push(item);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushEnemyItemBuffer(heroName), ENEMY_ITEM_BUFFER_MS);
    return;
  }
  enemyItemBuffers.set(heroName, {
    items: [item],
    timer: setTimeout(() => flushEnemyItemBuffer(heroName), ENEMY_ITEM_BUFFER_MS),
  });
}

function flushEnemyItemBuffer(heroName: string): void {
  const buffer = enemyItemBuffers.get(heroName);
  if (!buffer) return;
  enemyItemBuffers.delete(heroName);

  const shortName = heroName.replace("npc_dota_hero_", "");
  const clean = buffer.items.map((i) => i.replaceAll("_", " "));

  if (clean.length === 1) {
    addInsight(
      "enemy_key_item",
      `Вражеский герой ${shortName} собрал важный предмет: ${clean[0]}.` +
        ` Предупреди игрока о его влиянии и как против него играть.`,
    );
    return;
  }

  addInsight(
    "enemy_key_item",
    `Вражеский герой ${shortName} собрал сразу несколько важных предметов: ${clean.join(", ")}.` +
      ` Предупреди игрока об их влиянии и как против них играть.`,
  );
}

function checkDraftStart(prev: Record<string, unknown>, curr: Record<string, unknown>): void {
  const prevPhase = prev.phase as string | undefined;
  const currPhase = curr.phase as string | undefined;
  if (currPhase !== "hero_selection" || prevPhase === "hero_selection") return;
  if (getPlayerPosition() !== null) return;

  addInsight(
    "ask_player_position",
    "Начался драфт. Спроси у игрока, на какой позиции он играет в этой игре" +
      " (1 кэрри, 2 мид, 3 офлейн, 4 саппорт, 5 хард-саппорт), и сразу сохрани ответ через set_player_position.",
  );
}

const SCORE_EVENT_TYPES = new Set(["player_died", "player_kill", "player_assist"]);

function scoreKindForEventType(type: string): ScoreKind {
  return type === "player_died" ? "death" : type === "player_kill" ? "kill" : "assist";
}

export function processStateUpdate(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): void {
  checkDraftStart(prev, curr);
  checkHeroInsights(curr);
  checkInspectReminder(curr);
  checkExcessGold(curr);
  void checkEnemyKeyItems(curr).catch((err) =>
    log("insight", `enemy key-item check failed: ${String(err)}`),
  );

  const events = diffStates(prev, curr, keyItemSet ?? new Set());

  // All score-changing events in this tick share the same final curr.player
  // snapshot, so refresh liveScore exactly once, before any of this tick's
  // own score insights are created.
  if (events.some((e) => SCORE_EVENT_TYPES.has(e.type))) {
    const c = curr as { player?: { kills?: number; deaths?: number; assists?: number } };
    updateLiveScore({
      kills: c.player?.kills ?? 0,
      deaths: c.player?.deaths ?? 0,
      assists: c.player?.assists ?? 0,
    });
  }

  const c = curr as { hero?: { level?: number; respawnSeconds?: number } };
  for (const e of events) {
    if (SCORE_EVENT_TYPES.has(e.type)) {
      handleScoreEvent(scoreKindForEventType(e.type), c.hero?.level, c.hero?.respawnSeconds);
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
  lastExcessGoldMs = 0;
  clearScoreInsightState();
  for (const buffer of enemyItemBuffers.values()) clearTimeout(buffer.timer);
  enemyItemBuffers.clear();
}

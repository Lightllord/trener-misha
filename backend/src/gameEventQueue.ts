import { diffStates, type GameEvent } from "./stateDiff.js";
import { getState } from "./gameData.js";
import { addInsight } from "./insight/store.js";

const THROTTLE_MS = 30_000;
const FALLBACK_MS = 120_000;

let eventBuffer: GameEvent[] = [];
let lastDeliveryTime = 0;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Hero insight state
// ---------------------------------------------------------------------------

const MISSING_THRESHOLD_S = 60;
const MISSING_REFIRE_MS = 120_000;
const NEARBY_COOLDOWN_MS = 30_000;
const NEARBY_RADIUS = 1500;
const ROSHAN_COOLDOWN_MS = 30_000;

const ROSHAN_ZONES = new Set([
  "roshpit_bot",
  "roshpit_top",
  "top_pre_rosh",
  "bot_pre_rosh",
]);

const missingNotified = new Map<string, number>();
let lastNearbyMs = 0;
let lastRoshanMs = 0;

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

  // Вражеский герой не виден более минуты
  for (const [name, h] of enemyEntries) {
    if (!h.visible && gameTime - h.lastSeen > MISSING_THRESHOLD_S) {
      const lastFired = missingNotified.get(name) ?? 0;
      if (now - lastFired > MISSING_REFIRE_MS) {
        missingNotified.set(name, now);
        const shortName = name.replace("npc_dota_hero_", "");
        const missingFor = Math.floor(gameTime - h.lastSeen);
        addInsight(
          "hero_missing",
          `Вражеский герой ${shortName} не появлялся на карте ${missingFor} секунд` +
            ` (последний раз замечен: ${h.zone}). Возможно готовит ганк — будь осторожен.`,
        );
      }
    } else if (h.visible) {
      missingNotified.delete(name);
    }
  }

  // 3+ вражеских героя рядом с игроком
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

  // 3+ вражеских героя у рошана
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

// ---------------------------------------------------------------------------
// State update + event diff
// ---------------------------------------------------------------------------

export function processStateUpdate(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): void {
  checkHeroInsights(curr);

  const events = diffStates(prev, curr);
  if (events.length > 0) {
    eventBuffer.push(...events);
    for (const e of events) {
      console.log(`[events] ${e.type} (p${e.priority}): ${e.summary}`);
    }
    if (events.some((e) => e.type === "player_died")) {
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
    }
  }
}

export function takeEvents(): { text: string; triggerResponse: boolean } | null {
  const now = Date.now();
  const timeSinceLastDelivery = now - lastDeliveryTime;

  if (eventBuffer.length === 0) return null;

  const hasCritical = eventBuffer.some((e) => e.priority === 1);

  if (timeSinceLastDelivery < THROTTLE_MS && !hasCritical) return null;

  const summaries = eventBuffer.map((e) => `• ${e.summary}`).join("\n");
  const text = `[Игровые события]\n${summaries}\n\nПрокомментируй кратко (1-2 предложения), дай совет если есть.`;

  eventBuffer = [];
  lastDeliveryTime = now;

  return { text, triggerResponse: true };
}

export function takeFallbackStatus(): { text: string; triggerResponse: boolean } | null {
  const now = Date.now();
  if (now - lastDeliveryTime < FALLBACK_MS) return null;

  const state = getState() as Record<string, unknown> | null;
  if (!state) return null;

  const clockTime = state.clockTime as number | undefined;
  const score = state.score as { radiant?: number; dire?: number } | undefined;
  const player = state.player as { kills?: number; deaths?: number; assists?: number; gpm?: number; team?: string } | undefined;
  const hero = state.hero as { level?: number; name?: string } | undefined;
  const inventory = state.inventory as { main?: Array<{ name?: string }> } | undefined;

  if (!clockTime || !player) return null;

  const minutes = Math.floor(clockTime / 60);
  const seconds = clockTime % 60;
  const time = `${minutes}:${String(seconds).padStart(2, "0")}`;
  const kda = `${player.kills ?? 0}/${player.deaths ?? 0}/${player.assists ?? 0}`;
  const items = (inventory?.main ?? [])
    .map((i) => i.name)
    .filter((n) => n && n !== "empty")
    .map((n) => (n as string).replace(/^item_/, "").replaceAll("_", " "))
    .join(", ");

  const parts = [
    `Время: ${time}`,
    `счёт ${score?.radiant ?? 0}-${score?.dire ?? 0}`,
    `Ты: ${kda}`,
    `GPM ${player.gpm ?? 0}`,
    `уровень ${hero?.level ?? 0}`,
  ];
  if (items) parts.push(`Предметы: ${items}`);

  const text = `[Состояние матча]\n${parts.join(", ")}.`;

  lastDeliveryTime = now;

  return { text, triggerResponse: false };
}

export function startFallbackTimer(deliverFn: () => void): void {
  stopFallbackTimer();
  fallbackTimer = setInterval(deliverFn, FALLBACK_MS);
}

export function stopFallbackTimer(): void {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

export function clearEventQueue(): void {
  eventBuffer = [];
  lastDeliveryTime = 0;
  missingNotified.clear();
  lastNearbyMs = 0;
  lastRoshanMs = 0;
  stopFallbackTimer();
}

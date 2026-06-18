import { diffStates } from "./stateDiff.js";
import { addInsight } from "./insight/store.js";
import type { InsightName } from "./insight/types/insight.js";

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

export function processStateUpdate(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
): void {
  checkHeroInsights(curr);

  const events = diffStates(prev, curr);
  for (const e of events) {
    console.log(`[events] ${e.type}: ${e.summary}`);
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
  lastNearbyMs = 0;
  lastRoshanMs = 0;
}

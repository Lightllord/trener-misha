export interface GameEvent {
  type: string;
  summary: string;
}

// Levels worth announcing — power spikes / ability unlocks, not every level
const KEY_LEVELS = [6, 10, 12, 15, 18, 20, 25, 30];

// Tormentor spawns at the 20:00 game clock — warn a minute ahead, then again on spawn.
const TORMENTOR_WARNING_S = 19 * 60;
const TORMENTOR_SPAWN_S = 20 * 60;

// Wisdom altar spawns every 7 minutes starting at 7:00 — warn a minute ahead, repeating.
const WISDOM_ALTAR_FIRST_WARNING_S = 6 * 60;
const WISDOM_ALTAR_PERIOD_S = 7 * 60;

/** True if the clock crossed `start`, `start+period`, `start+2*period`, … between prev and curr. */
function crossedPeriodicThreshold(pClock: number, cClock: number, start: number, period: number): boolean {
  if (cClock < start) return false;
  const prevIndex = pClock < start ? -1 : Math.floor((pClock - start) / period);
  const currIndex = Math.floor((cClock - start) / period);
  return currIndex > prevIndex;
}

interface PlayerData {
  kills?: number;
  deaths?: number;
  assists?: number;
  gpm?: number;
}

interface ItemSlotData {
  name?: string;
}

interface InventoryData {
  main?: ItemSlotData[];
}

interface HeroData {
  level?: number;
  alive?: boolean;
  respawnSeconds?: number;
  aghanimsScepter?: boolean;
  aghanimsShard?: boolean;
  inventory?: InventoryData;
}

interface BuildingData {
  name?: string;
  type?: string;
  lane?: string;
  destroyed?: boolean;
}

interface MatchStateData {
  phase?: string;
  clockTime?: number;
  score?: { radiant?: number; dire?: number };
  player?: PlayerData;
  hero?: HeroData;
  allyBuildings?: BuildingData[];
  enemyBuildings?: BuildingData[];
}

function itemMultiset(items: ItemSlotData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (item.name && item.name !== "empty") {
      map.set(item.name, (map.get(item.name) ?? 0) + 1);
    }
  }
  return map;
}

function buildingDestroyedNames(
  prevBuildings: BuildingData[],
  currBuildings: BuildingData[],
): BuildingData[] {
  const prevMap = new Map<string, boolean>();
  for (const b of prevBuildings) {
    if (b.name) prevMap.set(b.name, b.destroyed ?? false);
  }

  const destroyed: BuildingData[] = [];
  for (const b of currBuildings) {
    if (!b.name || !b.destroyed) continue;
    const wasBefore = prevMap.get(b.name);
    if (wasBefore === false || wasBefore === undefined) {
      destroyed.push(b);
    }
  }
  return destroyed;
}

const BUILDING_TYPE_RU: Record<string, string> = {
  tower: "тавер",
  rax_melee: "казарма ближнего боя",
  rax_range: "казарма дальнего боя",
  ancient: "трон",
};

const LANE_RU: Record<string, string> = {
  top: "топ",
  mid: "мид",
  bot: "бот",
  base: "база",
};

function buildingLabel(b: BuildingData): string {
  const type = BUILDING_TYPE_RU[b.type ?? ""] ?? b.type ?? "здание";
  const lane = LANE_RU[b.lane ?? ""] ?? "";
  return lane ? `${type} ${lane}` : type;
}

export function diffStates(
  prev: Record<string, unknown>,
  curr: Record<string, unknown>,
  keyItems: Set<string>,
): GameEvent[] {
  const events: GameEvent[] = [];

  const p = prev as unknown as MatchStateData;
  const c = curr as unknown as MatchStateData;

  const pPlayer = p.player ?? {};
  const cPlayer = c.player ?? {};
  const pHero = p.hero ?? {};
  const cHero = c.hero ?? {};

  // Player died
  if ((cPlayer.deaths ?? 0) > (pPlayer.deaths ?? 0)) {
    const kda = `${cPlayer.kills ?? 0}/${cPlayer.deaths ?? 0}/${cPlayer.assists ?? 0}`;
    const respawn = cHero.respawnSeconds ?? 0;
    events.push({
      type: "player_died",
      summary: `Ты погиб (${kda}). Респаун через ${respawn}с.`,
    });
  }

  // Player got a kill
  if ((cPlayer.kills ?? 0) > (pPlayer.kills ?? 0)) {
    const kda = `${cPlayer.kills ?? 0}/${cPlayer.deaths ?? 0}/${cPlayer.assists ?? 0}`;
    events.push({
      type: "player_kill",
      summary: `Убийство! Счёт ${kda}.`,
    });
  }

  // Level up — only on key power-spike levels
  if ((cHero.level ?? 0) > (pHero.level ?? 0)) {
    const prevLevel = pHero.level ?? 0;
    const curLevel = cHero.level ?? 0;
    const spike = KEY_LEVELS.filter((lvl) => lvl > prevLevel && lvl <= curLevel).at(-1);
    if (spike !== undefined) {
      events.push({
        type: "level_up",
        summary: `Уровень ${spike}.`,
      });
    }
  }

  // Tormentor warning / spawn — edge-triggered on the game clock crossing 19:00 / 20:00
  if (c.phase === "playing") {
    const pClock = p.clockTime ?? 0;
    const cClock = c.clockTime ?? 0;
    if (pClock < TORMENTOR_WARNING_S && cClock >= TORMENTOR_WARNING_S) {
      events.push({
        type: "tormentor_incoming",
        summary: "Скоро терзатель появится в нижнем разломе, около портала.",
      });
    }
    if (pClock < TORMENTOR_SPAWN_S && cClock >= TORMENTOR_SPAWN_S) {
      events.push({
        type: "tormentor_spawned",
        summary: "Терзатель появился. Постарайтесь по возможности собраться командой и забрать его.",
      });
    }

    if (crossedPeriodicThreshold(pClock, cClock, WISDOM_ALTAR_FIRST_WARNING_S, WISDOM_ALTAR_PERIOD_S)) {
      events.push({
        type: "wisdom_altar_incoming",
        summary: "Через минуту появится алтарь мудрости — постарайтесь за него побороться.",
      });
    }
  }

  // Respawn
  if (pHero.alive === false && cHero.alive === true) {
    events.push({
      type: "respawned",
      summary: "Ты воскрес.",
    });
  }

  // Aghs Scepter
  if (!pHero.aghanimsScepter && cHero.aghanimsScepter) {
    events.push({
      type: "aghs_scepter",
      summary: "Aghanim's Scepter получен!",
    });
  }

  // Aghs Shard
  if (!pHero.aghanimsShard && cHero.aghanimsShard) {
    events.push({
      type: "aghs_shard",
      summary: "Aghanim's Shard получен!",
    });
  }

  // Item purchased
  const prevItems = itemMultiset(p.hero?.inventory?.main ?? []);
  const currItems = itemMultiset(c.hero?.inventory?.main ?? []);
  for (const [name, count] of currItems) {
    const prevCount = prevItems.get(name) ?? 0;
    const internalName = name.replace(/^item_/, "");
    if (count > prevCount && keyItems.has(internalName)) {
      const clean = internalName.replaceAll("_", " ");
      events.push({
        type: "item_purchased",
        summary: `Куплен ${clean}.`,
      });
    }
  }

  // Ally buildings destroyed
  const allyDestroyed = buildingDestroyedNames(
    p.allyBuildings as BuildingData[] ?? [],
    c.allyBuildings as BuildingData[] ?? [],
  );
  for (const b of allyDestroyed) {
    events.push({
      type: "ally_building_destroyed",
      summary: `Наша ${buildingLabel(b)} уничтожена!`,
    });
  }

  // Enemy buildings destroyed
  const enemyDestroyed = buildingDestroyedNames(
    p.enemyBuildings as BuildingData[] ?? [],
    c.enemyBuildings as BuildingData[] ?? [],
  );
  for (const b of enemyDestroyed) {
    events.push({
      type: "enemy_building_destroyed",
      summary: `Вражеская ${buildingLabel(b)} уничтожена.`,
    });
  }

  return events;
}

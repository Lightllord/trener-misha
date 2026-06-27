export interface GameEvent {
  type: string;
  summary: string;
}

// Levels worth announcing — power spikes / ability unlocks, not every level
const KEY_LEVELS = [6, 10, 12, 15, 18, 20, 25, 30];

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

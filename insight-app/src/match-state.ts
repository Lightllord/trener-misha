import type {
  MatchState,
  GamePhase,
  PlayerState,
  HeroState,
  AbilityState,
  InventoryState,
  ItemSlot,
  NeutralItemState,
  BuildingState,
  RawGsiPayload,
  RawAbility,
  RawItem,
  RawBuilding,
  RawMinimapEntity,
} from "./types.js"

/** Dota+ способности которые не относятся к герою */
const IGNORED_ABILITIES = new Set([
  "plus_high_five",
  "plus_guild_banner",
])

/** Паттерн unitname для зданий в minimap */
const BUILDING_PATTERN = /^npc_dota_(goodguys|badguys)_(tower\d+.*|melee_rax_.*|range_rax_.*|fort)$/

// ---------------------------------------------------------------------------
// MatchStateManager — хранит и обновляет состояние матча
// ---------------------------------------------------------------------------

export type PhaseChangeListener = (newPhase: GamePhase, prevPhase: GamePhase | null) => void

export class MatchStateManager {
  private state: MatchState | null = null
  private currentMatchId: string | null = null
  private previousPhase: GamePhase | null = null
  private phaseListeners: PhaseChangeListener[] = []

  /** Все здания замеченные на minimap за текущий матч */
  private seenBuildings = new Set<string>()

  /** Текущий снапшот состояния (null если матч не идёт) */
  get current(): MatchState | null {
    return this.state
  }

  /** Подписаться на смену фазы игры */
  onPhaseChange(listener: PhaseChangeListener): void {
    this.phaseListeners.push(listener)
  }

  /** Обновить состояние из GSI-пакета */
  update(raw: RawGsiPayload): void {
    // Пустой пакет (между матчами) — сбрасываем
    if (!raw.map && !raw.player?.steamid) {
      this.state = null
      this.currentMatchId = null
      this.previousPhase = null
      this.seenBuildings.clear()
      return
    }

    // Нет данных карты — нечего обновлять
    if (!raw.map) return

    // Новый матч — сброс
    if (raw.map.matchid !== this.currentMatchId) {
      this.currentMatchId = raw.map.matchid
      this.state = null
      this.previousPhase = null
      this.seenBuildings.clear()
    }

    const phase = parsePhase(raw.map.game_state)

    // Уведомляем о смене фазы
    if (phase !== this.previousPhase) {
      this.emitPhaseChange(phase, this.previousPhase)
      this.previousPhase = phase
    }
    const team = parseTeam(raw.player?.team_name)

    // Обновляем трекинг зданий через minimap
    const currentMinimapBuildings = extractMinimapBuildings(raw.minimap)
    for (const name of currentMinimapBuildings) {
      this.seenBuildings.add(name)
    }

    // Ally buildings — из GSI buildings секции (с HP) + minimap для destroyed
    const allyBuildings = parseAllyBuildings(
      raw.buildings,
      team,
      this.seenBuildings,
      currentMinimapBuildings,
    )

    // Enemy buildings — целиком из minimap трекинга
    const enemyBuildings = parseEnemyBuildings(
      team,
      this.seenBuildings,
      currentMinimapBuildings,
    )

    this.state = {
      matchId: raw.map.matchid,
      gameTime: raw.map.game_time,
      clockTime: raw.map.clock_time,
      phase,
      isDaytime: raw.map.daytime,
      isPaused: raw.map.paused,
      winner: parseWinner(raw.map.win_team),

      score: {
        radiant: raw.map.radiant_score,
        dire: raw.map.dire_score,
      },

      player: parsePlayer(raw.player),
      hero: parseHero(raw.hero),
      abilities: parseAbilities(raw.abilities),
      inventory: parseInventory(raw.items),

      allyBuildings,
      enemyBuildings,
    }
  }

  private emitPhaseChange(newPhase: GamePhase, prevPhase: GamePhase | null): void {
    for (const listener of this.phaseListeners) {
      try {
        listener(newPhase, prevPhase)
      } catch (err) {
        console.error("[MatchStateManager] Phase listener error:", err)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Minimap → здания
// ---------------------------------------------------------------------------

/** Извлекает имена зданий из текущего minimap */
function extractMinimapBuildings(
  minimap?: Record<string, RawMinimapEntity>,
): Set<string> {
  const result = new Set<string>()
  if (!minimap) return result
  for (const entity of Object.values(minimap)) {
    if (entity.unitname && BUILDING_PATTERN.test(entity.unitname)) {
      result.add(entity.unitname)
    }
  }
  return result
}

/** Классифицирует здание по unitname из minimap */
function classifyBuilding(unitname: string): {
  type: BuildingState["type"]
  lane: BuildingState["lane"]
  team: "goodguys" | "badguys"
} {
  const team = unitname.includes("goodguys") ? "goodguys" as const : "badguys" as const

  let type: BuildingState["type"] = "tower"
  if (unitname.includes("fort")) type = "ancient"
  else if (unitname.includes("melee_rax")) type = "rax_melee"
  else if (unitname.includes("range_rax")) type = "rax_range"

  let lane: BuildingState["lane"] = "base"
  if (unitname.includes("_top")) lane = "top"
  else if (unitname.includes("_mid")) lane = "mid"
  else if (unitname.includes("_bot")) lane = "bot"

  return { type, lane, team }
}

/** Парсит союзные здания — HP из GSI buildings + destroyed из minimap */
function parseAllyBuildings(
  rawBuildings: RawGsiPayload["buildings"],
  playerTeam: "radiant" | "dire",
  seenBuildings: Set<string>,
  currentMinimapBuildings: Set<string>,
): BuildingState[] {
  const allyPrefix = playerTeam === "radiant" ? "goodguys" : "badguys"
  const result: BuildingState[] = []

  // Собираем HP данные из GSI buildings секции
  const hpMap = new Map<string, RawBuilding>()
  if (rawBuildings) {
    for (const teamBuildings of Object.values(rawBuildings)) {
      for (const [name, b] of Object.entries(teamBuildings)) {
        hpMap.set(name, b)
      }
    }
  }

  // Проходим по всем замеченным зданиям нашей команды
  for (const unitname of seenBuildings) {
    if (!unitname.includes(allyPrefix)) continue
    const { type, lane } = classifyBuilding(unitname)
    const destroyed = !currentMinimapBuildings.has(unitname)

    // Пытаемся найти HP данные — GSI buildings используют другой формат имён
    const gsiName = minimapToGsiName(unitname, playerTeam)
    const hp = gsiName ? hpMap.get(gsiName) : undefined

    result.push({
      name: unitname,
      type,
      lane,
      destroyed,
      health: hp?.health,
      maxHealth: hp?.max_health,
      healthPercent: hp && hp.max_health > 0
        ? Math.round((hp.health / hp.max_health) * 100)
        : undefined,
    })
  }

  return result
}

/** Парсит вражеские здания — целиком из minimap */
function parseEnemyBuildings(
  playerTeam: "radiant" | "dire",
  seenBuildings: Set<string>,
  currentMinimapBuildings: Set<string>,
): BuildingState[] {
  const enemyPrefix = playerTeam === "radiant" ? "badguys" : "goodguys"
  const result: BuildingState[] = []

  for (const unitname of seenBuildings) {
    if (!unitname.includes(enemyPrefix)) continue
    const { type, lane } = classifyBuilding(unitname)
    const destroyed = !currentMinimapBuildings.has(unitname)

    result.push({
      name: unitname,
      type,
      lane,
      destroyed,
    })
  }

  return result
}

/**
 * Конвертирует minimap unitname → GSI buildings name.
 * minimap: "npc_dota_goodguys_tower1_top" → GSI: "dota_goodguys_tower1_top"
 * minimap: "npc_dota_goodguys_melee_rax_top" → GSI: "good_rax_melee_top"
 * minimap: "npc_dota_goodguys_fort" → GSI: "dota_goodguys_fort"
 */
function minimapToGsiName(
  unitname: string,
  playerTeam: "radiant" | "dire",
): string | null {
  const prefix = playerTeam === "radiant" ? "good" : "bad"

  // Fort
  if (unitname.includes("fort")) {
    return playerTeam === "radiant"
      ? "dota_goodguys_fort"
      : "dota_badguys_fort"
  }

  // Barracks: npc_dota_goodguys_melee_rax_top → good_rax_melee_top
  const raxMatch = unitname.match(/npc_dota_\w+_(melee|range)_rax_(top|mid|bot)/)
  if (raxMatch) {
    return `${prefix}_rax_${raxMatch[1]}_${raxMatch[2]}`
  }

  // Tower: npc_dota_goodguys_tower1_top → dota_goodguys_tower1_top
  // Tower4: npc_dota_goodguys_tower4 → dota_goodguys_tower4_top / dota_goodguys_tower4_bot
  if (unitname.includes("tower")) {
    return unitname.replace("npc_", "")
  }

  return null
}

// ---------------------------------------------------------------------------
// Парсеры
// ---------------------------------------------------------------------------

function parsePhase(gameState: string): GamePhase {
  switch (gameState) {
    case "DOTA_GAMERULES_STATE_HERO_SELECTION":
      return "hero_selection"
    case "DOTA_GAMERULES_STATE_STRATEGY_TIME":
      return "strategy"
    case "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD":
      return "loading"
    case "DOTA_GAMERULES_STATE_PRE_GAME":
      return "pre_game"
    case "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS":
      return "playing"
    case "DOTA_GAMERULES_STATE_POST_GAME":
      return "post_game"
    default:
      return "pre_game"
  }
}

function parseTeam(teamName?: string): "radiant" | "dire" {
  return teamName === "dire" ? "dire" : "radiant"
}

function parseWinner(winTeam: string): "radiant" | "dire" | "none" {
  if (winTeam === "radiant") return "radiant"
  if (winTeam === "dire") return "dire"
  return "none"
}

function parsePlayer(raw?: RawGsiPayload["player"]): PlayerState {
  return {
    steamId: raw?.steamid ?? "",
    name: raw?.name ?? "",
    team: parseTeam(raw?.team_name),
    slot: raw?.player_slot ?? 0,
    kills: raw?.kills ?? 0,
    deaths: raw?.deaths ?? 0,
    assists: raw?.assists ?? 0,
    lastHits: raw?.last_hits ?? 0,
    denies: raw?.denies ?? 0,
    killStreak: raw?.kill_streak ?? 0,
    gold: raw?.gold ?? 0,
    goldReliable: raw?.gold_reliable ?? 0,
    goldUnreliable: raw?.gold_unreliable ?? 0,
    gpm: raw?.gpm ?? 0,
    xpm: raw?.xpm ?? 0,
    goldSources: {
      heroKills: raw?.gold_from_hero_kills ?? 0,
      creepKills: raw?.gold_from_creep_kills ?? 0,
      income: raw?.gold_from_income ?? 0,
      shared: raw?.gold_from_shared ?? 0,
    },
  }
}

function parseHero(raw?: RawGsiPayload["hero"]): HeroState {
  return {
    id: raw?.id ?? 0,
    name: raw?.name ?? "",
    facet: raw?.facet ?? 0,
    level: raw?.level ?? 0,
    xp: raw?.xp ?? 0,
    alive: raw?.alive ?? true,
    respawnSeconds: raw?.respawn_seconds ?? 0,
    health: raw?.health ?? 0,
    maxHealth: raw?.max_health ?? 0,
    healthPercent: raw?.health_percent ?? 0,
    mana: raw?.mana ?? 0,
    maxMana: raw?.max_mana ?? 0,
    manaPercent: raw?.mana_percent ?? 0,
    position: { x: raw?.xpos ?? 0, y: raw?.ypos ?? 0 },
    buybackCost: raw?.buyback_cost ?? 0,
    buybackCooldown: raw?.buyback_cooldown ?? 0,
    status: {
      silenced: raw?.silenced ?? false,
      stunned: raw?.stunned ?? false,
      disarmed: raw?.disarmed ?? false,
      magicImmune: raw?.magicimmune ?? false,
      hexed: raw?.hexed ?? false,
      muted: raw?.muted ?? false,
      break: raw?.break ?? false,
      smoked: raw?.smoked ?? false,
      hasDebuff: raw?.has_debuff ?? false,
    },
    aghanimsScepter: raw?.aghanims_scepter ?? false,
    aghanimsShard: raw?.aghanims_shard ?? false,
    talents: [
      raw?.talent_1 ?? false,
      raw?.talent_2 ?? false,
      raw?.talent_3 ?? false,
      raw?.talent_4 ?? false,
      raw?.talent_5 ?? false,
      raw?.talent_6 ?? false,
      raw?.talent_7 ?? false,
      raw?.talent_8 ?? false,
    ],
    attributesLevel: raw?.attributes_level ?? 0,
  }
}

function parseAbilities(raw?: Record<string, RawAbility>): AbilityState[] {
  if (!raw) return []
  const result: AbilityState[] = []
  for (const key of Object.keys(raw).sort()) {
    const a = raw[key]
    if (IGNORED_ABILITIES.has(a.name)) continue
    result.push({
      name: a.name,
      level: a.level,
      canCast: a.can_cast,
      passive: a.passive,
      isUltimate: a.ultimate,
      cooldown: a.cooldown,
      maxCooldown: a.max_cooldown,
    })
  }
  return result
}

function parseItem(raw: RawItem): ItemSlot {
  return {
    name: raw.name,
    level: raw.item_level ?? 0,
    canCast: raw.can_cast ?? false,
    cooldown: raw.cooldown ?? 0,
    maxCooldown: raw.max_cooldown ?? 0,
    passive: raw.passive ?? false,
    ...(raw.charges != null ? { charges: raw.charges } : {}),
  }
}

function parseInventory(raw?: Record<string, RawItem>): InventoryState {
  const result: InventoryState = {
    main: [],
    stash: [],
    teleport: null,
    neutral: null,
  }
  if (!raw) return result

  // Основные слоты (slot0–slot8)
  for (let i = 0; i <= 8; i++) {
    const item = raw[`slot${i}`]
    if (item && item.name !== "empty") {
      result.main.push(parseItem(item))
    }
  }

  // Стеш (stash0–stash5)
  for (let i = 0; i <= 5; i++) {
    const item = raw[`stash${i}`]
    if (item && item.name !== "empty") {
      result.stash.push(parseItem(item))
    }
  }

  // TP
  const tp = raw["teleport0"]
  if (tp && tp.name !== "empty") {
    result.teleport = parseItem(tp)
  }

  // Нейтральный предмет + его компонент
  const neutral0 = raw["neutral0"]
  const neutral1 = raw["neutral1"]
  if (neutral0 && neutral0.name !== "empty") {
    const neutralState: NeutralItemState = {
      item: parseItem(neutral0),
      component: null,
    }
    if (neutral1 && neutral1.name !== "empty") {
      neutralState.component = parseItem(neutral1)
    }
    result.neutral = neutralState
  }

  return result
}


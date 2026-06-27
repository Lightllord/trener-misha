export type { MapZone, HeroPosition, HeroPositions } from "./types/heroPosition.js"
import type { HeroPositions } from "./types/heroPosition.js"
import type { MapZone } from "./types/heroPosition.js"

/** Фаза матча */
export type GamePhase =
  | "hero_selection"
  | "strategy"
  | "loading"
  | "pre_game"
  | "playing"
  | "post_game"

/** Общее состояние матча — единственный объект, к которому обращается агент */
export interface MatchState {
  matchId: string
  gameTime: number
  clockTime: number
  phase: GamePhase
  isDaytime: boolean
  isPaused: boolean
  winner: "radiant" | "dire" | "none"

  score: {
    radiant: number
    dire: number
  }

  player: PlayerState
  hero: HeroState

  /** Здания нашей команды — HP из GSI buildings + destroyed из minimap */
  allyBuildings: BuildingState[]
  /** Вражеские здания — трекинг через minimap */
  enemyBuildings: BuildingState[]

  /** Позиции героев с minimap. Для невидимых врагов хранится последняя известная позиция */
  heroPositions: HeroPositions

  /** Остальные герои в матче из CV. abilities отсутствуют, inventory только с именами предметов */
  otherHeroes: HeroState[]

  /** gameTime последнего CV-осмотра врага игроком (клик по герою). 0 — ни разу */
  lastEnemyInspectAt: number

  /** Драфт из CV-детектора (null пока составы не распознаны) */
  draft: DraftState | null
}

/** Драфт, распознанный CV во время выбора героев */
export interface DraftState {
  radiant: string[]
  dire: string[]
  confidence: number[]
  detectedAt: string
}

/** Внутренний формат CV-детектора — не входит в MatchState напрямую */
export interface OtherPlayerState {
  heroName: string
  team: "radiant" | "dire"
  slot: number
  level: number
  items: string[]
}

/** Статистика игрока */
export interface PlayerState {
  steamId: string
  name: string
  team: "radiant" | "dire"
  slot: number

  kills: number
  deaths: number
  assists: number
  lastHits: number
  denies: number
  killStreak: number

  gold: number
  goldReliable: number
  goldUnreliable: number
  gpm: number
  xpm: number

  goldSources: {
    heroKills: number
    creepKills: number
    income: number
    shared: number
  }
}

/** Состояние героя */
export interface HeroState {
  id: number
  name: string
  facet: number
  level: number
  xp: number

  alive: boolean
  respawnSeconds: number

  health: number
  maxHealth: number
  healthPercent: number
  mana: number
  maxMana: number
  manaPercent: number

  position: { x: number; y: number }
  zone: MapZone

  buybackCost: number
  buybackCooldown: number

  /** Статус-эффекты */
  status: {
    silenced: boolean
    stunned: boolean
    disarmed: boolean
    magicImmune: boolean
    hexed: boolean
    muted: boolean
    break: boolean
    smoked: boolean
    hasDebuff: boolean
  }

  aghanimsScepter: boolean
  aghanimsShard: boolean

  /** talent_1..talent_8 — true = взят */
  talents: boolean[]
  attributesLevel: number

  /** Только для чужих героев (из CV): команда и слот */
  team?: "radiant" | "dire"
  slot?: number

  /** Только для героя игрока: способности из GSI */
  abilities?: AbilityState[]

  /** Инвентарь. Для чужих героев — только имена предметов, остальные поля нулевые */
  inventory: InventoryState
}

/** Способность героя */
export interface AbilityState {
  name: string
  level: number
  canCast: boolean
  passive: boolean
  isUltimate: boolean
  cooldown: number
  maxCooldown: number
}

/** Слот предмета */
export interface ItemSlot {
  name: string
  level: number
  canCast: boolean
  cooldown: number
  maxCooldown: number
  passive: boolean
  charges?: number
}

/** Инвентарь игрока */
export interface InventoryState {
  /** Основные слоты (slot0–slot5) + рюкзак (slot6–slot8) */
  main: ItemSlot[]
  /** Стеш (stash0–stash5) */
  stash: ItemSlot[]
  /** TP скролл */
  teleport: ItemSlot | null
  /** Нейтральный предмет (neutral0 + neutral1 как компоненты одного итема) */
  neutral: NeutralItemState | null
}

/** Нейтральный предмет с его вторым компонентом */
export interface NeutralItemState {
  item: ItemSlot
  component: ItemSlot | null
}

/** Здание (универсальный тип для ally и enemy) */
export interface BuildingState {
  name: string
  type: "tower" | "rax_melee" | "rax_range" | "ancient"
  lane: "top" | "mid" | "bot" | "base"
  destroyed: boolean
  /** HP доступен только для союзных зданий (из GSI buildings секции) */
  health?: number
  maxHealth?: number
  healthPercent?: number
}

// ---------------------------------------------------------------------------
// Сырые GSI-типы (то что приходит по HTTP от Dota 2)
// ---------------------------------------------------------------------------

export interface RawGsiPayload {
  map?: RawMap
  player?: RawPlayer
  hero?: RawHero
  abilities?: Record<string, RawAbility>
  items?: Record<string, RawItem>
  buildings?: Record<string, Record<string, RawBuilding>>
  minimap?: Record<string, RawMinimapEntity>
  neutralitems?: unknown
  previously?: unknown
  added?: unknown
}

export interface RawMap {
  name: string
  matchid: string
  game_time: number
  clock_time: number
  daytime: boolean
  nightstalker_night: boolean
  radiant_score: number
  dire_score: number
  game_state: string
  paused: boolean
  win_team: string
  customgamename: string
  ward_purchase_cooldown: number
}

export interface RawPlayer {
  steamid?: string
  accountid?: string
  name?: string
  activity?: string
  kills?: number
  deaths?: number
  assists?: number
  last_hits?: number
  denies?: number
  kill_streak?: number
  commands_issued?: number
  kill_list?: Record<string, number>
  team_name?: string
  player_slot?: number
  team_slot?: number
  gold?: number
  gold_reliable?: number
  gold_unreliable?: number
  gold_from_hero_kills?: number
  gold_from_creep_kills?: number
  gold_from_income?: number
  gold_from_shared?: number
  gpm?: number
  xpm?: number
}

export interface RawHero {
  facet?: number
  xpos?: number
  ypos?: number
  id: number
  name?: string
  level?: number
  xp?: number
  alive?: boolean
  respawn_seconds?: number
  buyback_cost?: number
  buyback_cooldown?: number
  health?: number
  max_health?: number
  health_percent?: number
  mana?: number
  max_mana?: number
  mana_percent?: number
  silenced?: boolean
  stunned?: boolean
  disarmed?: boolean
  magicimmune?: boolean
  hexed?: boolean
  muted?: boolean
  break?: boolean
  aghanims_scepter?: boolean
  aghanims_shard?: boolean
  smoked?: boolean
  permanent_buffs?: unknown
  has_debuff?: boolean
  talent_1?: boolean
  talent_2?: boolean
  talent_3?: boolean
  talent_4?: boolean
  talent_5?: boolean
  talent_6?: boolean
  talent_7?: boolean
  talent_8?: boolean
  attributes_level?: number
}

export interface RawAbility {
  name: string
  level: number
  can_cast: boolean
  passive: boolean
  ability_active: boolean
  cooldown: number
  max_cooldown: number
  ultimate: boolean
}

export interface RawItem {
  name: string
  purchaser?: number
  item_level?: number
  can_cast?: boolean
  cooldown?: number
  max_cooldown?: number
  passive?: boolean
  item_charges?: number
  charges?: number
}

export interface RawBuilding {
  health: number
  max_health: number
}

export interface RawMinimapEntity {
  xpos?: number
  ypos?: number
  image?: string
  team?: number
  yaw?: number
  unitname?: string
  visionrange?: number
}


/** Имя зоны на карте — произвольная строка из zone-editor */
export type MapZone = string

export interface HeroPosition {
  x: number
  y: number
  zone: MapZone
  /** gameTime когда герой последний раз был виден на minimap */
  lastSeen: number
  team: "radiant" | "dire"
  /** true = присутствует в текущем GSI-тике */
  visible: boolean
}

/** Ключ — unitname из minimap, например "npc_dota_hero_antimage" */
export type HeroPositions = Record<string, HeroPosition>

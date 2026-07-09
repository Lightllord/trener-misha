export interface NeutralItemEntry {
  name: string;
  pickRate: string;
  winRate: string;
}

export interface NeutralItemTier {
  items: NeutralItemEntry[];
  enchantments: NeutralItemEntry[];
}

export interface NeutralItemData {
  hero: string;
  url: string;
  tiers: Record<string, NeutralItemTier>;
}

/** How often an item is bought on a hero, per STRATZ (stratzBuilds.fetchItemPurchaseRates). */
export interface ItemPurchaseRate {
  item: string;
  matchCount: number;
  purchaseRate: number;
  winRate: number;
  rare: boolean;
}

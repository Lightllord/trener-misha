export interface HeroNotesSection {
  label: string;
  content: string[];
}

export interface Hero {
  id: number;
  displayName: string;
  shortName: string;
  notes: string;
  complete: boolean;
}

export type HeroData = Hero[];

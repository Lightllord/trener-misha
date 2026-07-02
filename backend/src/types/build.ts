import { BUILD_PHASES } from "../consts/build.js";

export type BuildPhase = (typeof BUILD_PHASES)[number];

export interface BuildItem {
  item: string;
  phase: BuildPhase;
  reason: string;
}

/** The session's planned item build, items held in purchase order. */
export interface BuildPlan {
  hero: string | null;
  position: number;
  items: BuildItem[];
  notes: string | null;
  updatedAt: string;
}

/** Where to place an item relative to an existing one (by name). */
export interface EditAnchor {
  after?: string;
  before?: string;
}

export type EditResult =
  | { ok: true; plan: BuildPlan }
  | { ok: false; error: string };

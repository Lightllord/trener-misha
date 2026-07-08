/**
 * In-memory store for game data pushed from insight-app, plus the derived
 * session state that rides alongside it (draft corrections, the planned
 * item build). All of it is scoped to one match, not to any WS connection —
 * ingestApp.ts calls clearGameData() only when a push reports a new matchId,
 * so a browser reconnect mid-match leaves position/corrections/buildPlan intact.
 *
 * The draft lives inside the match state (pushed via /push/state). Manual
 * corrections from the agent are kept as an overlay here and re-applied to
 * every incoming state so CV re-detection can never overwrite them.
 *
 * The build plan is populated by the buildPlan subagent via setBuildPlan;
 * the realtime agent reads it with get_build_plan and mutates it through the
 * add/remove/replace/move edit operations (each keeps items in purchase order).
 */

import type { BuildItem, BuildPlan, EditAnchor, EditResult } from "./types/build.js";

interface DraftData {
  radiant: string[];
  dire: string[];
  confidence: number[];
  detectedAt: string;
}

let state: Record<string, unknown> | null = null;
let prevState: Record<string, unknown> | null = null;
let buildPlan: BuildPlan | null = null;

// Position (1-5) the agent recorded after asking the player — not detected by
// CV, so it must be re-applied to every incoming state like draft corrections.
let playerPosition: number | null = null;

// Latest CV player-panel detections, pushed independently of /push/state (see
// ingestApp.ts /push/player-detection) so they aren't throttled to the GSI
// push cadence. Re-applied to every incoming state like corrections/position,
// since insight-app's own full-state push always carries a stale/empty value.
let otherHeroesOverlay: unknown[] = [];
let lastEnemyInspectAtOverlay = 0;

// Slots manually corrected by the agent — keyed by slot index, re-applied to every state.
const corrections: { radiant: Map<number, string>; dire: Map<number, string> } = {
  radiant: new Map(),
  dire: new Map(),
};

function isDraftData(val: unknown): val is DraftData {
  if (typeof val !== "object" || val === null) return false;
  const d = val as Record<string, unknown>;
  return Array.isArray(d.radiant) && Array.isArray(d.dire) && Array.isArray(d.confidence);
}

function applyCorrections(data: Record<string, unknown>): void {
  if (corrections.radiant.size === 0 && corrections.dire.size === 0) return;

  const draft: DraftData = isDraftData(data.draft)
    ? data.draft
    : {
        radiant: Array(5).fill("unknown") as string[],
        dire: Array(5).fill("unknown") as string[],
        confidence: Array(10).fill(0) as number[],
        detectedAt: new Date().toISOString(),
      };

  for (const [i, hero] of corrections.radiant) {
    draft.radiant[i] = hero;
    draft.confidence[i] = 1.0;
  }
  for (const [i, hero] of corrections.dire) {
    draft.dire[i] = hero;
    draft.confidence[5 + i] = 1.0;
  }

  data.draft = draft;
}

export function getDraft(): DraftData | null {
  const draft = state?.draft;
  return isDraftData(draft) ? draft : null;
}

export function correctDraftSlot(team: "radiant" | "dire", slot: number, hero: string): void {
  corrections[team].set(slot, hero);
  // Reflect immediately so get_match_state returns the correction without waiting for the next push.
  if (state) applyCorrections(state);
}

export function getPlayerPosition(): number | null {
  return playerPosition;
}

export function setPlayerPosition(position: number): void {
  playerPosition = position;
  // Reflect immediately so get_match_state returns it without waiting for the next push.
  if (state) state.playerPosition = position;
}

function heroNameOf(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const name = (entry as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

// A hero the draft never picked is a CV misdetection (wrong template match),
// not a tenth-plus player — drop it rather than let it into matchState. When
// the draft itself hasn't been detected yet there is nothing to check against,
// so everything passes through.
function isHeroInDraft(heroName: string, draft: DraftData | null): boolean {
  if (!draft) return true;
  return draft.radiant.includes(heroName) || draft.dire.includes(heroName);
}

export function setOtherHeroes(heroes: unknown[], lastInspectGameTime: number): void {
  const draft = getDraft();
  otherHeroesOverlay = heroes.filter((h) => {
    const name = heroNameOf(h);
    return name !== null && isHeroInDraft(name, draft);
  });
  lastEnemyInspectAtOverlay = lastInspectGameTime;
  // Reflect immediately so get_match_state returns it without waiting for the next push.
  if (state) {
    state.otherHeroes = otherHeroesOverlay;
    state.lastEnemyInspectAt = lastEnemyInspectAtOverlay;
  }
}

export function getState(): Record<string, unknown> | null {
  return state;
}

export function getPrevState(): Record<string, unknown> | null {
  return prevState;
}

export function setState(data: Record<string, unknown>): void {
  applyCorrections(data);
  data.playerPosition = playerPosition;
  data.otherHeroes = otherHeroesOverlay;
  data.lastEnemyInspectAt = lastEnemyInspectAtOverlay;
  prevState = state;
  state = data;
}

export function clearGameData(): void {
  state = null;
  prevState = null;
  corrections.radiant.clear();
  corrections.dire.clear();
  buildPlan = null;
  playerPosition = null;
  otherHeroesOverlay = [];
  lastEnemyInspectAtOverlay = 0;
}

function normalizeItemName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function indexOfItem(items: BuildItem[], name: string): number {
  const target = normalizeItemName(name);
  return items.findIndex((i) => {
    const n = normalizeItemName(i.item);
    return n === target || n.includes(target) || target.includes(n);
  });
}

/** Resolve an anchor to an insertion index; defaults to the end of the list. */
function resolveInsert(items: BuildItem[], anchor: EditAnchor): number {
  if (anchor.before) {
    const i = indexOfItem(items, anchor.before);
    if (i >= 0) return i;
  }
  if (anchor.after) {
    const i = indexOfItem(items, anchor.after);
    if (i >= 0) return i + 1;
  }
  return items.length;
}

function touchBuildPlan(): void {
  if (buildPlan) buildPlan.updatedAt = new Date().toISOString();
}

export function getBuildPlan(): BuildPlan | null {
  return buildPlan;
}

export function setBuildPlan(next: BuildPlan): void {
  buildPlan = next;
}

export function addBuildItem(item: BuildItem, anchor: EditAnchor = {}): EditResult {
  if (!buildPlan) return { ok: false, error: "Билд ещё не составлен." };
  buildPlan.items.splice(resolveInsert(buildPlan.items, anchor), 0, item);
  touchBuildPlan();
  return { ok: true, plan: buildPlan };
}

export function removeBuildItem(name: string): EditResult {
  if (!buildPlan) return { ok: false, error: "Билд ещё не составлен." };
  const i = indexOfItem(buildPlan.items, name);
  if (i < 0) return { ok: false, error: `В билде нет предмета "${name}".` };
  buildPlan.items.splice(i, 1);
  touchBuildPlan();
  return { ok: true, plan: buildPlan };
}

export function replaceBuildItem(oldName: string, item: BuildItem): EditResult {
  if (!buildPlan) return { ok: false, error: "Билд ещё не составлен." };
  const i = indexOfItem(buildPlan.items, oldName);
  if (i < 0) return { ok: false, error: `В билде нет предмета "${oldName}".` };
  buildPlan.items.splice(i, 1, item);
  touchBuildPlan();
  return { ok: true, plan: buildPlan };
}

export function moveBuildItem(name: string, anchor: EditAnchor): EditResult {
  if (!buildPlan) return { ok: false, error: "Билд ещё не составлен." };
  const from = indexOfItem(buildPlan.items, name);
  if (from < 0) return { ok: false, error: `В билде нет предмета "${name}".` };
  const [moved] = buildPlan.items.splice(from, 1);
  if (!moved) return { ok: false, error: `Не удалось переставить "${name}".` };
  buildPlan.items.splice(resolveInsert(buildPlan.items, anchor), 0, moved);
  touchBuildPlan();
  return { ok: true, plan: buildPlan };
}

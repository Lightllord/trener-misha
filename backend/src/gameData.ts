/**
 * In-memory store for game data pushed from insight-app.
 * Replaces the old polling pattern (GET /draft, GET /state).
 *
 * The draft lives inside the match state (pushed via /push/state). Manual
 * corrections from the agent are kept as an overlay here and re-applied to
 * every incoming state so CV re-detection can never overwrite them.
 */

interface DraftData {
  radiant: string[];
  dire: string[];
  confidence: number[];
  detectedAt: string;
}

let state: Record<string, unknown> | null = null;
let prevState: Record<string, unknown> | null = null;

// Position (1-5) the agent recorded after asking the player — not detected by
// CV, so it must be re-applied to every incoming state like draft corrections.
let playerPosition: number | null = null;

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

export function getState(): Record<string, unknown> | null {
  return state;
}

export function getPrevState(): Record<string, unknown> | null {
  return prevState;
}

export function setState(data: Record<string, unknown>): void {
  applyCorrections(data);
  data.playerPosition = playerPosition;
  prevState = state;
  state = data;
}

export function clearGameData(): void {
  state = null;
  prevState = null;
  corrections.radiant.clear();
  corrections.dire.clear();
  playerPosition = null;
}

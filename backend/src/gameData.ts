/**
 * In-memory store for game data pushed from insight-app.
 * Replaces the old polling pattern (GET /draft, GET /state).
 */

interface DraftData {
  radiant: string[];
  dire: string[];
  confidence: number[];
  detectedAt: string;
}

let draft: DraftData | null = null;
let state: Record<string, unknown> | null = null;
let prevState: Record<string, unknown> | null = null;

// Slots manually corrected by the agent — CV will not overwrite these.
let lockedSlots: { radiant: Set<number>; dire: Set<number> } = {
  radiant: new Set(),
  dire: new Set(),
};

export function getDraft(): DraftData | null {
  return draft;
}

export function setDraft(data: DraftData): void {
  if (lockedSlots.radiant.size === 0 && lockedSlots.dire.size === 0) {
    draft = data;
    return;
  }

  // Merge: preserve manually corrected slots, take everything else from CV.
  const merged: DraftData = {
    radiant: [...data.radiant],
    dire: [...data.dire],
    confidence: [...data.confidence],
    detectedAt: data.detectedAt,
  };

  if (draft) {
    for (const i of lockedSlots.radiant) {
      merged.radiant[i] = draft.radiant[i];
      merged.confidence[i] = draft.confidence[i];
    }
    for (const i of lockedSlots.dire) {
      merged.dire[i] = draft.dire[i];
      merged.confidence[5 + i] = draft.confidence[5 + i];
    }
  }

  draft = merged;
}

export function correctDraftSlot(team: "radiant" | "dire", slot: number, hero: string): void {
  if (!draft) {
    draft = {
      radiant: Array(5).fill("unknown") as string[],
      dire: Array(5).fill("unknown") as string[],
      confidence: Array(10).fill(0) as number[],
      detectedAt: new Date().toISOString(),
    };
  }

  if (team === "radiant") {
    draft.radiant[slot] = hero;
    draft.confidence[slot] = 1.0;
    lockedSlots.radiant.add(slot);
  } else {
    draft.dire[slot] = hero;
    draft.confidence[5 + slot] = 1.0;
    lockedSlots.dire.add(slot);
  }

  draft.detectedAt = new Date().toISOString();
}

export function getState(): Record<string, unknown> | null {
  return state;
}

export function getPrevState(): Record<string, unknown> | null {
  return prevState;
}

export function setState(data: Record<string, unknown>): void {
  prevState = state;
  state = data;
}

export function clearGameData(): void {
  draft = null;
  state = null;
  prevState = null;
  lockedSlots = { radiant: new Set(), dire: new Set() };
}

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

export function getDraft(): DraftData | null {
  return draft;
}

export function setDraft(data: DraftData): void {
  draft = data;
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
}

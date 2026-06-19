import type { PttSettings } from "../types/ptt";

// Bump the suffix when the stored shape changes, to discard stale entries.
export const PTT_STORAGE_KEY = "trener-misha.ptt.v3";

export const DEFAULT_PTT_SETTINGS: PttSettings = {
  code: "F8",
  mode: "toggle",
};

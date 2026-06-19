import type { PttSettings } from "../types/ptt";

export const PTT_STORAGE_KEY = "trener-misha.ptt";

// keycode null → the main process picks its default (F8) and reports it back.
export const DEFAULT_PTT_SETTINGS: PttSettings = {
  keycode: null,
  label: "F8",
  mode: "toggle",
};

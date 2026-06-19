import { DEFAULT_PTT_SETTINGS, PTT_STORAGE_KEY } from "./consts/ptt";
import type { PttMode, PttSettings } from "./types/ptt";

export function loadSettings(): PttSettings {
  try {
    const raw = localStorage.getItem(PTT_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_PTT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_PTT_SETTINGS };
    }
    const rec = parsed as Record<string, unknown>;
    const keycode =
      typeof rec.keycode === "number" ? rec.keycode : DEFAULT_PTT_SETTINGS.keycode;
    const label =
      typeof rec.label === "string" ? rec.label : DEFAULT_PTT_SETTINGS.label;
    const mode: PttMode =
      rec.mode === "hold" || rec.mode === "toggle"
        ? rec.mode
        : DEFAULT_PTT_SETTINGS.mode;
    return { keycode, label, mode };
  } catch {
    return { ...DEFAULT_PTT_SETTINGS };
  }
}

export function saveSettings(settings: PttSettings): void {
  try {
    localStorage.setItem(PTT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable — settings just won't persist
  }
}

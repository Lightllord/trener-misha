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
    const code =
      typeof rec.code === "string" ? rec.code : DEFAULT_PTT_SETTINGS.code;
    const mode: PttMode =
      rec.mode === "hold" || rec.mode === "toggle"
        ? rec.mode
        : DEFAULT_PTT_SETTINGS.mode;
    return { code, mode };
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

// A readable label for a KeyboardEvent.code (e.g. "KeyV" → "V", "Digit1" → "1").
export function labelForCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  const named: Record<string, string> = {
    Space: "Space",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
  };
  return named[code] ?? code;
}

// KeyboardEvent.code → UiohookKey name (most match already; letters/digits don't).
export function codeToUiohookName(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return code;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

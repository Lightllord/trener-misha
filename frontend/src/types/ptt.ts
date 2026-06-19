export type PttMode = "hold" | "toggle";

export interface PttSettings {
  // uiohook keycode of the bound key; null until the main process resolves it.
  keycode: number | null;
  // Human-readable label for the bound key (from the main process).
  label: string;
  mode: PttMode;
}

export type PttMode = "hold" | "toggle";

export interface PttSettings {
  // KeyboardEvent.code of the bound key, e.g. "F8", "KeyV", "Space".
  code: string;
  mode: PttMode;
}

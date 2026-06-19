import { loadSettings, saveSettings } from "./pttSettings";
import type { PttMode, PttSettings } from "./types/ptt";

type GateListener = (open: boolean) => void;

// Owns the mic-gate state and the hold/toggle mode. Key events come from the
// Electron main process (global hook) via pressDown/pressUp — this class never
// touches the keyboard or audio itself. Settings persist to localStorage.
export class PttController {
  private settings: PttSettings;
  private active = false;
  private open = false;
  private heldDown = false;

  constructor(private readonly onGateChange: GateListener) {
    this.settings = loadSettings();
  }

  getSettings(): PttSettings {
    return { ...this.settings };
  }

  setBinding(keycode: number, label: string): void {
    this.settings.keycode = keycode;
    this.settings.label = label;
    saveSettings(this.settings);
  }

  setMode(mode: PttMode): void {
    this.settings.mode = mode;
    saveSettings(this.settings);
    this.heldDown = false;
    this.setOpen(false);
  }

  // Enable while connected; starts closed (muted).
  enable(): void {
    this.active = true;
    this.heldDown = false;
    this.setOpen(false);
  }

  disable(): void {
    this.active = false;
    this.heldDown = false;
    this.setOpen(false);
  }

  isOpen(): boolean {
    return this.open;
  }

  pressDown(): void {
    if (!this.active) return;
    if (this.settings.mode === "hold") {
      if (this.heldDown) return; // ignore auto-repeat
      this.heldDown = true;
      this.setOpen(true);
    } else {
      this.setOpen(!this.open);
    }
  }

  pressUp(): void {
    if (!this.active) return;
    if (this.settings.mode === "hold") {
      this.heldDown = false;
      this.setOpen(false);
    }
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.onGateChange(open);
  }
}

export interface PttBinding {
  keycode: number;
  label: string;
}

// Bridge exposed by the Electron preload (see electron/preload.cjs). The app
// only runs inside Electron, but this stays optional so the renderer can warn
// gracefully if loaded outside it.
export interface DesktopPtt {
  // Set the active key (null on first run → main's default). Resolves the binding.
  setKey: (keycode: number | null) => Promise<PttBinding>;
  // Resolve with the next key pressed, adopting it as the new binding.
  captureNext: () => Promise<PttBinding>;
  onDown: (callback: () => void) => void;
  onUp: (callback: () => void) => void;
}

declare global {
  interface Window {
    desktopPtt?: DesktopPtt;
  }
}

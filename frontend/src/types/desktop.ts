// Bridge exposed by the Electron preload (see electron/preload.cjs). The app
// only runs inside Electron, but this stays optional so the renderer can warn
// gracefully if somehow loaded outside it.
export interface DesktopPtt {
  // UiohookKey name → keycode, used to map a KeyboardEvent.code to the global
  // hook's keycode.
  keymap: () => Promise<Record<string, number>>;
  // Tell the main process which keycode to watch globally (null = none).
  setKey: (keycode: number | null) => Promise<void>;
  // Bound-key press/release from the GLOBAL hook — fires only while the app
  // window is NOT focused (when focused, the renderer's own listener handles it).
  onDown: (callback: () => void) => void;
  onUp: (callback: () => void) => void;
}

declare global {
  interface Window {
    desktopPtt?: DesktopPtt;
  }
}

const { contextBridge, ipcRenderer } = require("electron");

// Exposed to the renderer as window.desktopPtt (see src/types/desktop.ts).
contextBridge.exposeInMainWorld("desktopPtt", {
  keymap: () => ipcRenderer.invoke("ptt:keymap"),
  setKey: (keycode) => ipcRenderer.invoke("ptt:set-key", keycode),
  // removeAllListeners first so a dev hot-reload (re-running renderer setup)
  // replaces the handler instead of stacking duplicates.
  onDown: (callback) => {
    ipcRenderer.removeAllListeners("ptt:down");
    ipcRenderer.on("ptt:down", () => callback());
  },
  onUp: (callback) => {
    ipcRenderer.removeAllListeners("ptt:up");
    ipcRenderer.on("ptt:up", () => callback());
  },
});

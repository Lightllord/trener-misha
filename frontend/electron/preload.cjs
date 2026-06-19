const { contextBridge, ipcRenderer } = require("electron");

// Exposed to the renderer as window.desktopPtt (see src/types/desktop.ts).
contextBridge.exposeInMainWorld("desktopPtt", {
  setKey: (keycode) => ipcRenderer.invoke("ptt:set-key", keycode),
  captureNext: () => ipcRenderer.invoke("ptt:capture-next"),
  onDown: (callback) => {
    ipcRenderer.on("ptt:down", () => callback());
  },
  onUp: (callback) => {
    ipcRenderer.on("ptt:up", () => callback());
  },
});

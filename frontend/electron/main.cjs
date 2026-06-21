const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const DEV_URL = "http://localhost:5173";

let win = null;
// Keycode the global hook watches. -1 = nothing (renderer sets it on startup).
let boundKeycode = -1;

function send(channel) {
  // Guard hard: a throw here would propagate into uiohook's native callback and
  // can stop further event delivery (hook goes dead). Never let it throw.
  try {
    if (win && !win.isDestroyed()) {
      const wc = win.webContents;
      if (wc && !wc.isDestroyed()) wc.send(channel);
    }
  } catch (err) {
    console.error("[ptt] send failed:", err);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 680,
    title: "Тренер Миша",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    win.loadURL(DEV_URL);
  }

  win.on("closed", () => {
    win = null;
  });
}

// The global hook fires only while the app window is NOT focused. When Chromium
// has focus it grabs raw keyboard input (Raw Input API — aggravated by an active
// getUserMedia), so this low-level WH_KEYBOARD_LL hook never sees the keys. That
// case is handled by the renderer's own key listener instead; the two cover
// disjoint focus states. The hook is passive — it doesn't swallow the key, so
// the bound key still reaches the game.
// Refs: github.com/wilix-team/iohook/issues/147 ; magpcss.org CEF forum t=19607
uIOhook.on("keydown", (e) => {
  try {
    if (e.keycode === boundKeycode) send("ptt:down");
  } catch (err) {
    console.error("[ptt] keydown handler error:", err);
  }
});

uIOhook.on("keyup", (e) => {
  try {
    if (e.keycode === boundKeycode) send("ptt:up");
  } catch (err) {
    console.error("[ptt] keyup handler error:", err);
  }
});

ipcMain.handle("ptt:keymap", () => ({ ...UiohookKey }));

ipcMain.handle("ptt:set-key", (_event, keycode) => {
  boundKeycode = typeof keycode === "number" ? keycode : -1;
  console.log(`[ptt] global hook watching keycode=${boundKeycode}`);
});

app.whenReady().then(() => {
  createWindow();
  try {
    uIOhook.start();
    console.log("[ptt] global keyboard hook started");
  } catch (err) {
    console.error("[ptt] FAILED to start keyboard hook:", err);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  uIOhook.stop();
});

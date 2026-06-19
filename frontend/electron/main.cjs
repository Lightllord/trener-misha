const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const DEV_URL = "http://localhost:5173";
const DEFAULT_KEYCODE = UiohookKey.F8;

// code → label for display (invert UiohookKey's name → code map).
const KEY_LABEL = {};
for (const [name, code] of Object.entries(UiohookKey)) {
  if (typeof code === "number" && !(code in KEY_LABEL)) KEY_LABEL[code] = name;
}
const labelFor = (code) => KEY_LABEL[code] ?? `Key${code}`;
const binding = (code) => ({ keycode: code, label: labelFor(code) });

let win = null;
let boundKeycode = DEFAULT_KEYCODE;
let captureResolve = null;

function send(channel) {
  win?.webContents.send(channel);
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

// uiohook is a passive listener — it reports keys globally without swallowing
// them, so the bound key still reaches the game.
uIOhook.on("keydown", (e) => {
  if (captureResolve !== null) {
    boundKeycode = e.keycode;
    const resolve = captureResolve;
    captureResolve = null;
    resolve(binding(boundKeycode));
    return;
  }
  if (e.keycode === boundKeycode) send("ptt:down");
});

uIOhook.on("keyup", (e) => {
  if (e.keycode === boundKeycode && captureResolve === null) send("ptt:up");
});

// Renderer sends its stored keycode on startup (null on first run → default).
// Returns the resolved binding so the renderer can show/persist the label.
ipcMain.handle("ptt:set-key", (_event, keycode) => {
  if (typeof keycode === "number") boundKeycode = keycode;
  return binding(boundKeycode);
});

// Resolves with the next key the user presses, and adopts it as the binding.
ipcMain.handle("ptt:capture-next", () => {
  return new Promise((resolve) => {
    captureResolve = resolve;
  });
});

app.whenReady().then(() => {
  createWindow();
  uIOhook.start();
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

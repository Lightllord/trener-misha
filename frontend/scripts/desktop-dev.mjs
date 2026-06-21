// Dev launcher: bring up the Vite HTTP server (if not already running) and the
// Electron app together, as one process group. When Electron exits (window
// closed), the Vite server we started is torn down too — so closing the app
// closes everything. If Vite was already running (started separately), we reuse
// it and leave it alone.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const require = createRequire(import.meta.url);
const VITE_URL = "http://localhost:5173";

// Vite's package.json `exports` blocks deep imports like "vite/bin/vite.js",
// but exposes "./package.json" — resolve that and build the bin path from it.
function viteBinPath() {
  return join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
}

let vite = null;

async function isUp() {
  try {
    return (await fetch(VITE_URL)).ok;
  } catch {
    return false;
  }
}

async function waitForVite() {
  for (let i = 0; i < 150; i++) {
    if (await isUp()) return true;
    await sleep(200);
  }
  return false;
}

function cleanup() {
  if (vite !== null && !vite.killed) {
    vite.kill();
    vite = null;
  }
}

async function start() {
  if (await isUp()) {
    console.log("[desktop] Vite already running — reusing :5173 (left running on exit)");
  } else {
    console.log("[desktop] starting Vite…");
    // Spawn Vite as a plain node child (single process) so .kill() is reliable.
    vite = spawn(process.execPath, [viteBinPath()], {
      stdio: "inherit",
    });
    if (!(await waitForVite())) {
      console.error("[desktop] Vite did not come up on :5173");
      cleanup();
      process.exit(1);
    }
  }

  // require("electron") in a plain node process returns the path to the binary.
  const electronPath = require("electron");
  const electron = spawn(electronPath, ["electron/main.cjs"], {
    stdio: "inherit",
  });

  electron.on("exit", (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}

start();

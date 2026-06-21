import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"
import { resolvePythonPath } from "./python-runtime.js"
import type { OtherPlayerState, HeroPositions } from "./types.js"

const INSIGHT_APP_ROOT = resolve(__dirname, "..")
const SCRIPT_PATH      = resolve(INSIGHT_APP_ROOT, "cv", "detect_players.py")
const POLL_INTERVAL_MS = 1000
const RESTART_DELAY_MS = 2000

interface RawDetection {
  heroName: string
  level:    number
  items:    string[]
}

function isClean(items: string[]): boolean {
  return items.every(name => name !== "unknown")
}

export class PlayerDetector {
  private cache    = new Map<string, OtherPlayerState>()
  private proc:    ChildProcess | null = null
  private ready    = false
  private intervalId: ReturnType<typeof setInterval> | null = null
  private stdoutBuf  = ""
  private active     = false

  private monitorNum:       number
  private getHeroPositions: () => HeroPositions

  constructor(monitorNum: number, getHeroPositions: () => HeroPositions) {
    this.monitorNum       = monitorNum
    this.getHeroPositions = getHeroPositions
  }

  start(): void {
    if (this.active) return
    this.active = true
    console.log("[PlayerDetector] Starting")
    this.spawnProcess()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.stopInterval()
    this.killProcess()
    console.log("[PlayerDetector] Stopped")
  }

  reset(): void {
    this.stop()
    this.cache.clear()
  }

  getOtherPlayers(): OtherPlayerState[] {
    return Array.from(this.cache.values())
  }

  // ── process lifecycle ──────────────────────────────────────────────────────

  private spawnProcess(): void {
    const pythonPath = resolvePythonPath()
    if (!pythonPath) {
      console.error("[PlayerDetector] Python not found")
      return
    }

    console.log("[PlayerDetector] Spawning Python process...")
    this.ready     = false
    this.stdoutBuf = ""

    const proc = spawn(
      pythonPath,
      ["-u", SCRIPT_PATH, "--monitor", String(this.monitorNum), "--watch"],
      { stdio: ["pipe", "pipe", "pipe"], cwd: resolve(INSIGHT_APP_ROOT, "cv") },
    )

    proc.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuf += chunk.toString("utf-8")
      const lines     = this.stdoutBuf.split("\n")
      this.stdoutBuf  = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) this.handleLine(trimmed)
      }
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf-8").trim()
      if (msg) console.log("[PlayerDetector]", msg)
    })

    proc.on("exit", (code) => {
      console.log(`[PlayerDetector] Process exited (code ${code})`)
      this.proc  = null
      this.ready = false
      this.stopInterval()
      if (this.active) {
        console.log(`[PlayerDetector] Restarting in ${RESTART_DELAY_MS}ms...`)
        setTimeout(() => { if (this.active) this.spawnProcess() }, RESTART_DELAY_MS)
      }
    })

    proc.on("error", (err) => {
      console.error("[PlayerDetector] Process error:", err.message)
    })

    this.proc = proc
  }

  private killProcess(): void {
    if (!this.proc) return
    this.proc.removeAllListeners()
    this.proc.kill()
    this.proc  = null
    this.ready = false
  }

  // ── polling ────────────────────────────────────────────────────────────────

  private startInterval(): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => this.trigger(), POLL_INTERVAL_MS)
  }

  private stopInterval(): void {
    if (!this.intervalId) return
    clearInterval(this.intervalId)
    this.intervalId = null
  }

  private trigger(): void {
    if (!this.proc || !this.ready) return
    this.proc.stdin?.write("\n")
  }

  // ── output handling ────────────────────────────────────────────────────────

  private handleLine(line: string): void {
    if (line === "READY") {
      console.log("[PlayerDetector] Templates loaded, polling started")
      this.ready = true
      this.startInterval()
      return
    }

    if (line === "null") return

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("heroName" in parsed) ||
      !("level"    in parsed) ||
      !("items"    in parsed)
    ) return

    const raw = parsed as RawDetection
    if (!isClean(raw.items)) {
      console.log(`[PlayerDetector] ${raw.heroName}: skipped (unknown items)`)
      return
    }

    const positions = this.getHeroPositions()
    const posKey    = `npc_dota_hero_${raw.heroName}`
    const heroPos   = positions[posKey]
    const team      = heroPos?.team ?? "radiant"
    const teamKeys  = Object.keys(positions)
      .filter(k => positions[k]?.team === team)
      .sort()
    const slot = Math.max(0, teamKeys.indexOf(posKey))

    const state: OtherPlayerState = {
      heroName: raw.heroName,
      team,
      slot,
      level: raw.level,
      items: raw.items,
    }

    this.cache.set(raw.heroName, state)
    const itemList = raw.items.filter(i => i !== "empty").join(", ") || "—"
    console.log(`[PlayerDetector] ${raw.heroName} lvl${raw.level} [${team}] — ${itemList}`)
  }
}

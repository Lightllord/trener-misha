import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { resolvePythonPath } from "./python-runtime.js"
import type { DraftState } from "./types.js"

const INSIGHT_APP_ROOT = resolve(__dirname, "..")
const SCRIPT_PATH = resolve(INSIGHT_APP_ROOT, "cv", "detect_draft.py")

const POLL_INTERVAL_MS = 2000

/** Опрашивает detect_draft.py раз в 2 с пока идёт hero_selection. */
export type DraftChangeListener = (draft: DraftState) => void

export class DraftDetector {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private detecting = false
  private draft: DraftState | null = null
  private monitorNum: number | "auto"
  private changeListeners: DraftChangeListener[] = []

  // "auto" → Python сам находит монитор с окном Доты (см. cv/screen.py);
  // число — ручная фиксация конкретного монитора.
  constructor(monitorNum: number | "auto" = "auto") {
    this.monitorNum = monitorNum
  }

  onDraftChange(listener: DraftChangeListener): void {
    this.changeListeners.push(listener)
  }

  get current(): DraftState | null {
    return this.draft
  }

  start(): void {
    if (this.intervalId) {
      console.log("[DraftDetector] Already polling, skipping start")
      return
    }
    console.log("[DraftDetector] Starting draft polling every 2s")
    void this.runDetection()
    this.intervalId = setInterval(() => { void this.runDetection() }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (!this.intervalId) return
    console.log("[DraftDetector] Stopping draft polling")
    clearInterval(this.intervalId)
    this.intervalId = null
  }

  reset(): void {
    this.stop()
    this.draft = null
  }

  private async runDetection(): Promise<void> {
    if (this.detecting) {
      console.log("[DraftDetector] Detection in progress, skipping tick")
      return
    }
    this.detecting = true
    try {
      const output = await this.spawnDetection()
      for (const line of output.split("\n")) {
        const trimmed = line.trim()
        if (trimmed) this.handleDetection(trimmed)
      }
    } catch (err) {
      console.error("[DraftDetector] Detection failed:", err instanceof Error ? err.message : err)
    } finally {
      this.detecting = false
    }
  }

  private spawnDetection(): Promise<string> {
    const pythonPath = resolvePythonPath()
    return new Promise((done, fail) => {
      let stdout = ""
      const proc = spawn(pythonPath, [
        "-u", SCRIPT_PATH, "--monitor", String(this.monitorNum),
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: resolve(INSIGHT_APP_ROOT, "cv"),
      })
      proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8") })
      proc.stderr?.on("data", (chunk: Buffer) => {
        const msg = chunk.toString("utf-8").trim()
        if (msg) console.log("[DraftDetector]", msg)
      })
      proc.on("exit", () => done(stdout))
      proc.on("error", fail)
    })
  }

  private handleDetection(jsonLine: string): void {
    try {
      const parsed: unknown = JSON.parse(jsonLine)
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("radiant" in parsed) ||
        !("dire" in parsed)
      ) {
        return
      }

      const raw = parsed as { radiant: string[]; dire: string[]; confidence: number[] }

      this.draft = {
        radiant: raw.radiant,
        dire: raw.dire,
        confidence: raw.confidence,
        detectedAt: new Date().toISOString(),
      }

      console.log(
        "[DraftDetector] Draft detected:",
        `Radiant: ${raw.radiant.join(", ")} | Dire: ${raw.dire.join(", ")}`,
      )

      for (const listener of this.changeListeners) {
        try {
          listener(this.draft)
        } catch (err) {
          console.error("[DraftDetector] Listener error:", err)
        }
      }
    } catch {
      console.error("[DraftDetector] Failed to parse JSON:", jsonLine.slice(0, 100))
    }
  }
}

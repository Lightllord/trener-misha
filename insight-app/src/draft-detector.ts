import { spawn, type ChildProcess } from "node:child_process"
import { writeFile, unlink } from "node:fs/promises"
import { resolve } from "node:path"

const PROJECT_ROOT = resolve(__dirname, "..", "..")
const SCRIPT_PATH = resolve(PROJECT_ROOT, "cv", "detect_draft.py")
const DRAFT_FILE = resolve(PROJECT_ROOT, "backend", "data", "draft.json")

export interface DraftResult {
  radiant: string[]
  dire: string[]
  confidence: number[]
  detectedAt: string
}

/**
 * Управляет запуском detect_draft.py --watch.
 * Запускается при смене фазы на pre_game, останавливается при выходе из матча.
 */
export class DraftDetector {
  private process: ChildProcess | null = null
  private draft: DraftResult | null = null
  private monitorNum: number

  constructor(monitorNum = 2) {
    this.monitorNum = monitorNum
  }

  /** Текущий драфт (null если ещё не определён) */
  get current(): DraftResult | null {
    return this.draft
  }

  /** Запустить watch-режим detect_draft.py */
  start(): void {
    if (this.process) {
      console.log("[DraftDetector] Already running, skipping start")
      return
    }

    console.log("[DraftDetector] Starting detect_draft.py --watch")
    console.log("[DraftDetector] Script path:", SCRIPT_PATH)
    console.log("[DraftDetector] Monitor:", this.monitorNum)

    this.process = spawn("python", [
      "-u",
      SCRIPT_PATH,
      "--watch",
      "--monitor", String(this.monitorNum),
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: resolve(PROJECT_ROOT, "cv"),
    })

    let buffer = ""

    this.process.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8")

      // Каждая строка stdout — JSON-результат детекции
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.handleDetection(trimmed)
      }
    })

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf-8").trim()
      if (msg) console.log("[DraftDetector]", msg)
    })

    this.process.on("exit", (code) => {
      console.log(`[DraftDetector] Process exited with code ${code}`)
      this.process = null
    })

    this.process.on("error", (err) => {
      console.error("[DraftDetector] Failed to start process:", err.message)
      this.process = null
    })
  }

  /** Остановить watch-процесс */
  stop(): void {
    if (!this.process) return
    console.log("[DraftDetector] Stopping")
    this.process.kill()
    this.process = null
  }

  /** Сбросить данные драфта (новый матч) */
  reset(): void {
    this.stop()
    this.draft = null
    unlink(DRAFT_FILE).catch(() => {})
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

      // Сохраняем в файл
      writeFile(DRAFT_FILE, JSON.stringify(this.draft, null, 2), "utf-8")
        .then(() => console.log("[DraftDetector] Saved to", DRAFT_FILE))
        .catch((err) => console.error("[DraftDetector] Failed to save:", err.message))
    } catch {
      console.error("[DraftDetector] Failed to parse JSON:", jsonLine.slice(0, 100))
    }
  }
}

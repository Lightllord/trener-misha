import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const INSIGHT_APP_ROOT = resolve(__dirname, "..")
const VENV_PYTHON = resolve(
  INSIGHT_APP_ROOT,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
)

const REQUIRED_MAJOR = 3
const REQUIRED_MIN_MINOR = 12
const REQUIRED_MAX_MINOR = 14

export interface PythonInfo {
  path: string
  source: "venv" | "system"
  version: string
  versionOk: boolean
}

export function resolvePythonPath(): string {
  return existsSync(VENV_PYTHON) ? VENV_PYTHON : "python"
}

export async function probePython(): Promise<PythonInfo | null> {
  const candidates: ReadonlyArray<readonly [string, "venv" | "system"]> = [
    [VENV_PYTHON, "venv"],
    ["python", "system"],
  ]

  for (const [path, source] of candidates) {
    if (source === "venv" && !existsSync(path)) continue
    const version = await readVersion(path)
    if (!version) continue
    return { path, source, version, versionOk: isCompatible(version) }
  }
  return null
}

async function readVersion(executable: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, ["--version"])
    const match = `${stdout}\n${stderr}`.match(/Python\s+(\d+\.\d+\.\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function isCompatible(version: string): boolean {
  const parts = version.split(".").map((n) => Number(n))
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return false
  const [maj, min] = parts
  return maj === REQUIRED_MAJOR && min >= REQUIRED_MIN_MINOR && min <= REQUIRED_MAX_MINOR
}

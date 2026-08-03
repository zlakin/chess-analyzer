import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function resolveBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const baseDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(baseDir, 'vendor', 'stockfish', binaryName)
}

export function getStockfishBinaryPath(): string {
  const path = resolveBinaryPath()
  // Without this check the missing binary surfaces as an ENOENT from spawn deep
  // inside an analysis run, which reads as an engine crash rather than a setup
  // step nobody ran. Fail here instead, naming the command that fixes it.
  if (!existsSync(path)) {
    throw new Error(
      `Stockfish is not installed at ${path}. Run "npm run setup:stockfish" to download it.`
    )
  }
  return path
}

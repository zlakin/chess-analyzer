import { app } from 'electron'
import { join } from 'node:path'

export function getStockfishBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const baseDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(baseDir, 'vendor', 'stockfish', binaryName)
}

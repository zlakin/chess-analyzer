import { app } from 'electron'
import { join } from 'node:path'

export function getStockfishBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  return join(app.getAppPath(), 'vendor', 'stockfish', binaryName)
}

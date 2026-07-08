import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AnalyzedPosition } from '../../shared/types'
import { StockfishManager } from '../engine/stockfishManager'
import { getStockfishBinaryPath } from '../engine/stockfishPath'
import { analyzeGame } from '../analysis/gameAnalyzer'
import { fetchRecentGames, ChessComFetchError } from '../chesscom/chessComClient'

const ANALYSIS_DEPTH_DEFAULT = 18

let cancelCurrentAnalysis = false

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    IPC_CHANNELS.analyzeGame,
    async (_event, positions: AnalyzedPosition[], depth: number) => {
      cancelCurrentAnalysis = false
      const engine = new StockfishManager(getStockfishBinaryPath())

      try {
        await engine.start()
      } catch (err) {
        return { error: `Could not start Stockfish: ${(err as Error).message}` }
      }

      try {
        return await analyzeGame(positions, engine, {
          depth: depth || ANALYSIS_DEPTH_DEFAULT,
          isCancelled: () => cancelCurrentAnalysis,
          onMove: (move) => {
            getWindow()?.webContents.send(IPC_CHANNELS.analysisProgress, move)
          }
        })
      } catch (err) {
        return { error: `Analysis failed: ${(err as Error).message}` }
      } finally {
        engine.stop()
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.cancelAnalysis, () => {
    cancelCurrentAnalysis = true
  })

  ipcMain.handle(IPC_CHANNELS.openPgnFile, async () => {
    const window = getWindow()
    if (!window) return { cancelled: true }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'PGN files', extensions: ['pgn'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }

    try {
      const pgn = await readFile(result.filePaths[0], 'utf-8')
      return { pgn }
    } catch (err) {
      return { error: `Could not read file: ${(err as Error).message}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.fetchChessComGames, async (_event, username: string) => {
    try {
      return await fetchRecentGames(username)
    } catch (err) {
      if (err instanceof ChessComFetchError) return { error: err.message }
      return { error: `Unexpected error: ${(err as Error).message}` }
    }
  })
}

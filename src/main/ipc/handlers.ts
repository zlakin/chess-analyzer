import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AnalyzedPosition } from '../../shared/types'
import { StockfishManager } from '../engine/stockfishManager'
import { getStockfishBinaryPath } from '../engine/stockfishPath'
import { analyzeGame } from '../analysis/gameAnalyzer'
import { fetchRecentGames, ChessComFetchError } from '../chesscom/chessComClient'
import { AnalysisRunTracker } from './analysisRunTracker'

const ANALYSIS_DEPTH_DEFAULT = 18

// Per-run cancellation state, not a single shared boolean: without this, a
// cancel request racing against a newly-started analysis invocation could be
// silently erased (see AnalysisRunTracker for details).
const analysisRuns = new AnalysisRunTracker()

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    IPC_CHANNELS.analyzeGame,
    async (_event, positions: AnalyzedPosition[], depth: number) => {
      const runId = analysisRuns.start()
      const engine = new StockfishManager(getStockfishBinaryPath())

      try {
        await engine.start()
      } catch (err) {
        return { error: `Could not start Stockfish: ${(err as Error).message}` }
      }

      try {
        return await analyzeGame(positions, engine, {
          depth: depth || ANALYSIS_DEPTH_DEFAULT,
          isCancelled: () => analysisRuns.isCancelled(runId),
          onMove: (move) => {
            getWindow()?.webContents.send(IPC_CHANNELS.analysisProgress, move)
          }
        })
      } catch (err) {
        return { error: `Analysis failed: ${(err as Error).message}` }
      } finally {
        engine.stop()
        analysisRuns.finish(runId)
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.cancelAnalysis, () => {
    analysisRuns.cancelCurrent()
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

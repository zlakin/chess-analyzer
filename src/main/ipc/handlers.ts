import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AnalyzedPosition } from '../../shared/types'
import { StockfishManager } from '../engine/stockfishManager'
import { getStockfishBinaryPath } from '../engine/stockfishPath'
import { analyzeGame } from '../analysis/gameAnalyzer'
import { fetchRecentGames, ChessComFetchError } from '../chesscom/chessComClient'
import { loadSettings } from '../settings/settingsStore'
import { AnalysisRunTracker } from './analysisRunTracker'
import { runScan } from '../insights/scanRunner'
import { loadAllGameRecords, loadScanMeta } from '../insights/insightsStore'
import { buildInsightsReport } from '../insights/reportAggregator'
import { synthesizeTopFindings } from '../insights/topFindings'

const ANALYSIS_DEPTH_DEFAULT = 18

// Per-run cancellation state, not a single shared boolean: without this, a
// cancel request racing against a newly-started analysis invocation could be
// silently erased (see AnalysisRunTracker for details).
const analysisRuns = new AnalysisRunTracker()
const scanRuns = new AnalysisRunTracker()

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    IPC_CHANNELS.analyzeGame,
    async (_event, positions: AnalyzedPosition[], depth: number) => {
      const runId = analysisRuns.start()
      const engine = new StockfishManager(getStockfishBinaryPath())

      // The whole handler body runs under a single top-level try/finally so
      // that analysisRuns.finish(runId) always runs once the run has
      // settled -- including when engine.start() itself throws (e.g. the
      // Stockfish binary is missing) -- otherwise the run's entry lingers
      // forever in AnalysisRunTracker's internal map.
      try {
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
        }
      } finally {
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

  ipcMain.handle(IPC_CHANNELS.getSettings, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.scanChessComGames, async () => {
    const settings = loadSettings()
    const username = settings.linkedAccount?.username
    if (!username) {
      return { error: 'Connect your chess.com account first.' }
    }

    const runId = scanRuns.start()
    try {
      return await runScan(username, {
        isCancelled: () => scanRuns.isCancelled(runId),
        createEngine: () => new StockfishManager(getStockfishBinaryPath()),
        onProgress: (progress) => {
          getWindow()?.webContents.send(IPC_CHANNELS.scanProgress, progress)
        }
      })
    } catch (err) {
      return { error: `Scan failed: ${(err as Error).message}` }
    } finally {
      scanRuns.finish(runId)
    }
  })

  ipcMain.on(IPC_CHANNELS.cancelScan, () => {
    scanRuns.cancelCurrent()
  })

  ipcMain.handle(IPC_CHANNELS.getInsightsReport, async () => {
    const records = loadAllGameRecords()
    const meta = loadScanMeta()
    const partialReport = buildInsightsReport(records, meta.lastScanTime)
    return { ...partialReport, topFindings: synthesizeTopFindings(partialReport) }
  })
}

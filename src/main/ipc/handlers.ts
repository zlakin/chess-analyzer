import { ipcMain, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AnalyzedPosition, Theme } from '../../shared/types'
import { StockfishManager } from '../engine/stockfishManager'
import { getStockfishBinaryPath } from '../engine/stockfishPath'
import { evaluateExplorationPosition } from '../engine/explorationEngine'
import { createEnginePool, poolSize } from '../engine/enginePool'
import type { EnginePool } from '../engine/enginePool'
import { analyzeGame } from '../analysis/gameAnalyzer'
import { fetchRecentGames, fetchPlayerStats, ChessComFetchError } from '../chesscom/chessComClient'
import { loadSettings, saveSettings } from '../settings/settingsStore'
import { startLink, verifyLink, disconnectAccount } from '../chesscom/accountLink'
import { AnalysisRunTracker } from './analysisRunTracker'
import { runScan } from '../insights/scanRunner'
import {
  ensureSchemaVersion,
  isSchemaStale,
  loadAllGameRecords,
  loadGameRecord,
  loadScanMeta
} from '../insights/insightsStore'
import { buildInsightsReport } from '../insights/reportAggregator'
import { synthesizeTopFindings } from '../insights/topFindings'
import { loadSrsState, saveSrsState } from '../srs/srsStore'
import { newCardState, nextCardState } from '../srs/sm2'
import { buildMasteryTree, buildNodeQueue } from '../srs/masteryQueue'
import { loadMasteryState, saveMasteryState } from '../srs/masteryStore'
import { nodeProgress, nextMasteryProgress, resolveMistakeCredit } from '../srs/masteryTree'
import { loadPuzzleStats, savePuzzleStats } from '../srs/puzzleStatsStore'
import { nextPuzzleStats, localDateString } from '../srs/puzzleRating'
import type { MasteryNodeKey, MistakeDetail, PuzzleOutcome, SrsQuality } from '../../shared/types'

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

      // The whole handler body runs under a single top-level try/finally so
      // that analysisRuns.finish(runId) always runs once the run has
      // settled -- including when pool startup itself throws (e.g. the
      // Stockfish binary is missing) -- otherwise the run's entry lingers
      // forever in AnalysisRunTracker's internal map.
      try {
        let pool: EnginePool
        try {
          pool = await createEnginePool(poolSize(cpus().length), () => new StockfishManager(getStockfishBinaryPath()))
        } catch (err) {
          return { error: `Could not start Stockfish: ${(err as Error).message}` }
        }

        try {
          return await analyzeGame(positions, pool, {
            depth: depth || ANALYSIS_DEPTH_DEFAULT,
            isCancelled: () => analysisRuns.isCancelled(runId),
            onMove: (move) => {
              getWindow()?.webContents.send(IPC_CHANNELS.analysisProgress, move)
            }
          })
        } catch (err) {
          return { error: `Analysis failed: ${(err as Error).message}` }
        } finally {
          pool.stop()
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

  ipcMain.handle(IPC_CHANNELS.fetchChessComStats, async (_event, username: string) => {
    try {
      return await fetchPlayerStats(username)
    } catch (err) {
      if (err instanceof ChessComFetchError) return { error: err.message }
      return { error: `Unexpected error: ${(err as Error).message}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.getSettings, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.setTheme, async (_event, theme: Theme) => {
    saveSettings({ theme })
  })

  ipcMain.handle(IPC_CHANNELS.evaluatePosition, async (_event, fen: string, depth: number) => {
    return evaluateExplorationPosition(fen, depth)
  })

  ipcMain.handle(IPC_CHANNELS.startAccountLink, async (_event, username: string) => {
    return startLink(username)
  })

  ipcMain.handle(IPC_CHANNELS.verifyAccountLink, async () => {
    return verifyLink()
  })

  ipcMain.handle(IPC_CHANNELS.disconnectAccount, async () => {
    disconnectAccount()
  })

  ipcMain.handle(IPC_CHANNELS.openChessComProfileSettings, async () => {
    await shell.openExternal('https://www.chess.com/settings/profile')
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
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const meta = loadScanMeta()
    const partialReport = buildInsightsReport(records, meta.lastScanTime)
    return { ...partialReport, topFindings: synthesizeTopFindings(partialReport), staleSchema: isSchemaStale() }
  })

  ipcMain.handle(
    IPC_CHANNELS.getMistakeDetail,
    async (_event, gameUrl: string, ply: number): Promise<MistakeDetail | null> => {
      ensureSchemaVersion()
      const record = loadGameRecord(gameUrl)
      const mistake = record?.mistakes.find((m) => m.ply === ply)
      if (!record || !mistake) return null

      const masteryState = loadMasteryState()
      return {
        fenBefore: mistake.fenBefore,
        bestMoveUci: mistake.bestMoveUci,
        classification: mistake.classification,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics,
        userColor: record.userColor,
        cardId: `${gameUrl}#${ply}`,
        nodeKey: resolveMistakeCredit(masteryState, mistake.missedTactics, mistake.punishedByTactics)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.getMasteryTree, async () => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const masteryState = loadMasteryState()
    const srsState = loadSrsState()
    return buildMasteryTree(records, masteryState, srsState, Date.now())
  })

  ipcMain.handle(IPC_CHANNELS.getNodeQueue, async (_event, key: MasteryNodeKey) => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const masteryState = loadMasteryState()
    const srsState = loadSrsState()
    return buildNodeQueue(key, records, masteryState, srsState, Date.now())
  })

  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleReview,
    async (_event, cardId: string, quality: SrsQuality) => {
      const now = Date.now()
      const srsState = loadSrsState()
      const current = srsState[cardId] ?? newCardState(cardId, now)
      const updated = nextCardState(current, quality, now)
      saveSrsState({ ...srsState, [cardId]: updated })
      return updated
    }
  )

  ipcMain.handle(IPC_CHANNELS.getPuzzleStats, async () => {
    // solvedToday is only ever rolled over on a write, so a returning user
    // would otherwise see yesterday's count until their first solve today.
    // Normalize on read, deliberately without writing back - the persisted
    // lastSolvedDate is what the next write needs to compare against.
    const stats = loadPuzzleStats()
    return stats.lastSolvedDate === localDateString(Date.now())
      ? stats
      : { ...stats, solvedToday: 0 }
  })

  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleOutcome,
    async (
      _event,
      outcome: PuzzleOutcome,
      classification: 'mistake' | 'blunder',
      nodeKey: MasteryNodeKey | null
    ) => {
      const stats = loadPuzzleStats()
      const updatedStats = nextPuzzleStats(stats, outcome, classification, Date.now())
      savePuzzleStats(updatedStats)

      if (!nodeKey) {
        return { stats: updatedStats, nodeProgress: null }
      }

      const masteryState = loadMasteryState()
      const updatedProgress = nextMasteryProgress(nodeProgress(masteryState, nodeKey), outcome)
      saveMasteryState({ ...masteryState, [nodeKey]: updatedProgress })

      return { stats: updatedStats, nodeProgress: updatedProgress }
    }
  )
}

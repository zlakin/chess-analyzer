import type { ScanOutcome, ScanProgress } from '../../shared/types'
import { fetchRecentGames } from '../chesscom/chessComClient'
import { parsePgn } from '../../shared/pgn'
import { analyzeGame, type EvaluationEngine } from '../analysis/gameAnalyzer'
import { extractInsightRecord } from './extractInsightRecord'
import { ensureUsernameScope, isGameScanned, saveGameRecord, saveScanMeta } from './insightsStore'

const SCAN_GAME_LIMIT = 100
const SCAN_ANALYSIS_DEPTH = 14

export interface ScanRunnerOptions {
  isCancelled?: () => boolean
  onProgress?: (progress: ScanProgress) => void
  createEngine: () => EvaluationEngine & { start: () => Promise<void>; stop: () => void }
}

export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  ensureUsernameScope(username)

  const games = await fetchRecentGames(username, SCAN_GAME_LIMIT)
  const newGames = games.filter((game) => !isGameScanned(game.url))

  options.onProgress?.({ scanned: 0, total: newGames.length })

  if (newGames.length === 0) {
    saveScanMeta({ username, lastScanTime: Date.now() })
    return { scanned: 0 }
  }

  const engine = options.createEngine()
  try {
    await engine.start()
  } catch (err) {
    engine.stop()
    return { error: `Could not start Stockfish: ${(err as Error).message}` }
  }

  let scanned = 0
  try {
    for (const game of newGames) {
      if (options.isCancelled?.()) return { cancelled: true }

      // A malformed PGN is a per-game data problem -- skip just this game
      // and keep going. An analyzeGame failure below is NOT caught here on
      // purpose: it almost always means the shared Stockfish engine itself
      // died, in which case every remaining game would fail too, so it's
      // better to propagate and abort the scan (caught by the IPC handler
      // in Task 13, surfaced as a clear error) than to silently burn
      // through the rest of the list logging one failure per game.
      let positions
      try {
        positions = parsePgn(game.pgn)
      } catch (err) {
        console.error(`Skipping game ${game.url}: could not parse PGN`, err)
        scanned += 1
        options.onProgress?.({ scanned, total: newGames.length })
        continue
      }

      const result = await analyzeGame(positions, engine, {
        depth: SCAN_ANALYSIS_DEPTH,
        isCancelled: options.isCancelled
      })
      if ('cancelled' in result) return { cancelled: true }

      saveGameRecord(extractInsightRecord(game, result, username))
      scanned += 1
      options.onProgress?.({ scanned, total: newGames.length })
    }
  } finally {
    engine.stop()
  }

  saveScanMeta({ username, lastScanTime: Date.now() })
  return { scanned }
}

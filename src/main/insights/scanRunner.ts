import type { ScanOutcome, ScanProgress } from '../../shared/types'
import { fetchRecentGames } from '../chesscom/chessComClient'
import { parsePgn } from '../../shared/pgn'
import { analyzeGame, type EvaluationEngine } from '../analysis/gameAnalyzer'
import { extractInsightRecord } from './extractInsightRecord'
import { ensureSchemaVersion, ensureUsernameScope, isGameScanned, saveGameRecord, saveScanMeta } from './insightsStore'

const SCAN_GAME_LIMIT = 100
const SCAN_ANALYSIS_DEPTH = 14

export interface ScanRunnerOptions {
  isCancelled?: () => boolean
  onProgress?: (progress: ScanProgress) => void
  createEngine: () => EvaluationEngine & { start: () => Promise<void>; stop: () => void }
}

// analyzeGame (Task 2) now dispatches every position in a game concurrently,
// but scanRunner reuses a single raw engine instance (in production, a bare
// StockfishManager with no per-call request identity - see
// explorationEngine.ts's comment on the same hazard) across the entire
// scan's worth of games. Wrapping it here serializes every call issued
// through analyzeGame so at most one evaluatePosition is ever in flight
// against the underlying engine at a time, keeping this exactly as safe as
// the old sequential analyzeGame loop was. Mirrors the promise-chain idiom
// explorationEngine.ts already uses for its own shared-engine queue.
function serialized(engine: EvaluationEngine): EvaluationEngine {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    evaluatePosition(fen, options) {
      const result = queue.then(() => engine.evaluatePosition(fen, options))
      // Keep the queue chain itself always-resolved regardless of this
      // call's outcome, so a failed call doesn't permanently break every
      // later call chained after it.
      queue = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  }
}

export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  ensureSchemaVersion()
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

  // Only the value passed to analyzeGame is serialized - .start()/.stop()
  // still go directly to the raw engine.
  const analysisEngine = serialized(engine)

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

      const result = await analyzeGame(positions, analysisEngine, {
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

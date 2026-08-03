import type { ScanOutcome, ScanProgress } from '../../shared/types'
import { fetchRecentGames } from '../chesscom/chessComClient'
import { parsePgn } from '../../shared/pgn'
import { analyzeGame } from '../analysis/gameAnalyzer'
import type { EnginePool } from '../engine/enginePool'
import { extractInsightRecord } from './extractInsightRecord'
import {
  ensureSchemaVersion,
  ensureUsernameScope,
  isGameScanned,
  saveGameRecord,
  saveScanMeta,
  SCAN_GAME_LIMIT
} from './insightsStore'

const SCAN_ANALYSIS_DEPTH = 14

export interface ScanRunnerOptions {
  isCancelled?: () => boolean
  onProgress?: (progress: ScanProgress) => void
  createPool: () => Promise<EnginePool>
}

export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  ensureSchemaVersion()
  ensureUsernameScope(username)

  const games = await fetchRecentGames(username, SCAN_GAME_LIMIT)
  const newGames = games.filter((game) => !isGameScanned(game.url))

  options.onProgress?.({ scanned: 0, total: newGames.length, etaMs: null })

  if (newGames.length === 0) {
    saveScanMeta({ username, lastScanTime: Date.now() })
    return { scanned: 0 }
  }

  let pool: EnginePool
  try {
    pool = await options.createPool()
  } catch (err) {
    return { error: `Could not start Stockfish: ${(err as Error).message}` }
  }

  const startedAt = Date.now()
  let scanned = 0

  // Shared by both call sites below so the scanned/elapsed -> etaMs
  // extrapolation is defined exactly once; scanned is always >= 1 here
  // because this only ever runs after the increment immediately above
  // each call, so there is always at least one completed game to
  // extrapolate the remaining time from.
  const reportProgress = (): void => {
    const elapsed = Date.now() - startedAt
    options.onProgress?.({
      scanned,
      total: newGames.length,
      etaMs: Math.round((elapsed / scanned) * (newGames.length - scanned))
    })
  }

  try {
    for (const game of newGames) {
      if (options.isCancelled?.()) return { cancelled: true }

      // A malformed PGN is a per-game data problem -- skip just this game
      // and keep going. An analyzeGame failure below is NOT caught here on
      // purpose: it almost always means an engine in the pool died, in
      // which case every remaining game would fail too, so it's better to
      // propagate and abort the scan (caught by the IPC handler in Task
      // 13, surfaced as a clear error) than to silently burn through the
      // rest of the list logging one failure per game.
      let positions
      try {
        positions = parsePgn(game.pgn)
      } catch (err) {
        console.error(`Skipping game ${game.url}: could not parse PGN`, err)
        scanned += 1
        reportProgress()
        continue
      }

      const result = await analyzeGame(positions, pool, {
        depth: SCAN_ANALYSIS_DEPTH,
        isCancelled: options.isCancelled
      })
      if ('cancelled' in result) return { cancelled: true }

      saveGameRecord(extractInsightRecord(game, result, username))
      scanned += 1
      reportProgress()
    }
  } finally {
    pool.stop()
  }

  saveScanMeta({ username, lastScanTime: Date.now() })
  return { scanned }
}

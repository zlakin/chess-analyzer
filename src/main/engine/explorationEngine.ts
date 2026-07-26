import { spawn } from 'node:child_process'
import { StockfishManager } from './stockfishManager'
import type { SpawnFn } from './stockfishManager'
import { getStockfishBinaryPath } from './stockfishPath'
import type { PositionEvaluation } from '../../shared/types'

let engine: StockfishManager | null = null
let starting: Promise<StockfishManager> | null = null

async function getEngine(spawnFn: SpawnFn): Promise<StockfishManager> {
  if (engine) return engine
  if (!starting) {
    starting = (async () => {
      const instance = new StockfishManager(getStockfishBinaryPath(), spawnFn)
      await instance.start()
      engine = instance
      return instance
    })()
  }
  return starting
}

// StockfishManager's pendingLineHandlers is a shared, unscoped array (see
// stockfishManager.ts) - it has no per-call request identity, so if two
// evaluatePosition calls against the SAME instance were genuinely
// concurrent, a single incoming "bestmove" line could resolve both
// pending calls at once, each having accumulated whatever info lines
// arrived from either request - silent cross-contamination, not just a
// race on staleness. The renderer hook (Task 2) fires a fresh call on
// every position change, which will overlap in flight if the user moves
// again before the previous evaluation resolves - so calls against the
// shared engine must be serialized here, at the one place that owns the
// shared resource, rather than relying on every caller to avoid
// overlapping (which the hook's own stale-response guard does NOT do -
// it only discards an old result after the fact, it doesn't prevent two
// calls from executing at once).
let queue: Promise<unknown> = Promise.resolve()

export async function evaluateExplorationPosition(
  fen: string,
  depth: number,
  spawnFn: SpawnFn = spawn as SpawnFn
): Promise<PositionEvaluation | { error: string }> {
  const run = async (): Promise<PositionEvaluation | { error: string }> => {
    try {
      const instance = await getEngine(spawnFn)
      return await instance.evaluatePosition(fen, { depth })
    } catch (err) {
      // The persistent engine died (crashed, killed) - drop the cached
      // reference so the next call starts a fresh one instead of retrying
      // a dead process forever.
      engine = null
      starting = null
      return { error: `Could not evaluate position: ${(err as Error).message}` }
    }
  }

  const result = queue.then(run, run)
  // Keep the queue chain itself always-resolved (never a rejected
  // promise) regardless of this call's outcome, so a failed call doesn't
  // permanently break every later call chained after it - `run` already
  // catches internally and always resolves, this just future-proofs the
  // chain against that invariant ever changing.
  queue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function stopExplorationEngine(): void {
  engine?.stop()
  engine = null
  starting = null
}

// Exposed only so tests can reset module-level state between cases,
// matching the pattern already used in accountLink.ts's
// __resetPendingChallengeForTests.
export function __resetExplorationEngineForTests(): void {
  engine = null
  starting = null
}

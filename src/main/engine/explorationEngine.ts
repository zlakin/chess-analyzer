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

export async function evaluateExplorationPosition(
  fen: string,
  depth: number,
  spawnFn: SpawnFn = spawn as SpawnFn
): Promise<PositionEvaluation | { error: string }> {
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

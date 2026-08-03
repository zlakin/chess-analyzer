import type { PositionEvaluation } from '../../shared/types'

export interface PooledEngine {
  start(): Promise<void>
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

export interface EnginePool {
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

// Each pooled engine runs single-threaded on purpose: parallelism comes from
// running `size` of them across different positions, which scales better than
// one engine searching one position on many threads.
const MAX_POOL_SIZE = 12
const POOL_HASH_BUDGET_MB = 1024

export function poolSize(cpuCount: number): number {
  return Math.max(1, Math.min(MAX_POOL_SIZE, cpuCount - 2))
}

export function poolHashMb(size: number): number {
  return Math.max(16, Math.min(256, Math.floor(POOL_HASH_BUDGET_MB / Math.max(1, size))))
}

export async function createEnginePool(
  size: number,
  createEngine: () => PooledEngine
): Promise<EnginePool> {
  const engines = Array.from({ length: size }, () => createEngine())
  try {
    await Promise.all(engines.map((engine) => engine.start()))
  } catch (err) {
    // A partial failure (per-user process limits, EAGAIN, memory pressure) would
    // otherwise leave the engines that *did* start as orphaned OS processes with
    // no handle for the caller to clean them up.
    for (const engine of engines) engine.stop()
    throw err
  }

  const idle: PooledEngine[] = [...engines]
  const waiters: Array<(engine: PooledEngine) => void> = []

  function acquire(): Promise<PooledEngine> {
    const engine = idle.pop()
    if (engine) return Promise.resolve(engine)
    return new Promise((resolve) => {
      waiters.push(resolve)
    })
  }

  // Hands the released engine directly to the oldest waiter if one exists,
  // rather than returning it to `idle` first - keeps a FIFO ordering on
  // queued callers instead of first-come-first-served-by-luck.
  function release(engine: PooledEngine): void {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(engine)
      return
    }
    idle.push(engine)
  }

  return {
    async evaluatePosition(fen, options) {
      const engine = await acquire()
      try {
        return await engine.evaluatePosition(fen, options)
      } finally {
        release(engine)
      }
    },
    stop() {
      for (const engine of engines) engine.stop()
    }
  }
}

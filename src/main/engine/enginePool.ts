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

// Divided across the pool below, so this is the pool-wide hash total rather
// than a per-engine figure. It is a fixed number that never consults how much
// RAM the machine actually has, so it has to be safe on the smallest box that
// runs this app: the previous 1024 reserved ~1 GB on every machine regardless.
// Shrinking it costs no search speed -- the design spec measured 16 MB / 1
// thread at 1,849,243 nps against 256 MB / 1 thread at 1,779,859, i.e. the
// smaller table was if anything faster on the short searches a pooled engine
// runs.
const POOL_HASH_BUDGET_MB = 256

export function poolSize(cpuCount: number): number {
  return Math.max(1, Math.min(MAX_POOL_SIZE, cpuCount - 2))
}

// No upper clamp: the budget is the whole allocation, so a one-engine pool
// getting all of it is the intended maximum. The 16 MB floor and the
// Math.max(1, size) guard are unreachable from production (poolSize clamps to
// [1, 12]) and are kept only as defence in depth for a hand-built pool.
export function poolHashMb(size: number): number {
  return Math.max(16, Math.floor(POOL_HASH_BUDGET_MB / Math.max(1, size)))
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

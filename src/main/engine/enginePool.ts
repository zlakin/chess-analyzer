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

export function poolSize(cpuCount: number): number {
  return Math.max(1, Math.min(6, cpuCount - 2))
}

export async function createEnginePool(
  size: number,
  createEngine: () => PooledEngine
): Promise<EnginePool> {
  const engines = Array.from({ length: size }, () => createEngine())
  await Promise.all(engines.map((engine) => engine.start()))

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

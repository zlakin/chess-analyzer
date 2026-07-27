import { describe, it, expect, vi } from 'vitest'
import { createEnginePool, poolSize } from './enginePool'
import type { PooledEngine } from './enginePool'
import type { PositionEvaluation } from '../../shared/types'

function evalFor(cp: number): PositionEvaluation {
  return { lines: [{ depth: 1, scoreCp: cp, scoreMate: null, moveUci: 'a1a1', pv: ['a1a1'] }] }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('poolSize', () => {
  it('floors at 1 for low cpu counts', () => {
    expect(poolSize(1)).toBe(1)
    expect(poolSize(2)).toBe(1)
  })

  it('scales as cpuCount - 2', () => {
    expect(poolSize(4)).toBe(2)
    expect(poolSize(8)).toBe(6)
  })

  it('caps at 6 regardless of cpu count', () => {
    expect(poolSize(16)).toBe(6)
    expect(poolSize(32)).toBe(6)
  })
})

describe('createEnginePool', () => {
  function fakeEngine(): PooledEngine {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      evaluatePosition: vi.fn(async (fen: string) => evalFor(fen.length)),
      stop: vi.fn()
    }
  }

  it('starts every engine before resolving', async () => {
    const engines = [fakeEngine(), fakeEngine()]
    let created = 0
    await createEnginePool(2, () => engines[created++])

    expect(engines[0].start).toHaveBeenCalledTimes(1)
    expect(engines[1].start).toHaveBeenCalledTimes(1)
  })

  it('never sends more than `size` concurrent calls to the underlying engines', async () => {
    const callDeferreds: Array<{ resolve: (value: PositionEvaluation) => void }> = []

    const pool = await createEnginePool(2, () => ({
      start: async () => {},
      evaluatePosition: async () => {
        const d = deferred<PositionEvaluation>()
        callDeferreds.push(d)
        return d.promise
      },
      stop: () => {}
    }))

    const results = [
      pool.evaluatePosition('a', { depth: 1 }),
      pool.evaluatePosition('b', { depth: 1 }),
      pool.evaluatePosition('c', { depth: 1 })
    ]

    await Promise.resolve()
    await Promise.resolve()

    // Only 2 engines exist, so only 2 of the 3 calls should have reached one.
    expect(callDeferreds).toHaveLength(2)

    callDeferreds[0].resolve(evalFor(1))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Releasing an engine lets it pick up the queued third call.
    expect(callDeferreds).toHaveLength(3)

    callDeferreds[1].resolve(evalFor(2))
    callDeferreds[2].resolve(evalFor(3))

    await Promise.all(results)
  })

  it('stop() reaches every pooled engine', async () => {
    const engines = [fakeEngine(), fakeEngine(), fakeEngine()]
    let created = 0
    const pool = await createEnginePool(3, () => engines[created++])

    pool.stop()

    for (const engine of engines) expect(engine.stop).toHaveBeenCalledTimes(1)
  })
})

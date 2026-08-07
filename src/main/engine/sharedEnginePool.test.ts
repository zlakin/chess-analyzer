import { describe, it, expect, vi } from 'vitest'
import { createSharedEnginePool, leaseAsPool } from './sharedEnginePool'
import type { EnginePool } from './enginePool'
import type { PositionEvaluation } from '../../shared/types'

function evaluation(): PositionEvaluation {
  return { lines: [{ depth: 1, scoreCp: 0, scoreMate: null, moveUci: 'a1a1', pv: ['a1a1'] }] }
}

function fakePool(): EnginePool {
  return {
    size: 2,
    evaluatePosition: vi.fn(async () => evaluation()),
    stop: vi.fn()
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createSharedEnginePool', () => {
  it('builds one pool for two acquires that overlap while it is still starting', async () => {
    // The construction is deliberately left in flight across both acquires:
    // pool startup is async, so the second caller has to await the same
    // in-flight promise rather than starting a second pool of engines.
    const construction = deferred<EnginePool>()
    const createPool = vi.fn(() => construction.promise)
    const shared = createSharedEnginePool(createPool)

    const first = shared.acquire()
    const second = shared.acquire()

    const pool = fakePool()
    construction.resolve(pool)
    const [leaseA, leaseB] = await Promise.all([first, second])

    expect(createPool).toHaveBeenCalledTimes(1)
    expect(leaseA.pool).toBe(pool)
    expect(leaseB.pool).toBe(pool)
  })

  it('reuses the live pool for an acquire that arrives after construction settled', async () => {
    const pool = fakePool()
    const createPool = vi.fn(async () => pool)
    const shared = createSharedEnginePool(createPool)

    const leaseA = await shared.acquire()
    const leaseB = await shared.acquire()

    expect(createPool).toHaveBeenCalledTimes(1)
    expect(leaseB.pool).toBe(leaseA.pool)
  })

  it('stops the pool only once the last holder has released', async () => {
    const pool = fakePool()
    const shared = createSharedEnginePool(async () => pool)

    const leaseA = await shared.acquire()
    const leaseB = await shared.acquire()

    leaseA.release()
    // A run that finishes or is cancelled must not tear the pool out from
    // under the sibling run that is still using it.
    expect(pool.stop).not.toHaveBeenCalled()

    leaseB.release()
    expect(pool.stop).toHaveBeenCalledTimes(1)
  })

  it('ignores a repeated release so one holder cannot decrement twice', async () => {
    const pool = fakePool()
    const shared = createSharedEnginePool(async () => pool)

    const leaseA = await shared.acquire()
    const leaseB = await shared.acquire()

    leaseA.release()
    leaseA.release()
    leaseA.release()

    expect(pool.stop).not.toHaveBeenCalled()

    leaseB.release()
    expect(pool.stop).toHaveBeenCalledTimes(1)
  })

  it('builds a fresh pool for a run that starts after the last release stopped the old one', async () => {
    const pools = [fakePool(), fakePool()]
    let built = 0
    const shared = createSharedEnginePool(async () => pools[built++])

    const first = await shared.acquire()
    expect(first.pool).toBe(pools[0])
    first.release()

    const second = await shared.acquire()
    // The first pool's child processes are dead, so handing it out again would
    // give the new run a pool that can never answer.
    expect(second.pool).toBe(pools[1])
  })

  it('does not cache a failed construction, so a later run can still start engines', async () => {
    const pool = fakePool()
    let attempt = 0
    const createPool = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('spawn failed')
      return pool
    })
    const shared = createSharedEnginePool(createPool)

    await expect(shared.acquire()).rejects.toThrow('spawn failed')

    const lease = await shared.acquire()
    expect(lease.pool).toBe(pool)
    expect(createPool).toHaveBeenCalledTimes(2)
  })

  it('fails every acquirer waiting on the same failed construction', async () => {
    const construction = deferred<EnginePool>()
    const createPool = vi.fn(() => construction.promise)
    const shared = createSharedEnginePool(createPool)

    const first = shared.acquire()
    const second = shared.acquire()
    construction.reject(new Error('spawn failed'))

    await expect(first).rejects.toThrow('spawn failed')
    await expect(second).rejects.toThrow('spawn failed')
    expect(createPool).toHaveBeenCalledTimes(1)
  })

  it('unwinds the reference count for a failed acquire, so the next pool still stops on release', async () => {
    // A failed acquire that left its reference behind would pin the count
    // above zero forever and leak every pool built afterwards.
    const pool = fakePool()
    let attempt = 0
    const shared = createSharedEnginePool(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('spawn failed')
      return pool
    })

    await expect(shared.acquire()).rejects.toThrow('spawn failed')

    const lease = await shared.acquire()
    lease.release()

    expect(pool.stop).toHaveBeenCalledTimes(1)
  })
})

describe('leaseAsPool', () => {
  it('releases the lease instead of stopping a pool a sibling still holds', async () => {
    const pool = fakePool()
    const shared = createSharedEnginePool(async () => pool)

    const sibling = await shared.acquire()
    const view = leaseAsPool(await shared.acquire())

    view.stop()
    expect(pool.stop).not.toHaveBeenCalled()

    sibling.release()
    expect(pool.stop).toHaveBeenCalledTimes(1)
  })

  it('stops the shared pool when its lease is the last one out', async () => {
    const pool = fakePool()
    const shared = createSharedEnginePool(async () => pool)

    const view = leaseAsPool(await shared.acquire())
    view.stop()
    // runScan's `finally { pool.stop() }` can be reached twice on some paths;
    // the second stop must not decrement a reference it no longer holds.
    view.stop()

    expect(pool.stop).toHaveBeenCalledTimes(1)
  })

  it('passes evaluations through to the shared pool', async () => {
    const pool = fakePool()
    const shared = createSharedEnginePool(async () => pool)

    const view = leaseAsPool(await shared.acquire())
    await view.evaluatePosition('some-fen', { depth: 12, multiPv: 2 })

    expect(pool.evaluatePosition).toHaveBeenCalledWith('some-fen', { depth: 12, multiPv: 2 })
  })
})

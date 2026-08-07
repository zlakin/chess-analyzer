import type { EnginePool } from './enginePool'

export interface EnginePoolLease {
  pool: EnginePool
  // Releasing twice is a no-op rather than a second decrement, so a caller can
  // release from more than one exit path without silently stopping the pool
  // under whoever else is still holding it.
  release(): void
}

export interface SharedEnginePool {
  acquire(): Promise<EnginePoolLease>
}

// One pool per machine, shared by every run that wants engines, kept alive by a
// reference count. Both IPC entry points (analyzeGame and scanChessComGames)
// used to build their own pool of poolSize(cpus().length) engines, and neither
// knew about the other: starting an Insights scan and then switching to the
// Analyze tab -- two ordinary clicks, since nothing disables tab navigation
// mid-run -- put two full pools of single-threaded searches on the same cores,
// so both paths ran slower than either alone. That is the opposite of what the
// pool exists to do.
export function createSharedEnginePool(createPool: () => Promise<EnginePool>): SharedEnginePool {
  let pending: Promise<EnginePool> | null = null
  let holders = 0

  function startConstruction(): Promise<EnginePool> {
    const construction = createPool()
    pending = construction
    // A construction that fails must not stay cached: every acquirer waiting on
    // this promise gets the error (both call sites already turn it into a
    // friendly message), and the next acquire starts a fresh attempt. Caching
    // the rejection instead would poison every later run until the app is
    // restarted, e.g. after a single transient EAGAIN under process pressure.
    construction.catch(() => {
      if (pending === construction) pending = null
    })
    return construction
  }

  async function acquire(): Promise<EnginePoolLease> {
    // Counted before the await, not after it: otherwise a sibling's release
    // could see the count hit zero and stop the pool while this acquire is
    // still waiting for construction to finish, handing back a dead pool.
    holders += 1

    // Pool construction is async, so a second acquire that arrives while the
    // first is still starting engines must await the *same* promise -- calling
    // createPool() again would spawn a second machine's worth of processes,
    // which is the exact problem the shared pool exists to prevent.
    const construction = pending ?? startConstruction()

    let pool: EnginePool
    try {
      pool = await construction
    } catch (err) {
      holders -= 1
      throw err
    }

    let released = false
    return {
      pool,
      release: () => {
        if (released) return
        released = true
        holders -= 1
        if (holders > 0) return

        // Last holder out stops the engines. Clearing `pending` first means the
        // next run builds a fresh pool rather than handing out one whose child
        // processes have all been killed.
        if (pending === construction) pending = null
        pool.stop()
      }
    }
  }

  return { acquire }
}

// runScan takes ownership of whatever pool it is given and stops it on every
// exit path, including cancellation. This view turns that stop() into a release
// of one lease, so a finished or cancelled scan hands the pool back instead of
// tearing it out from under an analysis run that is still using it.
export function leaseAsPool(lease: EnginePoolLease): EnginePool {
  return {
    evaluatePosition: (fen, options) => lease.pool.evaluatePosition(fen, options),
    stop: () => lease.release()
  }
}

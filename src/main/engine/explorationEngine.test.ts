import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

// getStockfishBinaryPath() (called internally by explorationEngine) reads
// electron's `app`. Outside an actual Electron process, `require('electron')`
// resolves to a path string rather than the module API, so without this mock
// every evaluate call would throw before spawnFn is ever invoked -- matching
// the pattern already used in stockfishPath.test.ts.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/test/app-root'
  }
}))

import {
  evaluateExplorationPosition,
  stopExplorationEngine,
  __resetExplorationEngineForTests
} from './explorationEngine'

function createFakeProcess(): { proc: ChildProcessWithoutNullStreams; kill: ReturnType<typeof vi.fn> } {
  const stdout = new EventEmitter()
  const kill = vi.fn()
  const fakeProc = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new EventEmitter(),
    stdin: {
      write: (data: string) => {
        const command = data.trim()
        if (command === 'uci') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('uciok\n')))
        } else if (command === 'isready') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('readyok\n')))
        } else if (command.startsWith('go depth')) {
          queueMicrotask(() => {
            stdout.emit('data', Buffer.from('info depth 12 multipv 1 score cp 20 pv e2e4\n'))
            stdout.emit('data', Buffer.from('bestmove e2e4\n'))
          })
        }
      }
    },
    kill
  })
  return { proc: fakeProc as unknown as ChildProcessWithoutNullStreams, kill }
}

describe('explorationEngine', () => {
  beforeEach(() => {
    __resetExplorationEngineForTests()
  })

  it('reuses one engine instance across multiple evaluate calls', async () => {
    let spawnCount = 0
    const spawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      return createFakeProcess().proc
    }

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    await evaluateExplorationPosition('startpos', 12, spawnFn)

    expect(spawnCount).toBe(1)
  })

  it('resets the cached instance after an error so the next call starts fresh', async () => {
    let spawnCount = 0
    const throwingSpawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      throw new Error('spawn failed')
    }

    const first = await evaluateExplorationPosition('startpos', 12, throwingSpawnFn)
    expect('error' in first && first.error).toContain('Could not evaluate position')

    const workingSpawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      return createFakeProcess().proc
    }
    await evaluateExplorationPosition('startpos', 12, workingSpawnFn)

    expect(spawnCount).toBe(2)
  })

  it('serializes concurrent calls against the shared engine instead of letting them overlap', async () => {
    // StockfishManager's pendingLineHandlers has no per-call identity - if
    // two evaluatePosition calls against the same instance were genuinely
    // concurrent, a single "bestmove" line could resolve both at once with
    // cross-contaminated data. This proves the queue in
    // evaluateExplorationPosition prevents that: at most one "go depth"
    // command may ever be outstanding at a time, even when two calls are
    // fired without awaiting the first (Promise.all below).
    let activeGoCommands = 0
    let maxConcurrentGoCommands = 0

    const spawnFn = (): ChildProcessWithoutNullStreams => {
      const stdout = new EventEmitter()
      const fakeProc = Object.assign(new EventEmitter(), {
        stdout,
        stderr: new EventEmitter(),
        stdin: {
          write: (data: string) => {
            const command = data.trim()
            if (command === 'uci') {
              queueMicrotask(() => stdout.emit('data', Buffer.from('uciok\n')))
            } else if (command === 'isready') {
              queueMicrotask(() => stdout.emit('data', Buffer.from('readyok\n')))
            } else if (command.startsWith('go depth')) {
              activeGoCommands++
              maxConcurrentGoCommands = Math.max(maxConcurrentGoCommands, activeGoCommands)
              // A real delay (not just a microtask), so a second, overlapping
              // "go depth" - if the serialization queue were missing or
              // broken - would have a real window to arrive before this one
              // answers, rather than the test passing by lucky timing.
              setTimeout(() => {
                activeGoCommands--
                stdout.emit('data', Buffer.from('info depth 12 multipv 1 score cp 20 pv e2e4\n'))
                stdout.emit('data', Buffer.from('bestmove e2e4\n'))
              }, 10)
            }
          }
        },
        kill: vi.fn()
      })
      return fakeProc as unknown as ChildProcessWithoutNullStreams
    }

    const [first, second] = await Promise.all([
      evaluateExplorationPosition('fen-one', 12, spawnFn),
      evaluateExplorationPosition('fen-two', 12, spawnFn)
    ])

    expect(maxConcurrentGoCommands).toBe(1)
    expect('lines' in first).toBe(true)
    expect('lines' in second).toBe(true)
  })

  it('stopExplorationEngine kills the process and clears the cache so the next call spawns fresh', async () => {
    let spawnCount = 0
    const kills: Array<ReturnType<typeof vi.fn>> = []
    const spawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      const fake = createFakeProcess()
      kills.push(fake.kill)
      return fake.proc
    }

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    stopExplorationEngine()
    expect(kills[0]).toHaveBeenCalled()

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    expect(spawnCount).toBe(2)
  })
})

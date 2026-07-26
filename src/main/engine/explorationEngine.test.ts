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

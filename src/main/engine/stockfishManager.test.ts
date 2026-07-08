import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { StockfishManager } from './stockfishManager'

function createFakeProcess(): {
  proc: ChildProcessWithoutNullStreams
  stdout: EventEmitter
  written: string[]
} {
  const stdout = new EventEmitter()
  const written: string[] = []

  const fakeProc = {
    stdout,
    stdin: {
      write: (data: string) => {
        written.push(data)
        const command = data.trim()
        if (command === 'uci') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('uciok\n')))
        } else if (command === 'isready') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('readyok\n')))
        }
      }
    },
    kill: vi.fn()
  }

  return { proc: fakeProc as unknown as ChildProcessWithoutNullStreams, stdout, written }
}

describe('StockfishManager', () => {
  it('completes the UCI handshake on start()', async () => {
    const { proc, written } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)

    await manager.start()

    expect(written).toContain('uci\n')
    expect(written).toContain('isready\n')
    expect(written).toContain('ucinewgame\n')
  })

  it('parses multipv evaluation lines and returns them sorted best-first', async () => {
    const { proc, stdout } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    const evalPromise = manager.evaluatePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { depth: 15, multiPv: 2 }
    )

    stdout.emit(
      'data',
      Buffer.from(
        [
          'info depth 15 seldepth 20 multipv 1 score cp 32 nodes 500000 nps 900000 pv e2e4 e7e5 g1f3',
          'info depth 15 seldepth 20 multipv 2 score cp -5 nodes 500000 nps 900000 pv d2d4 d7d5',
          'bestmove e2e4 ponder e7e5'
        ].join('\n') + '\n'
      )
    )

    const evaluation = await evalPromise

    expect(evaluation.lines).toHaveLength(2)
    expect(evaluation.lines[0]).toMatchObject({ scoreCp: 32, moveUci: 'e2e4', depth: 15 })
    expect(evaluation.lines[1]).toMatchObject({ scoreCp: -5, moveUci: 'd2d4', depth: 15 })
  })

  it('parses mate scores', async () => {
    const { proc, stdout } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    const evalPromise = manager.evaluatePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { depth: 10, multiPv: 1 }
    )

    stdout.emit(
      'data',
      Buffer.from('info depth 10 multipv 1 score mate 3 nodes 1000 nps 1000 pv f7f6 g2g4 f6f5\nbestmove f7f6\n')
    )

    const evaluation = await evalPromise

    expect(evaluation.lines[0]).toMatchObject({ scoreMate: 3, scoreCp: null, moveUci: 'f7f6' })
  })

  it('stop() kills the subprocess', async () => {
    const { proc } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    manager.stop()

    expect(proc.kill).toHaveBeenCalled()
  })
})

import { describe, it, expect } from 'vitest'
import { analyzeGame } from './gameAnalyzer'
import type { AnalyzedPosition, PositionEvaluation } from '../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E5_FEN = 'rnbqkbnr/ppp1pppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

const positions: AnalyzedPosition[] = [
  {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'e4',
    moveUci: 'e2e4',
    fenBefore: START_FEN,
    fenAfter: AFTER_E4_FEN,
    seeCp: 0,
    isCapture: false,
    legalMoveCount: 20
  },
  {
    ply: 2,
    moveNumber: 1,
    color: 'b',
    san: 'e5',
    moveUci: 'e7e5',
    fenBefore: AFTER_E4_FEN,
    fenAfter: AFTER_E5_FEN,
    seeCp: 0,
    isCapture: false,
    legalMoveCount: 20
  }
]

function evalFor(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

const evalsByFen: Record<string, PositionEvaluation> = {
  [START_FEN]: evalFor(30, 'e2e4'),
  [AFTER_E4_FEN]: evalFor(-25, 'e7e5'),
  [AFTER_E5_FEN]: evalFor(20, 'g1f3')
}

const fakeEngine = {
  evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
    const evaluation = evalsByFen[fen]
    if (!evaluation) throw new Error(`No fixture eval for fen: ${fen}`)
    return evaluation
  }
}

describe('analyzeGame', () => {
  it('evaluates each unique position exactly once and produces one AnalyzedMove per position', async () => {
    const seenFens: string[] = []
    const engine = {
      evaluatePosition: async (fen: string) => {
        seenFens.push(fen)
        return fakeEngine.evaluatePosition(fen)
      }
    }

    const result = await analyzeGame(positions, engine, { depth: 18 })

    expect(seenFens).toEqual([START_FEN, AFTER_E4_FEN, AFTER_E5_FEN])
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.moves).toHaveLength(2)
    expect(result.moves[0].san).toBe('e4')
    expect(result.moves[0].classification).toBe('book')
  })

  it('reports progress via onMove as each move is analyzed', async () => {
    const seenMoves: string[] = []
    await analyzeGame(positions, fakeEngine, {
      depth: 18,
      onMove: (move) => seenMoves.push(move.san)
    })
    expect(seenMoves).toEqual(['e4', 'e5'])
  })

  it('delivers moves to onMove in game order even when the engine resolves a later position before an earlier one', async () => {
    const resolvers: Record<string, (value: PositionEvaluation) => void> = {}
    const engine = {
      evaluatePosition: (fen: string) =>
        new Promise<PositionEvaluation>((resolve) => {
          resolvers[fen] = resolve
        })
    }

    const seenMoves: string[] = []
    const resultPromise = analyzeGame(positions, engine, {
      depth: 18,
      onMove: (move) => seenMoves.push(move.san)
    })

    // Let all three evaluatePosition calls get dispatched before resolving any.
    await Promise.resolve()
    await Promise.resolve()

    // Resolve out of game order: the last position first.
    resolvers[AFTER_E5_FEN](evalsByFen[AFTER_E5_FEN])
    await Promise.resolve()
    expect(seenMoves).toEqual([]) // nothing flushed yet - fen0/fen1 still pending

    resolvers[START_FEN](evalsByFen[START_FEN])
    resolvers[AFTER_E4_FEN](evalsByFen[AFTER_E4_FEN])

    const result = await resultPromise
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(seenMoves).toEqual(['e4', 'e5'])
    expect(result.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    // Order alone isn't enough to prove correct reassembly - a mispairing
    // bug (e.g. evalBefore/evalAfter swapped or shifted across positions)
    // would still pass every assertion above, since classification here
    // only depends on isBookMove. Pin down the actual eval values too.
    expect(result.moves[0].evalBefore).toBe(evalsByFen[START_FEN])
    expect(result.moves[0].evalAfter).toBe(evalsByFen[AFTER_E4_FEN])
  })

  it('rejects the whole analysis if any single position fails to evaluate', async () => {
    const failingEngine = {
      evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
        if (fen === AFTER_E4_FEN) throw new Error('engine crashed')
        return fakeEngine.evaluatePosition(fen)
      }
    }

    await expect(analyzeGame(positions, failingEngine, { depth: 18 })).rejects.toThrow('engine crashed')
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    const result = await analyzeGame(positions, fakeEngine, {
      depth: 18,
      isCancelled: () => true
    })
    expect(result).toEqual({ cancelled: true })
  })

  it('returns 100% accuracy for an empty game', async () => {
    const result = await analyzeGame([], fakeEngine, { depth: 18 })
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.whiteAccuracy).toBe(100)
    expect(result.blackAccuracy).toBe(100)
  })

  it('does not throw when a terminal position (checkmate/stalemate) yields an empty lines array', async () => {
    // Regression test for the crash on games ending in checkmate/stalemate:
    // a buggy or degenerate engine implementation could still hand back
    // `{ lines: [] }` for a terminal position (e.g. a future regression, or
    // a fixture standing in for one). analyzeGame must not throw -- it
    // should produce a sensible, non-throwing result instead of crashing
    // the whole analysis on the last move of a decisive game.
    const emptyLinesEngine = {
      evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
        if (fen === AFTER_E5_FEN) return { lines: [] }
        return fakeEngine.evaluatePosition(fen)
      }
    }

    const result = await analyzeGame(positions, emptyLinesEngine, { depth: 18 })

    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.moves).toHaveLength(2)
    expect(result.moves[1].san).toBe('e5')
    // No throw, and the move still produced a finite, well-formed evaluation.
    expect(Number.isFinite(result.moves[1].accuracy)).toBe(true)
  })
})

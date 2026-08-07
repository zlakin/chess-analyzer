import { describe, it, expect } from 'vitest'
import { analyzeGame } from './gameAnalyzer'
import { createEnginePool } from '../engine/enginePool'
import type { PooledEngine } from '../engine/enginePool'
import { createSharedEnginePool } from '../engine/sharedEnginePool'
import { parsePgn } from '../../shared/pgn'
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

  it('derives isRecapture from the move pair so a recapture is not called great', async () => {
    // classification.test.ts pins what classifyMove does once isRecapture is
    // true; nothing pinned the derivation here, and passing a hardcoded
    // `isRecapture: false` left the whole suite green -- which is the "every
    // recapture is Great" bug this wiring exists to prevent.
    //
    // 1.e4 e5 2.Nf3 f6 3.Nxe5 fxe5: fxe5 takes back the knight that just
    // took on e5, and 2...f6 leaves the opening book, so isBookMove cannot
    // short-circuit the classification and mask the result.
    const recapturePositions = parsePgn('1. e4 e5 2. Nf3 f6 3. Nxe5 fxe5')
    const recapture = recapturePositions[5]
    expect(recapture.san).toBe('fxe5')
    expect(recapture.isCapture).toBe(true)

    // These evals make fxe5 the engine's top move in a balanced position
    // with a 250cp gap to second best -- comfortably past GREAT_MOVE_GAP_CP,
    // so the recapture flag is the only thing keeping it out of 'great'.
    const engine = {
      evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
        if (fen !== recapture.fenBefore) return evalFor(10, 'a2a3')
        return {
          lines: [
            { depth: 18, scoreCp: 50, scoreMate: null, moveUci: 'f6e5', pv: ['f6e5'] },
            { depth: 18, scoreCp: -200, scoreMate: null, moveUci: 'g8e7', pv: ['g8e7'] }
          ]
        }
      }
    }

    const result = await analyzeGame(recapturePositions, engine, { depth: 18 })
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    const classified = result.moves[5]
    expect(classified.san).toBe('fxe5')
    expect(classified.classification).toBe('best')
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

// 30 plies, so 31 distinct positions to evaluate - long enough that "ran
// everything anyway" and "stopped near the cancel point" are unmistakably
// different numbers.
const LONG_GAME =
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 ' +
  '8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. c4 c6 12. cxb5 axb5 13. Nc3 Bb7 ' +
  '14. Bg5 b4 15. Nb1 h6'

// Lets every pending microtask chain run, then reports whether anything new
// started - a cancelled analysis that merely stopped *waiting* keeps its
// queued searches running on the pool after its own promise resolves, so the
// count has to be read once the pool has fully drained, not at the await.
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('analyzeGame cancellation on a shared engine pool', () => {
  // The user-visible shape this pins down: start an Insights scan, switch to
  // Analyze, paste a long game, hit Cancel. The scan still holds the shared
  // pool, so the analysis handler releases its lease rather than stopping the
  // engines - and before this test existed, every one of the analysis's
  // positions ran to completion on engines the scan needed.
  it('stops feeding the pool instead of running every remaining position', async () => {
    const positions = parsePgn(LONG_GAME)
    expect(positions).toHaveLength(30)

    const CANCEL_AFTER_SEARCHES = 5
    let searchesStarted = 0
    let enginesStopped = false
    let cancelled = false

    const makeEngine = (): PooledEngine => ({
      start: async () => {},
      evaluatePosition: async () => {
        // StockfishManager rejects every waiting caller once its child is
        // killed, so a stopped engine must never look like a working one.
        if (enginesStopped) throw new Error('StockfishManager: stopped')
        searchesStarted += 1
        if (searchesStarted === CANCEL_AFTER_SEARCHES) cancelled = true
        await Promise.resolve()
        return evalFor(15, 'e2e4')
      },
      stop: () => {
        enginesStopped = true
      }
    })

    const shared = createSharedEnginePool(() => createEnginePool(2, makeEngine))
    const scanLease = await shared.acquire()
    const analysisLease = await shared.acquire()

    let result
    try {
      result = await analyzeGame(positions, analysisLease.pool, {
        depth: 18,
        isCancelled: () => cancelled
      })
    } finally {
      // Exactly what the analyzeGame IPC handler does on every exit path.
      analysisLease.release()
    }

    expect(result).toEqual({ cancelled: true })

    // Releasing under a sibling holder deliberately leaves the engines alive,
    // which is why cancellation cannot rely on the pool being stopped.
    expect(enginesStopped).toBe(false)

    let previous = -1
    while (previous !== searchesStarted) {
      previous = searchesStarted
      await flushAsync()
    }

    // 31 positions; the cancel lands on the 5th search, and only the searches
    // already in flight on the pool's 2 engines may finish after it.
    expect(searchesStarted).toBeLessThan(positions.length + 1)
    expect(searchesStarted).toBeLessThanOrEqual(CANCEL_AFTER_SEARCHES + 2)

    // The sibling scan keeps working engines and is not left waiting behind
    // the cancelled run's leftovers.
    await expect(scanLease.pool.evaluatePosition(START_FEN, { depth: 1 })).resolves.toBeDefined()

    scanLease.release()
    expect(enginesStopped).toBe(true)
  })
})

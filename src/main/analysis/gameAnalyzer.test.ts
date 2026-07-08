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
    isPotentialSacrifice: false
  },
  {
    ply: 2,
    moveNumber: 1,
    color: 'b',
    san: 'e5',
    moveUci: 'e7e5',
    fenBefore: AFTER_E4_FEN,
    fenAfter: AFTER_E5_FEN,
    isPotentialSacrifice: false
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
})

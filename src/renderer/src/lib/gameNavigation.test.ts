import { describe, it, expect } from 'vitest'
import { getMoveAtPly } from './gameNavigation'
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

const EMPTY_EVAL: PositionEvaluation = { lines: [] }

function makeMove(ply: number): AnalyzedMove {
  return {
    ply,
    moveNumber: Math.ceil(ply / 2),
    color: ply % 2 === 1 ? 'w' : 'b',
    san: `move${ply}`,
    moveUci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    isPotentialSacrifice: false,
    evalBefore: EMPTY_EVAL,
    evalAfter: EMPTY_EVAL,
    classification: 'good',
    accuracy: 90
  }
}

describe('getMoveAtPly', () => {
  it('returns null for ply 0 (the starting position, before any move)', () => {
    expect(getMoveAtPly([makeMove(1), makeMove(2)], 0)).toBeNull()
  })

  it('returns null when there are no moves', () => {
    expect(getMoveAtPly([], 3)).toBeNull()
  })

  it('returns the move at the given ply', () => {
    const moves = [makeMove(1), makeMove(2), makeMove(3)]
    expect(getMoveAtPly(moves, 2)?.ply).toBe(2)
  })

  it('clamps to the last move when ply exceeds the move list length', () => {
    const moves = [makeMove(1), makeMove(2)]
    expect(getMoveAtPly(moves, 99)?.ply).toBe(2)
  })
})

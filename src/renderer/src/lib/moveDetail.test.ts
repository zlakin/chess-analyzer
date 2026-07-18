import { describe, it, expect } from 'vitest'
import { formatMoveDetail, sanForUci } from './moveDetail'
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function evalWithLine(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

function makeMove(overrides: Partial<AnalyzedMove>): AnalyzedMove {
  return {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'a3',
    moveUci: 'a2a3',
    fenBefore: START_FEN,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1',
    isPotentialSacrifice: false,
    evalBefore: evalWithLine(40, 'g1f3'),
    evalAfter: evalWithLine(850, 'e7e5'),
    classification: 'inaccuracy',
    accuracy: 60,
    ...overrides
  }
}

describe('sanForUci', () => {
  it('converts a legal UCI move to SAN for the given position', () => {
    expect(sanForUci(START_FEN, 'g1f3')).toBe('Nf3')
  })

  it('returns null for an illegal move', () => {
    expect(sanForUci(START_FEN, 'a1a8')).toBeNull()
  })
})

describe('formatMoveDetail', () => {
  it('returns null when no move is selected', () => {
    expect(formatMoveDetail(null)).toBeNull()
  })

  it('returns null for book moves', () => {
    expect(formatMoveDetail(makeMove({ classification: 'book' }))).toBeNull()
  })

  it('describes a non-best move with the win-chance swing and the best alternative', () => {
    const text = formatMoveDetail(makeMove({}))
    expect(text).toMatch(/^a3 — Inaccuracy, -\d+% win chance\. Best was Nf3\.$/)
  })

  it('omits the "Best was" suffix when the played move was the engine\'s top choice', () => {
    const text = formatMoveDetail(
      makeMove({
        san: 'Nf3',
        moveUci: 'g1f3',
        classification: 'best',
        evalBefore: evalWithLine(40, 'g1f3'),
        evalAfter: evalWithLine(-30, 'e7e5')
      })
    )
    expect(text).not.toContain('Best was')
    expect(text).toMatch(/^Nf3 — Best, /)
  })
})

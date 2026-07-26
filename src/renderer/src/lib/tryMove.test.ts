import { describe, it, expect } from 'vitest'
import { tryMove } from './tryMove'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('tryMove', () => {
  it('returns the resulting FEN for a legal move', () => {
    expect(tryMove(START_FEN, 'e2', 'e4')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    )
  })

  it('returns null for an illegal move', () => {
    expect(tryMove(START_FEN, 'e2', 'e5')).toBeNull()
  })

  it('returns null when moving from an empty square', () => {
    expect(tryMove(START_FEN, 'e4', 'e5')).toBeNull()
  })

  it("returns null when attempting to move the side not to move's piece", () => {
    // White to move; e7 has a black pawn.
    expect(tryMove(START_FEN, 'e7', 'e5')).toBeNull()
  })

  it('auto-queens a pawn promotion', () => {
    const fenBeforePromotion = '8/P7/8/8/8/8/8/k6K w - - 0 1'
    const result = tryMove(fenBeforePromotion, 'a7', 'a8')
    expect(result).not.toBeNull()
    expect(result).toContain('Q')
  })
})

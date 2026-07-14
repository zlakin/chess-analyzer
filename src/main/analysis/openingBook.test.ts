import { describe, it, expect } from 'vitest'
import { isBookMove, matchOpeningName } from './openingBook'

describe('isBookMove', () => {
  it('recognizes the start of the Ruy Lopez', () => {
    const history = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']
    expect(isBookMove(history, 3)).toBe(true)
    expect(isBookMove(history, 5)).toBe(true)
  })

  it('returns false once the game diverges from every known book line', () => {
    const history = ['e4', 'c5', 'Nf3', 'e6']
    expect(isBookMove(history, 4)).toBe(false)
  })

  it('returns false for an opening not in the book', () => {
    expect(isBookMove(['a4'], 1)).toBe(false)
  })

  it('recognizes the Ruy Lopez main line through 5.O-O Be7, including 3...a6', () => {
    // Regression test: 3...a6 in the Ruy Lopez is a completely standard
    // theoretical move, but the book previously stopped at 3.Bb5, so a6
    // fell through to the sacrifice/brilliant heuristic instead of being
    // tagged "book".
    const history = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']
    for (let ply = 1; ply <= history.length; ply++) {
      expect(isBookMove(history, ply)).toBe(true)
    }
  })
})

describe('matchOpeningName', () => {
  it('identifies a game that fully completes a known book line', () => {
    const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5']
    expect(matchOpeningName(sanHistory)).toBe('Ruy Lopez, Morphy Defense')
  })

  it('returns null for a game that deviates before completing any book line', () => {
    expect(matchOpeningName(['e4', 'e5', 'Nf3', 'd6'])).toBeNull()
  })

  it('returns null for a game shorter than every book line', () => {
    expect(matchOpeningName(['e4', 'e5'])).toBeNull()
  })
})

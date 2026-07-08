import { describe, it, expect } from 'vitest'
import { isBookMove } from './openingBook'

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
})

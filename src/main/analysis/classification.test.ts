import { describe, it, expect } from 'vitest'
import { classifyMove } from './classification'
import type { ClassifyMoveInput } from './classification'

function input(overrides: Partial<ClassifyMoveInput>): ClassifyMoveInput {
  return {
    cpLoss: 0,
    isBestMove: true,
    isBookMove: false,
    isPotentialSacrifice: false,
    evalBeforeMoverCp: 20,
    secondBestMoverCp: null,
    ...overrides
  }
}

describe('classifyMove', () => {
  it('classifies book moves regardless of other inputs', () => {
    expect(classifyMove(input({ isBookMove: true, cpLoss: 500 }))).toBe('book')
  })

  it('classifies a plain best move as best', () => {
    expect(classifyMove(input({ isBestMove: true }))).toBe('best')
  })

  it('classifies a sacrifice-and-best move in a balanced position as brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, isPotentialSacrifice: true, evalBeforeMoverCp: 50 }))
    ).toBe('brilliant')
  })

  it('does not call an obviously winning sacrifice brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, isPotentialSacrifice: true, evalBeforeMoverCp: 900 }))
    ).toBe('best')
  })

  it('classifies the only good move in a critical position as great', () => {
    expect(
      classifyMove(input({ isBestMove: true, evalBeforeMoverCp: 50, secondBestMoverCp: -150 }))
    ).toBe('great')
  })

  it.each([
    [10, 'excellent'],
    [35, 'good'],
    [80, 'inaccuracy'],
    [150, 'mistake'],
    [400, 'blunder']
  ])('classifies a non-best move with cpLoss %i as %s', (cpLoss, expected) => {
    expect(classifyMove(input({ isBestMove: false, cpLoss }))).toBe(expected)
  })
})

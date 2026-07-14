import { describe, it, expect } from 'vitest'
import { classifyMove } from './classification'
import type { ClassifyMoveInput } from './classification'
import { isBookMove } from './openingBook'

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

  it('does not classify 3...a6 in the Ruy Lopez as brilliant (regression)', () => {
    // Reproduces the false-positive from the final review: in a standard
    // Ruy Lopez (1.e4 e5 2.Nf3 Nc6 3.Bb5 a6), a6's destination square is
    // "attacked" by the bishop on b5, so the coarse sacrifice heuristic in
    // src/shared/pgn.ts's isPotentialSacrifice flags it as a
    // potential sacrifice (verified directly by
    // src/shared/pgn.test.ts and by driving the real analyzeGame
    // pipeline with the real Stockfish binary). If it's also the engine's
    // top choice in a non-critical position and the opening book doesn't
    // cover it, classifyMove falls through to the brilliant path. The book
    // must cover this exact, extremely standard line so isBookMove is true
    // and classifyMove short-circuits to "book" before ever reaching the
    // sacrifice/brilliant branch.
    const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
    const a6Ply = 6
    expect(isBookMove(sanHistory, a6Ply)).toBe(true)

    const classification = classifyMove(
      input({
        isBestMove: true,
        isBookMove: isBookMove(sanHistory, a6Ply),
        isPotentialSacrifice: true,
        evalBeforeMoverCp: 30
      })
    )
    expect(classification).toBe('book')
    expect(classification).not.toBe('brilliant')
  })
})

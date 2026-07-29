import { describe, it, expect } from 'vitest'
import { classifyMove } from './classification'
import type { ClassifyMoveInput } from './classification'
import { isBookMove } from '../../shared/analysis/openingBook'
import { cpToWinPercent } from '../../shared/engineMath'

function input(overrides: Partial<ClassifyMoveInput>): ClassifyMoveInput {
  return {
    winPercentLoss: 0,
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
    expect(classifyMove(input({ isBookMove: true, winPercentLoss: 500 }))).toBe('book')
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
    [1, 'excellent'],
    [3.5, 'good'],
    [8, 'inaccuracy'],
    [15, 'mistake'],
    [40, 'blunder']
  ])('classifies a non-best move losing %s win percent as %s', (winPercentLoss, expected) => {
    expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe(expected)
  })

  it('reproduces the old centipawn tiers at an even evaluation (calibration)', () => {
    // The new thresholds are the old ones in the correct unit, so a move in a
    // balanced position must land in the same bucket it always has. Only
    // decided positions change -- which is exactly where the old tiers lied.
    const cases: Array<[number, string]> = [
      [20, 'excellent'],
      [50, 'good'],
      [100, 'inaccuracy'],
      [200, 'mistake'],
      [300, 'blunder']
    ]
    for (const [cpLoss, expected] of cases) {
      const winPercentLoss = cpToWinPercent(0) - cpToWinPercent(-cpLoss)
      expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe(expected)
    }
  })

  it('does not call a big centipawn drop in a won position a blunder (regression)', () => {
    // +2000 -> +1500 is cpLoss 500 but only 0.334 win percent.
    const winPercentLoss = cpToWinPercent(2000) - cpToWinPercent(1500)
    expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe('excellent')
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

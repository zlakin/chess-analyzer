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
    seeCp: 0,
    isRecapture: false,
    legalMoveCount: 30,
    evalBeforeMoverCp: 20,
    evalAfterMoverCp: 20,
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

  it('classifies a necessary, working sacrifice in a balanced position as brilliant', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: 40,
          secondBestMoverCp: -200
        })
      )
    ).toBe('brilliant')
  })

  it('does not call an obviously winning sacrifice brilliant', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 900,
          evalAfterMoverCp: 880,
          secondBestMoverCp: 700
        })
      )
    ).toBe('best')
  })

  it('does not call a sacrifice brilliant when a quiet move was just as good', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: 40,
          secondBestMoverCp: 20
        })
      )
    ).toBe('best')
  })

  it('does not call a sacrifice brilliant when the position collapses after it', () => {
    // secondBestMoverCp is -60, not -200: a gap that far past evalBeforeMoverCp
    // (50) would also clear GREAT_MOVE_GAP_CP once the brilliant gate falls
    // through, masking the thing this test checks. -60 keeps the gap (110)
    // above BRILLIANT_NECESSITY_GAP_CP -- so necessity alone would have let
    // this through -- while staying under GREAT_MOVE_GAP_CP, so the eval-after
    // collapse is the only thing keeping this out of 'brilliant' and 'great'.
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: -400,
          secondBestMoverCp: -60
        })
      )
    ).toBe('best')
  })

  it('does not call a defended pawn push brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, seeCp: 0, evalBeforeMoverCp: 30 }))
    ).toBe('best')
  })

  it('does not call a recapture great', () => {
    // After losing a queen, recapturing clears the 150cp gap to second-best
    // trivially -- every recapture in every game used to qualify.
    expect(
      classifyMove(
        input({ isBestMove: true, isRecapture: true, evalBeforeMoverCp: -300, secondBestMoverCp: -1100 })
      )
    ).toBe('best')
  })

  it('does not call a forced move great', () => {
    expect(
      classifyMove(
        input({ isBestMove: true, legalMoveCount: 1, evalBeforeMoverCp: 50, secondBestMoverCp: -150 })
      )
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
    // "attacked" by the bishop on b5, so src/shared/pgn.ts's seeCp
    // computation flags it as a losing exchange, i.e. a potential sacrifice
    // by the SACRIFICE_SEE_THRESHOLD applied in classification.ts (verified
    // directly by src/shared/pgn.test.ts and by driving the real
    // analyzeGame pipeline with the real Stockfish binary). If it's also
    // the engine's top choice in a non-critical position and the opening
    // book doesn't cover it, classifyMove falls through to the brilliant
    // path. The book must cover this exact, extremely standard line so
    // isBookMove is true and classifyMove short-circuits to "book" before
    // ever reaching the sacrifice/brilliant branch.
    const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
    const a6Ply = 6
    expect(isBookMove(sanHistory, a6Ply)).toBe(true)

    const classification = classifyMove(
      input({
        isBestMove: true,
        isBookMove: isBookMove(sanHistory, a6Ply),
        seeCp: -300,
        evalBeforeMoverCp: 30
      })
    )
    expect(classification).toBe('book')
    expect(classification).not.toBe('brilliant')
  })
})

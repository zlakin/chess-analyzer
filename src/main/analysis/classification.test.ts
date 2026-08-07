import { describe, it, expect } from 'vitest'
import { classifyMove } from './classification'
import type { ClassifyMoveInput } from './classification'
import { isBookMove } from '../../shared/analysis/openingBook'
import { cpToWinPercent } from '../../shared/engineMath'
import { staticExchangeEval } from '../../shared/analysis/see'

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
    // secondBestMoverCp is -80, not left at the input() default of null: a
    // null second-best would fail the brilliant check on its own (the
    // necessity clause requires secondBestMoverCp !== null), which would
    // mask seeCp as the actual reason this isn't brilliant. -80 gives a gap
    // of 110 -- at or above BRILLIANT_NECESSITY_GAP_CP (100), so necessity
    // is satisfied, and below GREAT_MOVE_GAP_CP (150), so it doesn't fall
    // through into 'great' either -- leaving seeCp: 0 (not a sacrifice) as
    // the sole reason this move isn't brilliant.
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: 0,
          evalBeforeMoverCp: 30,
          evalAfterMoverCp: 20,
          secondBestMoverCp: -80
        })
      )
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

  // The exact tier maxima (2, 5, 10, 20) are here on purpose: they pin the
  // comparison operator, which the mid-tier values alone leave entirely
  // unconstrained. Spec 1.2's table is strictly-less-than, so a loss of
  // exactly 2 belongs to the tier below "excellent".
  it.each([
    [1, 'excellent'],
    [2, 'good'],
    [3.5, 'good'],
    [5, 'inaccuracy'],
    [8, 'inaccuracy'],
    [10, 'mistake'],
    [15, 'mistake'],
    [20, 'blunder'],
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
    // Reproduces the false-positive from the final review: the old
    // sacrifice heuristic was `capturedValue < movedValue && isAttacked(to)`,
    // which for a pawn push reduces to "is the destination covered" -- and
    // a6's destination is covered by the bishop on b5. A best-move pawn
    // push outside the opening book therefore classified "brilliant".
    //
    // SEE is the fix and it is the first line of defence, so drive the real
    // one rather than a hand-picked seeCp: once the pawn stands on a6 the
    // a8 rook defends it, the swap-off loses nothing, and the value is 0 --
    // nowhere near SACRIFICE_SEE_THRESHOLD (-150). src/shared/pgn.test.ts
    // pins the same 0 from the parsing side. So the move is not brilliant
    // even with the book switched off, which is what the first assertion
    // below checks; the book covering this standard line is a second,
    // independent short-circuit, checked after it.
    const beforeA6 = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
    const seeCp = staticExchangeEval(beforeA6, 'a7', 'a6')
    expect(seeCp).toBe(0)

    // secondBestMoverCp is -200, not the input() default of null: a null
    // second-best would fail the brilliant gate on its own and mask seeCp as
    // the reason. With necessity satisfied, seeCp is the only thing standing
    // between this move and 'brilliant'.
    expect(
      classifyMove(
        input({
          isBestMove: true,
          isBookMove: false,
          seeCp,
          evalBeforeMoverCp: 30,
          evalAfterMoverCp: 20,
          secondBestMoverCp: -200
        })
      )
    ).not.toBe('brilliant')

    const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
    const a6Ply = 6
    expect(isBookMove(sanHistory, a6Ply)).toBe(true)
    expect(
      classifyMove(
        input({
          isBestMove: true,
          isBookMove: isBookMove(sanHistory, a6Ply),
          seeCp,
          evalBeforeMoverCp: 30,
          secondBestMoverCp: -200
        })
      )
    ).toBe('book')
  })
})

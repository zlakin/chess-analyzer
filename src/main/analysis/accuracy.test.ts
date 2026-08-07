import { describe, it, expect } from 'vitest'
import { moveAccuracy, gameAccuracy } from './accuracy'
import type { AccuracyInput } from './accuracy'
import type { MoveEvalDelta } from '../../shared/engineMath'

function delta(overrides: Partial<MoveEvalDelta>): MoveEvalDelta {
  return {
    cpLoss: 0,
    winPercentLoss: 0,
    evalBeforeMoverCp: 20,
    evalAfterMoverCp: 20,
    secondBestMoverCp: null,
    isBestMove: true,
    ...overrides
  }
}

describe('moveAccuracy', () => {
  it('is 100 when the position value does not drop', () => {
    expect(moveAccuracy(delta({ evalBeforeMoverCp: 20, evalAfterMoverCp: 20 }))).toBeCloseTo(100, 1)
  })

  it('is close to 100 when the position improves', () => {
    expect(moveAccuracy(delta({ evalBeforeMoverCp: 20, evalAfterMoverCp: 60 }))).toBeCloseTo(100, 1)
  })

  it('drops for a large blunder', () => {
    const accuracy = moveAccuracy(delta({ evalBeforeMoverCp: 100, evalAfterMoverCp: -900 }))
    expect(accuracy).toBeLessThan(40)
  })

  it('is exactly 0 for a total collapse, which is why gameAccuracy needs a floor', () => {
    // The clamp reaches exactly 0 once the win-percent drop passes ~80, and
    // cpToWinPercent saturates, so "had mate, gets mated" lands here. That is
    // the input the harmonic mean's reciprocal has to survive.
    expect(moveAccuracy(delta({ evalBeforeMoverCp: 100000, evalAfterMoverCp: -100000 }))).toBe(0)
  })

  it('never goes below 0 or above 100', () => {
    const veryBad = moveAccuracy(delta({ evalBeforeMoverCp: 100000, evalAfterMoverCp: -100000 }))
    expect(veryBad).toBeGreaterThanOrEqual(0)
    expect(veryBad).toBeLessThanOrEqual(100)
  })
})

describe('gameAccuracy', () => {
  function steady(n: number, accuracy: number): AccuracyInput {
    return {
      winPercents: Array.from({ length: n + 1 }, () => 50),
      moves: Array.from({ length: n }, (_, i) => ({
        accuracy,
        color: i % 2 === 0 ? ('w' as const) : ('b' as const)
      }))
    }
  }

  it('returns 100 for a game with no moves', () => {
    expect(gameAccuracy({ winPercents: [50], moves: [] })).toEqual({ white: 100, black: 100 })
  })

  it('reproduces a constant accuracy exactly', () => {
    const result = gameAccuracy(steady(20, 90))
    expect(result.white).toBeCloseTo(90, 4)
    expect(result.black).toBeCloseTo(90, 4)
  })

  it('scores each colour independently', () => {
    const input: AccuracyInput = {
      winPercents: Array.from({ length: 5 }, () => 50),
      moves: [
        { accuracy: 100, color: 'w' },
        { accuracy: 50, color: 'b' },
        { accuracy: 100, color: 'w' },
        { accuracy: 50, color: 'b' }
      ]
    }
    const result = gameAccuracy(input)
    expect(result.white).toBeGreaterThan(result.black)
  })

  it('scores below the arithmetic mean when one move is catastrophic', () => {
    // This is the whole point: the harmonic component punishes a game that
    // was fine except for one disaster, which a plain mean smooths away.
    const accuracies = [100, 100, 100, 100, 100, 100, 100, 100, 100, 5]
    const arithmetic = accuracies.reduce((a, b) => a + b, 0) / accuracies.length

    const input: AccuracyInput = {
      winPercents: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 5],
      moves: accuracies.map((accuracy) => ({ accuracy, color: 'w' as const }))
    }

    expect(gameAccuracy(input).white).toBeLessThan(arithmetic)
  })

  it('weights moves made in a volatile stretch above quiet ones', () => {
    // Every other gameAccuracy fixture feeds a constant winPercents, so every
    // window has stddev 0, every weight clamps to the 0.5 floor and the
    // weighting is mathematically inert -- replacing the whole weight
    // computation with moves.map(() => 1) left the suite green. Here the swing
    // at plies 7-11 lifts those weights well above the floor, and white's one
    // bad move sits inside it. Uniform weights score this game 78.2955; the
    // real weighting scores it 71.2021.
    const input: AccuracyInput = {
      winPercents: [
        50, 52, 51, 53, 50, 52, 51, 80, 20, 75, 25, 70, 52, 51, 50, 52, 51, 50, 52, 51, 50
      ],
      moves: Array.from({ length: 20 }, (_, i) => ({
        accuracy: i === 8 ? 20 : 95,
        color: i % 2 === 0 ? ('w' as const) : ('b' as const)
      }))
    }

    const result = gameAccuracy(input)

    expect(result.white).toBeCloseTo(71.2021, 3)
    // Black played every move at 95, so no weighting can move black's score --
    // which is what makes white's number attributable to the weights alone.
    expect(result.black).toBeCloseTo(95, 6)
  })

  it('lines each weight up with its own move in a game long enough to reach the maximum window', () => {
    // 80 plies makes windowSize hit its cap of 8, which is where the
    // windowSize - 2 leading copies of the first window matter: they are what
    // makes windows.length equal moves.length, so weights[i] belongs to
    // moves[i]. Drop that padding and every weight shifts by 6 plies.
    //
    // The single 65 at index 38 makes exactly the windows spanning it
    // volatile, giving weight 4.9608 (deliberately below the clamp of 12, so
    // the stddev itself is pinned, not just the clamp) to plies 37-44 -- and
    // those are exactly the plies scored 0 here. Misalign by 6 and the high
    // weights land on plies 31-38, which are mostly perfect moves, scoring the
    // game 46.0509 instead of 28.3695. Uniform weights score it 49.5872.
    const input: AccuracyInput = {
      winPercents: Array.from({ length: 81 }, (_, i) => (i === 38 ? 65 : 50)),
      moves: Array.from({ length: 80 }, (_, i) => ({
        accuracy: i >= 37 && i <= 44 ? 0 : 100,
        color: i % 2 === 0 ? ('w' as const) : ('b' as const)
      }))
    }

    const result = gameAccuracy(input)

    expect(result.white).toBeCloseTo(28.3695, 3)
    expect(result.black).toBeCloseTo(28.3695, 3)
  })

  it('does not let one zero-accuracy move collapse the game to half the weighted mean', () => {
    // moveAccuracy clamps to exactly 0 once the win-percent drop reaches ~80,
    // and winPercent() saturates mate to 0/100, so "had mate, gets mated" is a
    // 100-point drop -- reachable, since gameAnalyzer feeds moveAccuracy into
    // gameAccuracy with no floor of its own. With the old 0.01 floor that one
    // move contributed a reciprocal of 100 against 0.192 for the other
    // nineteen, so the harmonic term was 0.1996 and the result 21.9719 --
    // within 0.1 of weightedMean / 2, i.e. the harmonic half had been
    // annihilated regardless of anything else the player did.
    const weightedMean = 43.744186

    const input: AccuracyInput = {
      winPercents: Array.from({ length: 21 }, (_, i) => (i < 20 ? 55 : 0)),
      moves: Array.from({ length: 20 }, (_, i) => ({
        accuracy: i === 19 ? 0 : 99,
        color: 'w' as const
      }))
    }

    const white = gameAccuracy(input).white

    expect(white).toBeCloseTo(30.2619, 3)
    // The blend is a real average of two halves again, not weightedMean / 2.
    expect(white - weightedMean / 2).toBeGreaterThan(5)
  })

  it('stays within 0 and 100', () => {
    const result = gameAccuracy(steady(30, 0))
    expect(result.white).toBeGreaterThanOrEqual(0)
    expect(result.white).toBeLessThanOrEqual(100)
  })
})

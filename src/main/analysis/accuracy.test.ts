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

  it('stays within 0 and 100', () => {
    const result = gameAccuracy(steady(30, 0))
    expect(result.white).toBeGreaterThanOrEqual(0)
    expect(result.white).toBeLessThanOrEqual(100)
  })
})

import { describe, it, expect } from 'vitest'
import { moveAccuracy, gameAccuracy } from './accuracy'
import type { MoveEvalDelta } from '../../shared/engineMath'

function delta(overrides: Partial<MoveEvalDelta>): MoveEvalDelta {
  return {
    cpLoss: 0,
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
  it('averages the given move accuracies', () => {
    expect(gameAccuracy([100, 80, 60])).toBeCloseTo(80, 5)
  })

  it('returns 100 for a game with no moves', () => {
    expect(gameAccuracy([])).toBe(100)
  })
})

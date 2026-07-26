import { describe, it, expect } from 'vitest'
import { gradeAttempt } from './gradeAttempt'
import type { PositionEvaluation } from '../../../shared/types'

function evalWithCp(cp: number): PositionEvaluation {
  return { lines: [{ depth: 12, scoreCp: cp, scoreMate: null, moveUci: 'a1a1', pv: [] }] }
}

function evalWithMate(mate: number): PositionEvaluation {
  return { lines: [{ depth: 12, scoreCp: null, scoreMate: mate, moveUci: 'a1a1', pv: [] }] }
}

describe('gradeAttempt', () => {
  it('grades an exact match to bestMoveUci as a perfect pass without needing real eval data', () => {
    const result = gradeAttempt(evalWithCp(0), evalWithCp(0), 'e2e4', 'e2e4')
    expect(result).toEqual({ correct: true, cpLoss: 0, quality: 5 })
  })

  it('tolerates a missing auto-queen suffix on the recorded best move', () => {
    const result = gradeAttempt(evalWithCp(0), evalWithCp(0), 'e7e8', 'e7e8q')
    expect(result).toEqual({ correct: true, cpLoss: 0, quality: 5 })
  })

  it('grades a delivered mate as a pass', () => {
    const result = gradeAttempt(evalWithCp(500), evalWithMate(0), 'h5f7', 'a1a2')
    expect(result.correct).toBe(true)
  })

  it('grades a missed mate as a fail', () => {
    const result = gradeAttempt(evalWithMate(1), evalWithCp(50), 'a1a2', 'h5f7')
    expect(result.correct).toBe(false)
  })

  it('is a pass at exactly the quality-3 cp-loss boundary (100) and a fail just past it', () => {
    const pass = gradeAttempt(evalWithCp(100), evalWithCp(0), 'a1a2', 'h5f7')
    expect(pass.correct).toBe(true)
    const fail = gradeAttempt(evalWithCp(101), evalWithCp(0), 'a1a2', 'h5f7')
    expect(fail.correct).toBe(false)
  })
})

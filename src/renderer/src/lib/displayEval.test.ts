import { describe, it, expect } from 'vitest'
import { whiteWinPercent, formatScore } from './displayEval'
import type { PositionEvaluation } from '../../../shared/types'

describe('whiteWinPercent', () => {
  it('returns 50% when there is no evaluated line (defense-in-depth for a terminal position)', () => {
    const evaluation: PositionEvaluation = { lines: [] }
    expect(whiteWinPercent(evaluation, 'w')).toBeCloseTo(50, 5)
  })

  it('returns close to 0% for a position where white is checkmated', () => {
    const evaluation: PositionEvaluation = {
      lines: [{ depth: 0, scoreCp: null, scoreMate: 0, moveUci: '', pv: [] }]
    }
    expect(whiteWinPercent(evaluation, 'w')).toBeLessThan(1)
  })
})

describe('formatScore', () => {
  it('does not throw and returns a sensible default when there is no evaluated line', () => {
    const evaluation: PositionEvaluation = { lines: [] }
    expect(() => formatScore(evaluation, 'w')).not.toThrow()
    expect(formatScore(evaluation, 'w')).toBe('+0.00')
  })

  it('formats a mate score from the side to move', () => {
    const evaluation: PositionEvaluation = {
      lines: [{ depth: 5, scoreCp: null, scoreMate: 2, moveUci: 'a1a2', pv: ['a1a2'] }]
    }
    expect(formatScore(evaluation, 'w')).toBe('M2')
  })
})

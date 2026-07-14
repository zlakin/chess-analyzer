import { describe, it, expect } from 'vitest'
import { synthesizeTopFindings } from './topFindings'
import type { InsightsBucket, InsightsReport } from '../../shared/types'

function bucket(overrides: Partial<InsightsBucket>): InsightsBucket {
  return {
    key: 'overall',
    gamesCount: 20,
    hasEnoughData: true,
    totalMistakes: 10,
    averageAccuracy: 80,
    phaseBreakdown: { opening: 1, middlegame: 2, endgame: 7 },
    hungPieceCount: 2,
    positionalCount: 8,
    timePressureCount: 0,
    weakOpenings: [],
    trend: [],
    ...overrides
  }
}

describe('synthesizeTopFindings', () => {
  it('surfaces the dominant mistake phase when it is over half of all mistakes', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({})]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings[0].text).toContain('endgame')
    expect(findings[0].text).toContain('7 of 10')
  })

  it('does not surface a phase finding when no phase dominates', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ phaseBreakdown: { opening: 3, middlegame: 4, endgame: 3 } })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.find((f) => f.text.includes('% of your blunders'))).toBeUndefined()
  })

  it('skips buckets that do not have enough data', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 2,
      lastScanTime: null,
      buckets: [bucket({ hasEnoughData: false })]
    }
    expect(synthesizeTopFindings(report)).toEqual([])
  })

  it('surfaces a weak-opening finding when accuracy is well below the bucket average', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({
          averageAccuracy: 85,
          weakOpenings: [{ name: 'Caro-Kann Defense, Classical', games: 5, accuracy: 70 }]
        })
      ]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('Caro-Kann'))).toBe(true)
  })

  it('does not surface a time-pressure finding when the count is a small share of a large sample', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ totalMistakes: 200, timePressureCount: 5 })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('little time'))).toBe(false)
  })

  it('gates a time-pressure finding by share of mistakes, not just raw count', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({ key: 'overall', totalMistakes: 5, timePressureCount: 5 }),
        bucket({ key: 'bullet', totalMistakes: 200, timePressureCount: 5 })
      ]
    }
    const findings = synthesizeTopFindings(report)
    const timePressureFindings = findings.filter((f) => f.text.includes('little time'))
    expect(timePressureFindings).toHaveLength(1)
    expect(timePressureFindings[0].text).toContain('5 of your mistakes')
  })

  it('ranks findings by significance, most significant first', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ timePressureCount: 20 }), bucket({ key: 'bullet', timePressureCount: 3 })]
    }
    const findings = synthesizeTopFindings(report)
    const timePressureFindings = findings.filter((f) => f.text.includes('little time'))
    expect(timePressureFindings[0].significance).toBeGreaterThan(timePressureFindings[1].significance)
  })
})

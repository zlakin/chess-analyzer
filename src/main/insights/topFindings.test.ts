import { describe, it, expect } from 'vitest'
import { synthesizeTopFindings } from './topFindings'
import type { InsightsBucket, InsightsReport, TacticType } from '../../shared/types'

function emptyTacticBreakdown(): Record<TacticType, number> {
  return { fork: 0, pin: 0, skewer: 0, discovered_attack: 0, back_rank_mate: 0, hung_piece: 0 }
}

function bucket(overrides: Partial<InsightsBucket>): InsightsBucket {
  return {
    key: 'overall',
    gamesCount: 20,
    hasEnoughData: true,
    totalMistakes: 10,
    averageAccuracy: 80,
    phaseBreakdown: { opening: 1, middlegame: 2, endgame: 7 },
    tacticBreakdown: emptyTacticBreakdown(),
    missedTacticBreakdown: emptyTacticBreakdown(),
    timePressureCount: 0,
    weakOpenings: [],
    trend: [],
    recentMistakes: [],
    tacticTrends: [],
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

  it('surfaces a "been caught by" finding when a tactic is a large share of what punished the player', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticBreakdown: { ...emptyTacticBreakdown(), fork: 4, hung_piece: 1 } })]
    }
    const findings = synthesizeTopFindings(report)
    const forkFinding = findings.find((f) => f.text.includes('caught by') && f.text.includes('fork'))
    expect(forkFinding?.text).toContain('4 forks')
  })

  it('surfaces a "missed" finding separately from a "caught by" finding', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({
          tacticBreakdown: { ...emptyTacticBreakdown(), pin: 5 },
          missedTacticBreakdown: { ...emptyTacticBreakdown(), fork: 5 }
        })
      ]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('missed') && f.text.includes('fork'))).toBe(true)
    expect(findings.some((f) => f.text.includes('caught by') && f.text.includes('pin'))).toBe(true)
  })

  it('does not surface a tactic finding below the count threshold', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticBreakdown: { ...emptyTacticBreakdown(), fork: 2, hung_piece: 8 } })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('fork'))).toBe(false)
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

  it('surfaces a trend finding when a tactic is being caught more often over time', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticTrends: [{ type: 'fork', olderShare: 0.2, newerShare: 0.6 }] })]
    }
    const findings = synthesizeTopFindings(report)
    const trendFinding = findings.find((f) => f.text.includes('fork') && f.text.includes('more often'))
    expect(trendFinding).toBeDefined()
  })

  it('surfaces a trend finding phrased as "less often" when a tactic\'s share dropped', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticTrends: [{ type: 'pin', olderShare: 0.6, newerShare: 0.2 }] })]
    }
    const findings = synthesizeTopFindings(report)
    const trendFinding = findings.find((f) => f.text.includes('pin') && f.text.includes('less often'))
    expect(trendFinding).toBeDefined()
  })

  it('ranks findings by significance, most significant first', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({ timePressureCount: 20 }),
        bucket({
          key: 'bullet',
          totalMistakes: 3,
          phaseBreakdown: { opening: 1, middlegame: 1, endgame: 1 },
          tacticBreakdown: { ...emptyTacticBreakdown(), fork: 3 }
        })
      ]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings[0].text).toContain('little time')
    const forkFinding = findings.find((f) => f.text.includes('fork'))
    expect(forkFinding).toBeDefined()
    expect(findings[0].significance).toBeGreaterThan(forkFinding!.significance)
  })

  it('collapses the same phase finding across buckets, keeping only the highest-significance instance', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({ key: 'overall', totalMistakes: 100, phaseBreakdown: { opening: 10, middlegame: 64, endgame: 26 } }),
        bucket({ key: 'bullet', totalMistakes: 20, phaseBreakdown: { opening: 2, middlegame: 14, endgame: 4 } })
      ]
    }
    const findings = synthesizeTopFindings(report)
    const middlegameFindings = findings.filter((f) => f.text.includes('middlegame'))
    expect(middlegameFindings).toHaveLength(1)
    expect(middlegameFindings[0].text).toContain('64 of 100')
    expect(middlegameFindings[0].text).not.toContain('in bullet')
  })

  it('collapses the same tactic finding across buckets too, keeping the strongest one', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({ key: 'overall', tacticBreakdown: { ...emptyTacticBreakdown(), hung_piece: 10 } }),
        bucket({ key: 'rapid', totalMistakes: 5, tacticBreakdown: { ...emptyTacticBreakdown(), hung_piece: 8 } })
      ]
    }
    const findings = synthesizeTopFindings(report)
    const hungPieceFindings = findings.filter((f) => f.text.includes('hung piece'))
    expect(hungPieceFindings).toHaveLength(1)
  })
})

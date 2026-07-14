import { describe, it, expect } from 'vitest'
import { buildInsightsReport } from './reportAggregator'
import type { GameInsightRecord } from '../../shared/types'

function record(overrides: Partial<GameInsightRecord>): GameInsightRecord {
  return {
    gameUrl: 'https://www.chess.com/game/live/1',
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    ...overrides
  }
}

describe('buildInsightsReport', () => {
  it('always includes an overall bucket, plus one bucket per time control that has games', () => {
    const records = [
      record({ gameUrl: 'g1', timeControlCategory: 'bullet' }),
      record({ gameUrl: 'g2', timeControlCategory: 'rapid' })
    ]

    const report = buildInsightsReport(records, null)
    expect(report.buckets.map((b) => b.key).sort()).toEqual(['bullet', 'overall', 'rapid'])
  })

  it('flags a bucket with fewer than 5 games as not having enough data', () => {
    const records = [record({ gameUrl: 'g1' }), record({ gameUrl: 'g2' })]
    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.hasEnoughData).toBe(false)
  })

  it('tallies phase breakdown and the hung-piece/positional split across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [
          {
            ply: 5,
            classification: 'blunder',
            phase: 'opening',
            isHungPiece: true,
            clockSecondsRemaining: null,
            isTimePressure: false
          },
          {
            ply: 40,
            classification: 'mistake',
            phase: 'endgame',
            isHungPiece: false,
            clockSecondsRemaining: null,
            isTimePressure: false
          }
        ]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.totalMistakes).toBe(2)
    expect(overall.phaseBreakdown).toEqual({ opening: 1, middlegame: 0, endgame: 1 })
    expect(overall.hungPieceCount).toBe(1)
    expect(overall.positionalCount).toBe(1)
  })

  it('counts time-pressure mistakes across all games in the bucket', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [
          {
            ply: 30,
            classification: 'blunder',
            phase: 'middlegame',
            isHungPiece: false,
            clockSecondsRemaining: 5,
            isTimePressure: true
          }
        ]
      })
    ]

    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.timePressureCount).toBe(1)
  })

  it('only surfaces an opening once it has at least 3 games, sorted weakest-accuracy first', () => {
    const records = [
      record({ gameUrl: 'g1', openingName: 'Caro-Kann Defense, Classical', accuracy: 60 }),
      record({ gameUrl: 'g2', openingName: 'Caro-Kann Defense, Classical', accuracy: 70 }),
      record({ gameUrl: 'g3', openingName: 'Caro-Kann Defense, Classical', accuracy: 65 }),
      record({ gameUrl: 'g4', openingName: 'Ruy Lopez, Morphy Defense', accuracy: 95 }),
      record({ gameUrl: 'g5', openingName: 'Ruy Lopez, Morphy Defense', accuracy: 90 })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    // Ruy Lopez only has 2 games -- below the 3-game threshold -- so it's excluded.
    expect(overall.weakOpenings).toEqual([{ name: 'Caro-Kann Defense, Classical', games: 3, accuracy: 65 }])
  })

  it('builds a chronological trend from the records', () => {
    const records = [
      record({ gameUrl: 'g1', endTime: 200, accuracy: 80 }),
      record({ gameUrl: 'g2', endTime: 100, accuracy: 90 })
    ]
    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.trend.map((t) => t.endTime)).toEqual([100, 200])
  })
})

import { describe, it, expect } from 'vitest'
import { buildInsightsReport } from './reportAggregator'
import type { GameInsightMistake, GameInsightRecord } from '../../shared/types'

function record(overrides: Partial<GameInsightRecord>): GameInsightRecord {
  return {
    gameUrl: 'https://www.chess.com/game/live/1',
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    ...overrides
  }
}

function mistake(overrides: Partial<GameInsightMistake>): GameInsightMistake {
  return {
    ply: 10,
    classification: 'mistake',
    phase: 'middlegame',
    cpLoss: 150,
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playedMoveUci: 'a2a3',
    bestMoveUci: 'e2e4',
    missedTactics: [],
    punishedByTactics: [],
    clockSecondsRemaining: null,
    isTimePressure: false,
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

  it('tallies phase breakdown across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ ply: 5, phase: 'opening' }), mistake({ ply: 40, phase: 'endgame' })]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.totalMistakes).toBe(2)
    expect(overall.phaseBreakdown).toEqual({ opening: 1, middlegame: 0, endgame: 1 })
  })

  it('tallies punished-by and missed tactic counts separately across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ missedTactics: ['fork'], punishedByTactics: ['hung_piece', 'fork'] })]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.tacticBreakdown).toEqual({
      fork: 1,
      pin: 0,
      skewer: 0,
      discovered_attack: 0,
      back_rank_mate: 0,
      hung_piece: 1
    })
    expect(overall.missedTacticBreakdown).toEqual({
      fork: 1,
      pin: 0,
      skewer: 0,
      discovered_attack: 0,
      back_rank_mate: 0,
      hung_piece: 0
    })
  })

  it('builds a recent-mistakes list, most recent game first, capped at 20', () => {
    const manyMistakeRecords = Array.from({ length: 15 }, (_, i) =>
      record({
        gameUrl: `g${i}`,
        endTime: i,
        opponentUsername: `opponent${i}`,
        mistakes: [mistake({ ply: 10 }), mistake({ ply: 20 })]
      })
    )

    const report = buildInsightsReport(manyMistakeRecords, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    // 15 games x 2 mistakes each = 30 total, capped to 20, newest endTime first.
    expect(overall.recentMistakes).toHaveLength(20)
    expect(overall.recentMistakes[0].opponentUsername).toBe('opponent14')
  })

  it('counts time-pressure mistakes across all games in the bucket', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ ply: 30, clockSecondsRemaining: 5, isTimePressure: true })]
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

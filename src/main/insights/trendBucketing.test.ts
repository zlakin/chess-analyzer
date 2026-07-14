import { describe, it, expect } from 'vitest'
import { buildTrend } from './trendBucketing'
import type { GameInsightRecord } from '../../shared/types'

function record(endTime: number, accuracy: number): GameInsightRecord {
  return {
    gameUrl: `https://www.chess.com/game/live/${endTime}`,
    endTime,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy,
    mistakes: []
  }
}

describe('buildTrend', () => {
  it('sorts by endTime and computes a rolling accuracy average', () => {
    const records = [record(300, 80), record(100, 90), record(200, 70)]
    const trend = buildTrend(records)

    expect(trend.map((t) => t.endTime)).toEqual([100, 200, 300])
    expect(trend[0].rollingAccuracy).toBe(90)
    expect(trend[1].rollingAccuracy).toBe(80)
    expect(trend[2].rollingAccuracy).toBeCloseTo(80)
  })

  it('caps the rolling window at 10 games', () => {
    const records = Array.from({ length: 12 }, (_, i) => record(i, i < 2 ? 0 : 100))
    const trend = buildTrend(records)

    // By index 11, the window covers indices 2-11 (10 games), all accuracy 100.
    expect(trend[11].rollingAccuracy).toBe(100)
  })
})

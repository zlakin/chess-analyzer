import type { GameInsightRecord, TrendPoint } from '../../shared/types'

const ROLLING_WINDOW_SIZE = 10

export function buildTrend(records: GameInsightRecord[]): TrendPoint[] {
  const sorted = [...records].sort((a, b) => a.endTime - b.endTime)

  return sorted.map((current, index) => {
    const windowStart = Math.max(0, index - ROLLING_WINDOW_SIZE + 1)
    const window = sorted.slice(windowStart, index + 1)
    const rollingAccuracy = window.reduce((sum, r) => sum + r.accuracy, 0) / window.length

    return { gameIndex: index, endTime: current.endTime, rollingAccuracy }
  })
}

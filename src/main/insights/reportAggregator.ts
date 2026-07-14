import type {
  GameInsightRecord,
  InsightsBucket,
  InsightsBucketKey,
  InsightsReport,
  OpeningStat,
  PhaseBreakdown,
  TimeControlCategory
} from '../../shared/types'
import { buildTrend } from './trendBucketing'

const MIN_GAMES_FOR_BUCKET = 5
const MIN_GAMES_PER_OPENING = 3

function averageAccuracy(records: GameInsightRecord[]): number {
  if (records.length === 0) return 0
  return records.reduce((sum, r) => sum + r.accuracy, 0) / records.length
}

function phaseBreakdown(records: GameInsightRecord[]): PhaseBreakdown {
  const breakdown: PhaseBreakdown = { opening: 0, middlegame: 0, endgame: 0 }
  for (const record of records) {
    for (const mistake of record.mistakes) {
      breakdown[mistake.phase] += 1
    }
  }
  return breakdown
}

function hungPieceCounts(records: GameInsightRecord[]): { hungPieceCount: number; positionalCount: number } {
  let hungPieceCount = 0
  let positionalCount = 0
  for (const record of records) {
    for (const mistake of record.mistakes) {
      if (mistake.isHungPiece) hungPieceCount += 1
      else positionalCount += 1
    }
  }
  return { hungPieceCount, positionalCount }
}

function timePressureCount(records: GameInsightRecord[]): number {
  let count = 0
  for (const record of records) {
    for (const mistake of record.mistakes) {
      if (mistake.isTimePressure) count += 1
    }
  }
  return count
}

function weakOpenings(records: GameInsightRecord[]): OpeningStat[] {
  const byOpening = new Map<string, GameInsightRecord[]>()
  for (const record of records) {
    if (!record.openingName) continue
    const existing = byOpening.get(record.openingName) ?? []
    existing.push(record)
    byOpening.set(record.openingName, existing)
  }

  const stats: OpeningStat[] = []
  for (const [name, group] of byOpening) {
    if (group.length < MIN_GAMES_PER_OPENING) continue
    stats.push({ name, games: group.length, accuracy: averageAccuracy(group) })
  }

  return stats.sort((a, b) => a.accuracy - b.accuracy)
}

function buildBucket(key: InsightsBucketKey, records: GameInsightRecord[]): InsightsBucket {
  const totalMistakes = records.reduce((sum, r) => sum + r.mistakes.length, 0)
  const { hungPieceCount, positionalCount } = hungPieceCounts(records)

  return {
    key,
    gamesCount: records.length,
    hasEnoughData: records.length >= MIN_GAMES_FOR_BUCKET,
    totalMistakes,
    averageAccuracy: averageAccuracy(records),
    phaseBreakdown: phaseBreakdown(records),
    hungPieceCount,
    positionalCount,
    timePressureCount: timePressureCount(records),
    weakOpenings: weakOpenings(records),
    trend: buildTrend(records)
  }
}

const TIME_CONTROL_CATEGORIES: TimeControlCategory[] = ['bullet', 'blitz', 'rapid', 'daily']

export function buildInsightsReport(
  records: GameInsightRecord[],
  lastScanTime: number | null
): Omit<InsightsReport, 'topFindings'> {
  const buckets: InsightsBucket[] = [buildBucket('overall', records)]

  for (const category of TIME_CONTROL_CATEGORIES) {
    const recordsInCategory = records.filter((r) => r.timeControlCategory === category)
    if (recordsInCategory.length === 0) continue
    buckets.push(buildBucket(category, recordsInCategory))
  }

  return { gamesScanned: records.length, lastScanTime, buckets }
}

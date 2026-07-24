import type {
  GameInsightMistake,
  GameInsightRecord,
  InsightsBucket,
  InsightsBucketKey,
  InsightsReport,
  MistakeSummary,
  OpeningStat,
  PhaseBreakdown,
  TacticTrend,
  TacticType,
  TimeControlCategory
} from '../../shared/types'
import { TACTIC_TYPES } from '../../shared/types'
import { buildTrend } from './trendBucketing'

const MIN_GAMES_FOR_BUCKET = 5
const MIN_GAMES_PER_OPENING = 3
const MAX_RECENT_MISTAKES = 20
const MIN_MISTAKES_PER_HALF_FOR_TREND = 3
const TREND_SHARE_DELTA_THRESHOLD = 0.15

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

function emptyTacticBreakdown(): Record<TacticType, number> {
  const breakdown = {} as Record<TacticType, number>
  for (const type of TACTIC_TYPES) breakdown[type] = 0
  return breakdown
}

function tallyTactics(
  records: GameInsightRecord[],
  pick: (mistake: GameInsightMistake) => TacticType[]
): Record<TacticType, number> {
  const breakdown = emptyTacticBreakdown()
  for (const record of records) {
    for (const mistake of record.mistakes) {
      for (const tag of pick(mistake)) breakdown[tag] += 1
    }
  }
  return breakdown
}

// Splits records at their chronological midpoint and compares each
// tactic's share of punished-by mistakes between the two halves --
// surfaces only tactics whose share moved by at least
// TREND_SHARE_DELTA_THRESHOLD, and only when both halves have enough
// mistakes to make the comparison meaningful.
function tacticTrends(records: GameInsightRecord[]): TacticTrend[] {
  const sorted = [...records].sort((a, b) => a.endTime - b.endTime)
  const midpoint = Math.floor(sorted.length / 2)
  const older = sorted.slice(0, midpoint)
  const newer = sorted.slice(midpoint)

  const olderCounts = tallyTactics(older, (m) => m.punishedByTactics)
  const newerCounts = tallyTactics(newer, (m) => m.punishedByTactics)
  const olderTotal = Object.values(olderCounts).reduce((sum, n) => sum + n, 0)
  const newerTotal = Object.values(newerCounts).reduce((sum, n) => sum + n, 0)

  if (olderTotal < MIN_MISTAKES_PER_HALF_FOR_TREND || newerTotal < MIN_MISTAKES_PER_HALF_FOR_TREND) return []

  const trends: TacticTrend[] = []
  for (const type of TACTIC_TYPES) {
    const olderShare = olderCounts[type] / olderTotal
    const newerShare = newerCounts[type] / newerTotal
    if (Math.abs(newerShare - olderShare) >= TREND_SHARE_DELTA_THRESHOLD) {
      trends.push({ type, olderShare, newerShare })
    }
  }
  return trends
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

function recentMistakes(records: GameInsightRecord[]): MistakeSummary[] {
  const all: MistakeSummary[] = []
  for (const record of records) {
    for (const mistake of record.mistakes) {
      all.push({
        gameUrl: record.gameUrl,
        endTime: record.endTime,
        opponentUsername: record.opponentUsername,
        ply: mistake.ply,
        phase: mistake.phase,
        cpLoss: mistake.cpLoss,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics
      })
    }
  }
  return all.sort((a, b) => b.endTime - a.endTime).slice(0, MAX_RECENT_MISTAKES)
}

function buildBucket(key: InsightsBucketKey, records: GameInsightRecord[]): InsightsBucket {
  const totalMistakes = records.reduce((sum, r) => sum + r.mistakes.length, 0)

  return {
    key,
    gamesCount: records.length,
    hasEnoughData: records.length >= MIN_GAMES_FOR_BUCKET,
    totalMistakes,
    averageAccuracy: averageAccuracy(records),
    phaseBreakdown: phaseBreakdown(records),
    tacticBreakdown: tallyTactics(records, (m) => m.punishedByTactics),
    missedTacticBreakdown: tallyTactics(records, (m) => m.missedTactics),
    timePressureCount: timePressureCount(records),
    weakOpenings: weakOpenings(records),
    trend: buildTrend(records),
    recentMistakes: recentMistakes(records),
    tacticTrends: tacticTrends(records)
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

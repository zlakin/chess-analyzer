import type { InsightsBucket, InsightsReport, PhaseBreakdown, TopFinding } from '../../shared/types'

const MIN_MISTAKES_FOR_PHASE_FINDING = 5
const PHASE_SHARE_THRESHOLD = 0.5
const MIN_MISTAKES_FOR_HUNGPIECE_FINDING = 5
const HUNGPIECE_SHARE_THRESHOLD = 0.3
const MIN_TIME_PRESSURE_FOR_FINDING = 3
const ACCURACY_GAP_FOR_OPENING_FINDING = 5

function bucketLabel(bucket: InsightsBucket): string {
  return bucket.key === 'overall' ? '' : ` in ${bucket.key}`
}

function worstPhase(breakdown: PhaseBreakdown): { phase: keyof PhaseBreakdown; count: number } {
  const entries: Array<[keyof PhaseBreakdown, number]> = [
    ['opening', breakdown.opening],
    ['middlegame', breakdown.middlegame],
    ['endgame', breakdown.endgame]
  ]
  return entries.reduce<{ phase: keyof PhaseBreakdown; count: number }>(
    (best, [phase, count]) => (count > best.count ? { phase, count } : best),
    { phase: 'opening', count: -1 }
  )
}

function phaseFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.totalMistakes < MIN_MISTAKES_FOR_PHASE_FINDING) return null

  const { phase, count } = worstPhase(bucket.phaseBreakdown)
  const share = count / bucket.totalMistakes
  if (share < PHASE_SHARE_THRESHOLD) return null

  return {
    text: `${Math.round(share * 100)}% of your blunders/mistakes happen in the ${phase} (${count} of ${bucket.totalMistakes})${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
  }
}

function hungPieceFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.totalMistakes < MIN_MISTAKES_FOR_HUNGPIECE_FINDING) return null
  const share = bucket.hungPieceCount / bucket.totalMistakes
  if (share < HUNGPIECE_SHARE_THRESHOLD) return null

  return {
    text: `${bucket.hungPieceCount} of your ${bucket.totalMistakes} mistakes simply hung a piece${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
  }
}

function timePressureFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.timePressureCount < MIN_TIME_PRESSURE_FOR_FINDING) return null

  return {
    text: `${bucket.timePressureCount} of your mistakes were made with very little time on the clock${bucketLabel(bucket)}`,
    significance: bucket.timePressureCount
  }
}

function openingFindings(bucket: InsightsBucket): TopFinding[] {
  return bucket.weakOpenings
    .filter((opening) => bucket.averageAccuracy - opening.accuracy >= ACCURACY_GAP_FOR_OPENING_FINDING)
    .map((opening) => ({
      text: `Your accuracy in the ${opening.name} is ${opening.accuracy.toFixed(0)}% vs ${bucket.averageAccuracy.toFixed(0)}% overall${bucketLabel(bucket)} (${opening.games} games)`,
      significance: (bucket.averageAccuracy - opening.accuracy) * opening.games
    }))
}

export function synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[] {
  const findings: TopFinding[] = []

  for (const bucket of report.buckets) {
    if (!bucket.hasEnoughData) continue

    for (const candidate of [phaseFinding(bucket), hungPieceFinding(bucket), timePressureFinding(bucket)]) {
      if (candidate) findings.push(candidate)
    }
    findings.push(...openingFindings(bucket))
  }

  return findings.sort((a, b) => b.significance - a.significance)
}

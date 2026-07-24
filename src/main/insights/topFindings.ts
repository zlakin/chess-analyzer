import type { InsightsBucket, InsightsReport, PhaseBreakdown, TacticType, TopFinding } from '../../shared/types'

const MIN_MISTAKES_FOR_PHASE_FINDING = 5
const PHASE_SHARE_THRESHOLD = 0.5
const MIN_COUNT_FOR_TACTIC_FINDING = 3
const TACTIC_SHARE_THRESHOLD = 0.25
const MIN_TIME_PRESSURE_FOR_FINDING = 3
const TIME_PRESSURE_SHARE_THRESHOLD = 0.3
const ACCURACY_GAP_FOR_OPENING_FINDING = 5

const TACTIC_LABELS: Record<TacticType, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discovered_attack: 'discovered attack',
  back_rank_mate: 'back-rank mate',
  hung_piece: 'hung piece'
}

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

// Runs once for missedTacticBreakdown (what the player failed to find)
// and once for tacticBreakdown (what actually punished them) -- same
// thresholding logic, different verb in the generated sentence.
function tacticFindings(
  bucket: InsightsBucket,
  breakdown: Record<TacticType, number>,
  verb: string
): TopFinding[] {
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0)
  if (total === 0) return []

  const findings: TopFinding[] = []
  for (const [tag, count] of Object.entries(breakdown) as Array<[TacticType, number]>) {
    if (count < MIN_COUNT_FOR_TACTIC_FINDING) continue
    const share = count / total
    if (share < TACTIC_SHARE_THRESHOLD) continue

    findings.push({
      text: `You've ${verb} ${count} ${TACTIC_LABELS[tag]}${count === 1 ? '' : 's'} in your last ${bucket.gamesCount} games${bucketLabel(bucket)}`,
      significance: share * total
    })
  }
  return findings
}

function timePressureFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.timePressureCount < MIN_TIME_PRESSURE_FOR_FINDING) return null
  if (bucket.totalMistakes === 0) return null

  const share = bucket.timePressureCount / bucket.totalMistakes
  if (share < TIME_PRESSURE_SHARE_THRESHOLD) return null

  return {
    text: `${bucket.timePressureCount} of your mistakes were made with very little time on the clock${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
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

function trendFindings(bucket: InsightsBucket): TopFinding[] {
  return bucket.tacticTrends.map((trend) => {
    const direction = trend.newerShare > trend.olderShare ? 'more often' : 'less often'
    const deltaShare = Math.abs(trend.newerShare - trend.olderShare)
    return {
      text: `You're being caught by ${TACTIC_LABELS[trend.type]}s ${direction} than earlier in your history${bucketLabel(bucket)}`,
      significance: deltaShare * bucket.totalMistakes
    }
  })
}

export function synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[] {
  const findings: TopFinding[] = []

  for (const bucket of report.buckets) {
    if (!bucket.hasEnoughData) continue

    const phase = phaseFinding(bucket)
    if (phase) findings.push(phase)

    findings.push(...tacticFindings(bucket, bucket.missedTacticBreakdown, 'missed'))
    findings.push(...tacticFindings(bucket, bucket.tacticBreakdown, 'been caught by'))

    const timePressure = timePressureFinding(bucket)
    if (timePressure) findings.push(timePressure)

    findings.push(...openingFindings(bucket))
    findings.push(...trendFindings(bucket))
  }

  return findings.sort((a, b) => b.significance - a.significance)
}

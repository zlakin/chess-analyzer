import type { InsightsBucket, InsightsReport, PhaseBreakdown, TacticType, TopFinding } from '../../shared/types'
import { ACCURACY_GAP_FOR_OPENING_FINDING } from './reportAggregator'

const MIN_MISTAKES_FOR_PHASE_FINDING = 5
const PHASE_SHARE_THRESHOLD = 0.5
const MIN_COUNT_FOR_TACTIC_FINDING = 3
const TACTIC_SHARE_THRESHOLD = 0.25
const MIN_TIME_PRESSURE_FOR_FINDING = 3
const TIME_PRESSURE_SHARE_THRESHOLD = 0.3

const TACTIC_LABELS: Record<TacticType, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discovered_attack: 'discovered attack',
  back_rank_mate: 'back-rank mate',
  hung_piece: 'hung piece'
}

// What a finding is actually about, independent of which bucket produced
// it - the same fact (e.g. "most mistakes happen in the middlegame") often
// gets generated once per bucket scope; this key is how synthesizeTopFindings
// recognizes that and keeps only the strongest instance.
interface FindingCandidate extends TopFinding {
  groupKey: string
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

function phaseFinding(bucket: InsightsBucket): FindingCandidate | null {
  if (bucket.totalMistakes < MIN_MISTAKES_FOR_PHASE_FINDING) return null

  const { phase, count } = worstPhase(bucket.phaseBreakdown)
  const share = count / bucket.totalMistakes
  if (share < PHASE_SHARE_THRESHOLD) return null

  return {
    text: `${Math.round(share * 100)}% of your blunders/mistakes happen in the ${phase} (${count} of ${bucket.totalMistakes})${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes,
    groupKey: `phase:${phase}`
  }
}

// Runs once for missedTacticBreakdown (what the player failed to find)
// and once for tacticBreakdown (what actually punished them) -- same
// thresholding logic, different verb in the generated sentence and a
// different groupPrefix so a "missed fork" finding never collapses into
// a "caught by fork" one, or vice versa.
function tacticFindings(
  bucket: InsightsBucket,
  breakdown: Record<TacticType, number>,
  verb: string,
  groupPrefix: string
): FindingCandidate[] {
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0)
  if (total === 0) return []

  const findings: FindingCandidate[] = []
  for (const [tag, count] of Object.entries(breakdown) as Array<[TacticType, number]>) {
    if (count < MIN_COUNT_FOR_TACTIC_FINDING) continue
    const share = count / total
    if (share < TACTIC_SHARE_THRESHOLD) continue

    findings.push({
      text: `You've ${verb} ${count} ${TACTIC_LABELS[tag]}${count === 1 ? '' : 's'} in your last ${bucket.gamesCount} games${bucketLabel(bucket)}`,
      significance: share * total,
      groupKey: `${groupPrefix}:${tag}`
    })
  }
  return findings
}

function timePressureFinding(bucket: InsightsBucket): FindingCandidate | null {
  if (bucket.timePressureCount < MIN_TIME_PRESSURE_FOR_FINDING) return null
  if (bucket.totalMistakes === 0) return null

  const share = bucket.timePressureCount / bucket.totalMistakes
  if (share < TIME_PRESSURE_SHARE_THRESHOLD) return null

  return {
    text: `${bucket.timePressureCount} of your mistakes were made with very little time on the clock${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes,
    groupKey: 'time-pressure'
  }
}

function openingFindings(bucket: InsightsBucket): FindingCandidate[] {
  return bucket.weakOpenings
    .filter((opening) => bucket.averageAccuracy - opening.accuracy >= ACCURACY_GAP_FOR_OPENING_FINDING)
    .map((opening) => ({
      text: `Your accuracy in the ${opening.name} is ${opening.accuracy.toFixed(0)}% vs ${bucket.averageAccuracy.toFixed(0)}% overall${bucketLabel(bucket)} (${opening.games} games)`,
      significance: (bucket.averageAccuracy - opening.accuracy) * opening.games,
      groupKey: `opening:${opening.name}`
    }))
}

function trendFindings(bucket: InsightsBucket): FindingCandidate[] {
  return bucket.tacticTrends.map((trend) => {
    const direction = trend.newerShare > trend.olderShare ? 'more often' : 'less often'
    const deltaShare = Math.abs(trend.newerShare - trend.olderShare)
    return {
      text: `You're being caught by ${TACTIC_LABELS[trend.type]}s ${direction} than earlier in your history${bucketLabel(bucket)}`,
      significance: deltaShare * bucket.totalMistakes,
      groupKey: `trend:${trend.type}`
    }
  })
}

export function synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[] {
  const candidates: FindingCandidate[] = []

  for (const bucket of report.buckets) {
    if (!bucket.hasEnoughData) continue

    const phase = phaseFinding(bucket)
    if (phase) candidates.push(phase)

    candidates.push(...tacticFindings(bucket, bucket.missedTacticBreakdown, 'missed', 'tactic-missed'))
    candidates.push(...tacticFindings(bucket, bucket.tacticBreakdown, 'been caught by', 'tactic-caught'))

    const timePressure = timePressureFinding(bucket)
    if (timePressure) candidates.push(timePressure)

    candidates.push(...openingFindings(bucket))
    candidates.push(...trendFindings(bucket))
  }

  // The same underlying fact often surfaces at multiple scopes (e.g. "most
  // mistakes happen in the middlegame" both overall and, more strongly, in
  // bullet specifically) - keep only the single highest-significance
  // instance per distinct fact, rather than showing every scope's version
  // as if they were separate findings.
  const bestByGroup = new Map<string, FindingCandidate>()
  for (const candidate of candidates) {
    const existing = bestByGroup.get(candidate.groupKey)
    if (!existing || candidate.significance > existing.significance) {
      bestByGroup.set(candidate.groupKey, candidate)
    }
  }

  return Array.from(bestByGroup.values())
    .map((candidate) => ({ text: candidate.text, significance: candidate.significance }))
    .sort((a, b) => b.significance - a.significance)
}

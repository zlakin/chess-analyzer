# Insights Tab Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Insights tab's two decluttering problems — redundant top findings restating the same fact at multiple bucket scopes, and an uneven side-by-side grid of five buckets each dumping unbounded detail — without changing any underlying scan/cache data.

**Architecture:** `src/main/insights/topFindings.ts` gains an internal `groupKey` per candidate finding (what the finding is actually about, independent of which bucket produced it) and dedupes across buckets before returning, keeping only the highest-significance instance per group — `TopFinding`'s public shape is unchanged. The renderer replaces the `.insights-buckets` grid in `InsightsTab.tsx` with a new `BucketTabs.tsx` that shows one bucket's detail at a time behind a tab strip reusing this app's existing `.segmented-control` styling, and `TimeControlSection.tsx` caps its recent-mistakes list to 5 with a "Show more" expand and gets small chart-title labels, taller charts, and a tooltip styled to match the app's tokens.

## Global Constraints

- `TopFinding`'s public shape (`{ text: string; significance: number }`) does not change — dedup is entirely internal to `synthesizeTopFindings`.
- No change to `InsightsBucket`, `InsightsReport`, `reportAggregator.ts`, or `insightsStore.ts` — this plan only touches `topFindings.ts` and the renderer's `components/insights/` + `InsightsTab.tsx` + `app.css`.
- Deduped findings show only the single best-scoped instance — no cross-reference annotation ("...especially in bullet"), per explicit user choice.
- Both charts stay single-series, one hue (`--accent`) — no new palette, no legend.
- This repo's git workflow: commit straight to `main` (no branches/worktrees/PRs).

---

### Task 1: Findings dedup (`topFindings.ts`)

**Files:**
- Modify: `src/main/insights/topFindings.ts`
- Modify: `src/main/insights/topFindings.test.ts`

**Interfaces:**
- Consumes: `InsightsBucket`, `InsightsReport`, `TopFinding`, `TacticType` (`src/shared/types.ts`, all unchanged).
- Produces: `synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[]` — same signature as today. Its behavior changes (deduped output), but nothing about its call site in `src/main/ipc/handlers.ts` needs to change.

- [ ] **Step 1: Replace `src/main/insights/topFindings.ts` in full**

```ts
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
```

- [ ] **Step 2: Replace `src/main/insights/topFindings.test.ts` in full**

One existing test ("ranks findings by significance, most significant first") previously used two *same-kind* time-pressure findings from different buckets to prove sort order — under the new dedup behavior those two candidates now collapse into one (that's the feature working correctly), so that test is rewritten below to use two *different* findings instead, and two new tests are added that directly prove the dedup behavior itself.

```ts
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
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/main/insights/topFindings.test.ts
```

Expected: all 13 tests pass (the original 11 plus the 2 new dedup tests).

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/topFindings.ts src/main/insights/topFindings.test.ts
git commit -m "Dedupe redundant top findings across bucket scopes"
```

---

### Task 2: Renderer — bucket tabs, decluttered detail panel

**Files:**
- Create: `src/renderer/src/lib/insightsBucketLabels.ts`
- Create: `src/renderer/src/components/insights/BucketTabs.tsx`
- Modify: `src/renderer/src/components/insights/TimeControlSection.tsx`
- Modify: `src/renderer/src/components/InsightsTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `synthesizeTopFindings`'s deduped output (Task 1, transparent to this task — `InsightsReport.topFindings` is already deduped by the time it reaches the renderer, no renderer code needs to know that happened).
- Produces: `BucketTabs` is the new top-level renderer entry point for bucket display — nothing later consumes it beyond `InsightsTab.tsx`.

- [ ] **Step 1: Write `src/renderer/src/lib/insightsBucketLabels.ts`**

Extracted from `TimeControlSection.tsx` so both it and the new `BucketTabs.tsx` share one copy instead of two.

```ts
import type { InsightsBucketKey } from '../../../shared/types'

export const BUCKET_LABELS: Record<InsightsBucketKey, string> = {
  overall: 'Overall',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Daily'
}
```

- [ ] **Step 2: Write `src/renderer/src/components/insights/BucketTabs.tsx`**

```tsx
import { useState } from 'react'
import type { InsightsBucket, InsightsBucketKey } from '../../../../shared/types'
import { BUCKET_LABELS } from '../../lib/insightsBucketLabels'
import { TimeControlSection } from './TimeControlSection'

interface BucketTabsProps {
  buckets: InsightsBucket[]
}

export function BucketTabs({ buckets }: BucketTabsProps): JSX.Element | null {
  const [selectedKey, setSelectedKey] = useState<InsightsBucketKey>('overall')

  const selected = buckets.find((bucket) => bucket.key === selectedKey)
  if (!selected) return null

  return (
    <div className="bucket-tabs">
      <nav className="segmented-control">
        {buckets.map((bucket) => (
          <button
            key={bucket.key}
            className={`segmented-control-option${bucket.key === selectedKey ? ' active' : ''}`}
            onClick={() => setSelectedKey(bucket.key)}
          >
            {BUCKET_LABELS[bucket.key]}
          </button>
        ))}
      </nav>
      {/* Keyed on the bucket so switching tabs remounts the panel fresh -
          otherwise an expanded "show more" state from one bucket would
          silently carry over to whichever bucket is selected next. */}
      <TimeControlSection key={selected.key} bucket={selected} />
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/renderer/src/components/insights/TimeControlSection.tsx` in full**

The bucket-name `<h3>` heading is removed from both branches — the tab strip in `BucketTabs` already shows which bucket is selected, so repeating its name inside the panel is now redundant. `BUCKET_LABELS` is no longer imported here at all (only `BucketTabs.tsx` needs it, for the tab labels).

```tsx
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { InsightsBucket, TacticType } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'
import { RecentMistakesList } from './RecentMistakesList'

interface TimeControlSectionProps {
  bucket: InsightsBucket
}

const RECENT_MISTAKES_PREVIEW_COUNT = 5

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--panel-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-control)',
    fontSize: '0.8rem'
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' }
}

export function TimeControlSection({ bucket }: TimeControlSectionProps): JSX.Element {
  const [showAllMistakes, setShowAllMistakes] = useState(false)

  if (!bucket.hasEnoughData) {
    return (
      <div className="time-control-section time-control-section-empty">
        <p className="not-enough-data">Not enough games yet ({bucket.gamesCount} scanned).</p>
      </div>
    )
  }

  const phaseData = [
    { phase: 'Opening', count: bucket.phaseBreakdown.opening },
    { phase: 'Middlegame', count: bucket.phaseBreakdown.middlegame },
    { phase: 'Endgame', count: bucket.phaseBreakdown.endgame }
  ]

  const tacticEntries = (Object.entries(bucket.tacticBreakdown) as Array<[TacticType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  const visibleMistakes = showAllMistakes
    ? bucket.recentMistakes
    : bucket.recentMistakes.slice(0, RECENT_MISTAKES_PREVIEW_COUNT)
  const hiddenMistakesCount = bucket.recentMistakes.length - visibleMistakes.length

  return (
    <div className="time-control-section">
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.timePressureCount} under time pressure
      </p>

      {tacticEntries.length > 0 && (
        <div className="tactic-chip-row">
          {tacticEntries.map(([tag, count]) => (
            <span key={tag} className="tactic-chip">
              {TACTIC_LABELS[tag]} &times;{count}
            </span>
          ))}
        </div>
      )}

      <h4 className="insights-subheading">Mistakes by phase</h4>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={phaseData}>
          <XAxis dataKey="phase" stroke="var(--text-muted)" />
          <YAxis allowDecimals={false} stroke="var(--text-muted)" />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
          <Bar dataKey="count" fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>

      {bucket.weakOpenings.length > 0 && (
        <>
          <h4 className="insights-subheading">Weak openings</h4>
          <table className="weak-openings-table">
            <thead>
              <tr>
                <th>Opening</th>
                <th>Games</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {bucket.weakOpenings.map((opening) => (
                <tr key={opening.name}>
                  <td>{opening.name}</td>
                  <td>{opening.games}</td>
                  <td>{opening.accuracy.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {bucket.trend.length > 1 && (
        <>
          <h4 className="insights-subheading">Accuracy trend</h4>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={bucket.trend}>
              <XAxis dataKey="gameIndex" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)}%` : '')}
              />
              <Area
                type="monotone"
                dataKey="rollingAccuracy"
                stroke="var(--accent)"
                fill="var(--accent)"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {bucket.recentMistakes.length > 0 && (
        <>
          <h4 className="insights-subheading">Recent mistakes</h4>
          <RecentMistakesList mistakes={visibleMistakes} />
          {hiddenMistakesCount > 0 && (
            <button className="button-secondary show-more-mistakes" onClick={() => setShowAllMistakes(true)}>
              Show {hiddenMistakesCount} more
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire `BucketTabs` into `src/renderer/src/components/InsightsTab.tsx`**

Change the import from `TimeControlSection` to `BucketTabs`:

```ts
import { BucketTabs } from './insights/BucketTabs'
```

Replace the `.insights-buckets` block:

```tsx
          <div className="insights-buckets">
            {state.report.buckets.map((bucket) => (
              <TimeControlSection key={bucket.key} bucket={bucket} />
            ))}
          </div>
```

with:

```tsx
          <BucketTabs buckets={state.report.buckets} />
```

- [ ] **Step 5: Update `src/renderer/src/app.css`**

Remove the now-unused `.insights-buckets` rule (nothing renders a `.insights-buckets` element anymore after Step 4):

```css
.insights-buckets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}
```

Remove `.time-control-section-empty`'s now-meaningless `align-self: start` (it was only relevant as a grid/flex child, and `TimeControlSection` is no longer laid out as one):

```css
.time-control-section-empty {
  align-self: start;
}
```

Remove the `.time-control-section h3` rule (the heading it targeted no longer exists after Step 3):

```css
.time-control-section h3 {
  font-family: var(--font-display);
  font-weight: 600;
  margin: 0 0 0.25rem;
}
```

Add, directly after the (now-modified) `.time-control-section` rule:

```css
.bucket-tabs {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bucket-tabs .time-control-section {
  max-width: 640px;
}

.show-more-mistakes {
  margin-top: 0.5rem;
}
```

- [ ] **Step 6: Typecheck, run the full suite, build**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (same total as Task 1 left it — this task adds no new test files, per this repo's no-jsdom policy for components).

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 7: Verify via `run-desktop`**

This account already has a scanned Insights report cached in this dev environment (test account `zlakin`, 98 games) — no fresh scan needed unless the cache is missing.

```bash
cat > /tmp/verify-insights-declutter.txt <<'EOF'
launch
click-text Insights
sleep 500
ss insights-declutter-initial
eval document.querySelectorAll('.bucket-tabs .segmented-control-option').length
eval document.querySelector('.bucket-tabs .segmented-control-option.active')?.textContent
eval document.querySelectorAll('.recent-mistake-row').length
click-text Bullet
sleep 300
ss insights-declutter-bullet-tab
eval document.querySelector('.bucket-tabs .segmented-control-option.active')?.textContent
click-text Overall
sleep 300
eval document.querySelectorAll('.recent-mistake-row').length
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-insights-declutter.txt
```

Expected: exactly 5 tab options (matching bucket count), "Overall" active by default, at most 5 `.recent-mistake-row` elements visible initially (the preview cap) with a "Show N more" button if the bucket has more than 5. Clicking "Bullet" switches the active tab and shows Bullet's own detail panel (different summary numbers, its own recent mistakes reset to the 5-item preview — confirmed by the same `.recent-mistake-row` count check after switching back to "Overall": it should read 5 again, not whatever count was left over from a "Show more" click, proving the `key`-based remount in `BucketTabs` actually resets state). Compare `insights-declutter-initial` visually against the top findings section too — with 98 real games of data, several near-duplicate findings (hung-piece/middlegame variants) that appeared as separate bullets before this plan should now appear as fewer, more distinct bullets.

Also test the expand interaction directly:

```bash
cat > /tmp/verify-insights-expand.txt <<'EOF'
launch
click-text Insights
sleep 500
eval document.querySelectorAll('.recent-mistake-row').length
click-text Show
sleep 300
ss insights-declutter-expanded
eval document.querySelectorAll('.recent-mistake-row').length
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-insights-expand.txt
```

Expected: the second count is larger than the first (up to the bucket's full `recentMistakes` length, capped at 20 by `MAX_RECENT_MISTAKES` in `reportAggregator.ts`), and the "Show N more" button is gone from `insights-declutter-expanded` since everything is now visible.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f /tmp/verify-insights-declutter.txt /tmp/verify-insights-expand.txt
git add src/renderer/src/lib/insightsBucketLabels.ts src/renderer/src/components/insights/BucketTabs.tsx \
  src/renderer/src/components/insights/TimeControlSection.tsx src/renderer/src/components/InsightsTab.tsx \
  src/renderer/src/app.css
git commit -m "Replace the Insights bucket grid with a single-bucket tab strip"
```

## Testing

Task 1 has real unit tests for the dedup logic (13 total, 2 new — direct proof that a same-groupKey finding from a weaker-scoped bucket is dropped in favor of the strongest one). Task 2's UI is verified via `run-desktop` against the real built app with real scanned data, matching this codebase's established no-jsdom policy for components.

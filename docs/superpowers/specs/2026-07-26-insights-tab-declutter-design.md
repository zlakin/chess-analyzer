# Insights tab declutter — design

## Problem

The Insights tab has two distinct problems, both confirmed against the actual running app (test account `zlakin`, 98 scanned games):

1. **Top findings are redundant, not organized.** `synthesizeTopFindings` (`src/main/insights/topFindings.ts`) generates one finding per bucket (`overall`, `bullet`, `blitz`, `rapid`, `daily`) independently, with no awareness of what any other bucket produced. The same underlying fact routinely surfaces 3-4 times at different scopes — e.g. "64% of your blunders/mistakes happen in the middlegame" (overall), then "61%... in rapid," then "69%... in bullet" all appear as three separate, equally-weighted top findings. Same pattern for hung-piece counts. What reads as 8 facts is really 2-3.
2. **The bucket grid is an uneven wall of content.** `InsightsTab.tsx` renders all 5 buckets side by side in a CSS grid (`.insights-buckets`, `repeat(auto-fit, minmax(320px, 1fr))`). Each populated bucket (`TimeControlSection.tsx`) stacks a summary line, a tactic-chip row, a phase-breakdown bar chart, a weak-openings table, a trend area chart, and up to 20 full "recent mistake" cards (`MAX_RECENT_MISTAKES` in `reportAggregator.ts`) with zero pagination — while a thin bucket like "Blitz: not enough games yet" sits awkwardly next to a column that scrolls for several screens.

## Scope

Insights tab only: the findings-generation logic in `src/main/insights/topFindings.ts` and the renderer components under `src/renderer/src/components/insights/`. Does not touch the scan/cache infrastructure, `reportAggregator.ts`'s bucket-building logic, or the `InsightsBucket`/`InsightsReport` shared types — only `topFindings.ts`'s internal aggregation changes, and its output shape (`TopFinding[]`) is unchanged.

## 1. Findings dedup (`src/main/insights/topFindings.ts`)

Each of the six existing finding-generator functions (`phaseFinding`, `tacticFindings` ×2 call sites, `timePressureFinding`, `openingFindings`, `trendFindings`) already computes a `text` and a `significance` score per candidate. This adds a `groupKey` to each candidate — a string identifying *what the finding is actually about*, independent of which bucket produced it:

| Generator | groupKey |
|---|---|
| `phaseFinding` | `` `phase:${phase}` `` (e.g. `phase:middlegame`) |
| `tacticFindings` (missed) | `` `tactic-missed:${tag}` `` |
| `tacticFindings` (caught) | `` `tactic-caught:${tag}` `` |
| `timePressureFinding` | `'time-pressure'` |
| `openingFindings` | `` `opening:${name}` `` |
| `trendFindings` | `` `trend:${type}` `` |

`synthesizeTopFindings` collects every candidate (now `TopFinding & { groupKey: string }` internally), groups them by `groupKey`, and keeps only the single highest-`significance` candidate per group — discarding the rest as pure duplicates of a fact already represented at a stronger scope. The final step strips `groupKey` before sorting by `significance` and returning `TopFinding[]`, so the public shape (`{ text, significance }`) and every existing consumer (`InsightsTab.tsx`, `TopFindingsList.tsx`) are unchanged.

This is a pure data-layer change with no UI dependency. For `phaseFinding`, `tacticFindings`, and `timePressureFinding`, `significance` is `share * total` where `share = count / total` — which algebraically reduces to just `count`, the raw mistake/tactic count for that bucket. Because `overall` aggregates every game across every time control, its raw count for any given fact is always ≥ any single time-control bucket's count for that same fact. So the `overall`-scope version of a fact almost always wins dedup whenever it also clears its own threshold (e.g. a `phase:middlegame` finding at `overall` scope beats the `bullet` or `rapid` scope version) — this is the correct default for a top-level summary, since it surfaces the broadest, most representative version of the fact, not an accident of a share-weighted formula.

## 2. Bucket tabs (new `src/renderer/src/components/insights/BucketTabs.tsx`)

Replaces `InsightsTab.tsx`'s `.insights-buckets` grid (which currently `.map()`s every bucket into its own `TimeControlSection`) with a single component that:

- Renders a tab strip — Overall · Bullet · Blitz · Rapid · Daily — reusing the existing `.segmented-control`/`.segmented-control-option`/`.active` classes verbatim (the same classes `NavBar.tsx` already uses for the top-level Analyze/Insights/Puzzles tabs), so it reads as the same "pick one, see its detail" affordance already established elsewhere in this app, not a new visual language.
- Owns `selectedKey: InsightsBucketKey` as local state, defaulting to `'overall'` (always present once any game is scanned).
- Renders exactly one `TimeControlSection` — for whichever bucket matches `selectedKey` — below the tab strip. A bucket with `hasEnoughData === false` still gets a tab and, when selected, still shows the existing "Not enough games yet" message (unchanged from today), just in the single-panel view instead of an awkward grid cell.

`InsightsTab.tsx` changes from `state.report.buckets.map((bucket) => <TimeControlSection key={bucket.key} bucket={bucket} />)` inside `.insights-buckets` to a single `<BucketTabs buckets={state.report.buckets} />`.

## 3. Decluttering `TimeControlSection.tsx`

- **Recent mistakes capped with expand.** `TimeControlSection` gains local state `showAllMistakes: boolean` (default `false`). Renders `bucket.recentMistakes.slice(0, showAllMistakes ? undefined : 5)` via the existing `RecentMistakesList` (unchanged itself — it stays a dumb list renderer). When `bucket.recentMistakes.length > 5` and collapsed, a "Show N more" button appears below the list; clicking sets `showAllMistakes = true` and the button is replaced by nothing (the full list is now showing — no separate "show less," matching this app's existing preference for simple, one-directional reveal controls over toggle affordances).
- **Chart polish**, informed by the dataviz skill (both charts are single-series — magnitude-across-3-categories for the bar chart, one metric over time for the area chart — so this is a sizing/labeling/tooltip fix, not a new palette; no legend needed, `--accent` stays the one hue for both):
  - Each chart gets a small label directly above it using the existing `.insights-subheading` class (already used for "Weak openings"/"Recent mistakes" — reused for consistency): "Mistakes by phase" above the bar chart, "Accuracy trend" above the area chart.
  - Bar chart height goes from 120px to 160px; area chart from 100px to 120px — both currently cramped enough that axis labels crowd the plot area.
  - Both charts' `<Tooltip>` gets a `contentStyle`/`labelStyle`/`itemStyle` matching this app's existing panel tokens (`--panel-elevated` background, `--border` border, `--text` label color) instead of recharts' unstyled default, which doesn't adapt to the app's light/dark theme tokens today.

## Out of scope

- No change to `InsightsBucket`, `InsightsReport`, or any other shared type.
- No change to how buckets are computed, scanned, or cached (`reportAggregator.ts`, `insightsStore.ts`).
- No new charts, no click-to-review coaching board (that's the still-deferred Phase 2 from the tactical-insights initiative) — this pass is decluttering existing information, not adding new interactive features.
- No cross-scope annotation on deduped findings (e.g. "especially in bullet") — the single best-scoped finding stands alone, per explicit user choice.

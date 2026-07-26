# Analyze Tab Re-render Performance Implementation Plan

> Executed directly in-session (not via subagent-driven-development) — a
> small, well-scoped, five-file mechanical fix with no open design
> questions, following the approved design spec at
> `docs/superpowers/specs/2026-07-25-analyze-tab-rerender-perf-design.md`.

**Goal:** Eliminate unnecessary re-renders on the Analyze tab's ply
navigation (`GameSummary`, `MoveButton` re-rendering when their actual
displayed content hasn't changed).

## What was done

1. Wrapped `EvalBar`, `Board`, `EvalGraph`, `GameSummary`, `MoveList`,
   and `MoveButton` (the row-level component inside `MoveList.tsx`) in
   `React.memo`.
2. `Board.tsx`: wrapped the `arrows` array construction in
   `useMemo(() => ..., [bestMoveUci])` (previously rebuilt every render
   regardless of whether `bestMoveUci` changed).
3. `EvalGraph.tsx`: wrapped the `data` array construction in
   `useMemo(() => ..., [moves])` (depends only on `moves`, not
   `currentPly` — previously rebuilt on every ply-navigation render).
4. `MoveList.tsx`: the real fix, not just a wrapper —
   - Restructured `MoveButton` to take `ply: number` and the stable
     `onSelectPly: (ply: number) => void` directly instead of a
     pre-bound `onSelect: () => void` closure. The closure was
     reconstructed fresh on every `MoveList` render regardless of
     whether that specific row's state changed, which would have
     silently defeated `React.memo` on `MoveButton` (a new function
     reference every time always fails shallow prop comparison).
   - Wrapped the row-grouping computation (`rows` array) in
     `useMemo(() => ..., [moves])` — the grouping structure depends
     only on `moves`, never on `currentPly`.

## Verification

No new test dependencies added (this codebase's test suite is
logic-only — `.test.ts`, Node environment, no `@testing-library/react`
— see the design spec's Non-goals). React's `<Profiler>` API was tried
first and found to be a dead end: `onRender` is a no-op in standard
production builds (React strips the instrumentation for zero overhead
unless you use a special profiling-enabled production build), and the
`run-desktop` driver requires the production build (`npm run build`,
not `npm run dev`) — confirmed by driving the app and finding a real DOM
update (`.move.selected` text changed correctly) while
`window.__profilerLog` stayed empty the whole time.

Replaced with a simpler, build-mode-independent approach: a temporary
module (`src/renderer/src/__renderCount.ts`, deleted before commit)
exposing a `bump(name)` function called at the top of each target
component's render body, writing counts to `window.__renderCounts`.
Driven via `run-desktop` with a fixed script (load a real game, 5×
`ArrowRight`, read the counts) — run once against the unmemoized code
for a baseline, then again after the fix:

| Component | Before (5 keypresses) | After |
|---|---|---|
| GameSummary | 5 | **0** |
| MoveButton | 225 | **9** |
| EvalBar / Board / MoveList / EvalGraph | 5 each | 5 each (correct — these genuinely update every ply) |

`GameSummary` (accuracy scorecards, move-quality bar chart, Recharts)
no longer renders at all during ply navigation — its props (`moves`,
both accuracy numbers, both usernames) never change on navigation, so
it only re-renders when a new analysis actually completes.
`MoveButton` dropped from re-rendering all ~45 move buttons per
keypress to ~2 (only the row losing "selected" and the row gaining it).

All `bump()` call sites and the `__renderCount.ts` module itself were
removed before committing — this was measurement-only harness, not
permanent instrumentation.

Functional correctness re-verified after removing the harness (fresh
build): eval bar score, selected-move highlight, and board position all
update correctly through `ArrowRight` navigation, `Home`, and `End`;
`GameSummary`'s accuracy scorecards/legend still render correctly once
analysis is `done` (just no longer on every keypress). Full existing
Vitest suite stays green (`npm run verify`, 213/213, unaffected — no
logic changes, rendering-layer only).

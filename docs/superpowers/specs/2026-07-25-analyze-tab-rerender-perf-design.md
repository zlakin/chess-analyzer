# Analyze Tab Re-render Performance — Design Spec

Date: 2026-07-25

## Purpose

First of four sub-projects from a broader "premium performance & polish"
initiative (the other three — desktop-responsive layout, a theme toggle,
and interactive piece movement to explore variations — are separate,
larger pieces of work with real open design questions; this one doesn't
have any). An audit of the Analyze tab found zero use of `React.memo`
anywhere in `src/renderer/src/components/`: `Board`, `EvalBar`,
`EvalGraph`, `MoveList`, and `GameSummary` are siblings under `App.tsx`,
all keyed off `App`'s own `currentPly` state. Every arrow-key press
re-renders all five, including `GameSummary` — whose props (`moves`,
both accuracy numbers, both usernames) never change on ply navigation at
all, and which contains a Recharts bar chart.

## Non-goals

- No change to `useGameAnalysis`/`analysisReducer` — the state shape and
  IPC flow are correct as audited; this is a rendering-layer change only.
- No virtualization of the move list — the app only ever holds one game's
  worth of moves (tens, not thousands), so windowing would be solving a
  problem this app doesn't have.
- No new test-infrastructure category. This codebase's entire test suite
  is logic-only (`.test.ts`, `environment: 'node'`, no `.tsx` tests, no
  `@testing-library/react`) — adding component-render tests would be a
  real departure from that pattern, not a natural extension of it.

## Architecture

Wrap each of the five sibling components in `React.memo`, and fix the
two places where an unmemoized value would otherwise defeat that
wrapping:

- `Board.tsx`: the `arrows` array is rebuilt every render regardless of
  whether `bestMoveUci` changed. Wrap it in `useMemo(() => ..., [bestMoveUci])`.
- `MoveList.tsx`: `MoveButton` currently receives a freshly-constructed
  `onSelect` closure (`onSelect={() => onSelectPly(row.white!.ply)}`) on
  every `MoveList` render — memoizing `MoveButton` alone would do
  nothing, since that inline closure is a new function reference every
  time regardless of whether the row's own state changed. Restructure
  `MoveButton` to take `ply: number` and the stable `onSelectPly`
  directly, building its own `onClick` internally, so `React.memo`'s
  shallow prop comparison actually holds across renders where nothing
  about that specific row changed. Also wrap the row-grouping loop
  (`rows` array construction) in `useMemo(() => ..., [moves])` — it
  currently reruns on every render including pure ply-navigation ones,
  even though the grouping structure only depends on `moves`, never on
  `currentPly`.
- `EvalBar.tsx`, `EvalGraph.tsx`, `GameSummary.tsx`: wrap in `React.memo`
  as-is — their existing props are already the right shape for shallow
  comparison to work (primitives, or object references that are stable
  across `App`'s own `useState`/`useReducer`, confirmed by reading
  `useGameAnalysis.ts`: `state.moves` only changes via `dispatch` on real
  analysis-lifecycle events, never on `currentPly` changes, which live in
  a completely separate `useState` in `App`).

Expected result after the fix, on a single arrow-key press: `EvalBar`,
`Board`, and `MoveDetail` re-render (their displayed values genuinely
change), `MoveList` and `EvalGraph` re-render only enough to move the
active-row/position-indicator (not rebuild everything), and
`GameSummary` does not re-render at all.

## Verification

No new test dependencies. React's own built-in `<Profiler>` API
(zero-cost to add, already part of `react`) temporarily wraps the
`.analysis-layout` subtree in `App.tsx`, logging each commit's
`id`/`phase`/`actualDuration` to the console. Driven through the
existing `run-desktop` skill (already proven throughout this project for
real-app verification) with a fixed script: load a real game, then press
`ArrowRight` five times, capturing the profiler's console output.

Run once against the current (unmemoized) code for a baseline commit
count, then again after the fix, comparing the two directly — real
numbers from the actual running app, not a simulated/mocked render.
Remove the temporary `<Profiler>` wrapper before committing; it's a
measurement harness, not permanent instrumentation.

## Testing

Existing Vitest suite (`analysisReducer.test.ts`, `gameNavigation.test.ts`,
etc.) is unaffected — no logic changes, `npm run verify` must stay green.
No new automated test is added (see Non-goals) — the Profiler-based
before/after run is the verification artifact for this specific change,
documented in the implementation commit rather than as a permanent test.

# Mistake-Driven Puzzle Mode — Design Spec

Date: 2026-07-25

## Purpose

Following a competitive-landscape review, this was chosen as the app's
highest-leverage next feature: turn a player's own recorded mistakes
(already detected by the Insights tactical-insights engine) into a
spaced-repetition practice queue, so "here are your recurring weaknesses"
becomes "here's a drill queue for them" instead of staying purely
diagnostic. No competitor found in that research bundles this free,
local/offline, and integrated with a full review engine — it's always a
siloed paid cloud subscription elsewhere.

This spec depends on nothing new at the data-detection layer.
`GameInsightMistake` (`src/shared/types.ts:128-140`) already stores
everything a puzzle needs per mistake — `fenBefore`, `playedMoveUci`,
`bestMoveUci`, `missedTactics`/`punishedByTactics`, `cpLoss`,
`classification` (already filtered to `'mistake' | 'blunder'` only, see
`extractInsightRecord.ts:47-51`) — persisted per-game across up to 100
scanned games via `insightsStore.ts`. This spec is purely a new consumer
of that existing data, plus new spaced-repetition scheduling state.

## Non-goals

- No filtering out mistakes from already-decided positions (e.g.
  blundering further in a position that was already −800). Doing this
  well requires storing the position's pre-mistake raw eval, which isn't
  captured today (`GameInsightMistake` stores cp-*loss*, not the raw
  score) — a schema change and a forced full rescan for a polish concern
  not yet observed in practice. See Future Ideas.
- No daily new-card/review caps (Anki-style). The personal-mistakes-only
  deck is naturally small (tens to a couple hundred cards, not
  thousands) — the Puzzles tab just always shows whatever is currently
  due, no session-size limit.
- No manual curation of which mistakes enter the deck. Every
  mistake/blunder an Insights scan finds is automatically enrolled.
- No support for a puzzle having multiple canonical "correct" moves shown
  as alternatives in the UI — grading accepts any move within a cp-loss
  threshold of best (see Grading below), but only the one recorded
  `bestMoveUci` is ever displayed as the answer.
- No cross-device sync. SRS state is local-only, same as every other
  store in this app.

## Architecture

```
Insights scan already ran, GameInsightRecord[] persisted on disk
  -> Puzzles tab requests the due queue
  -> main process loads all GameInsightRecord (existing loadAllGameRecords()),
     flattens every record's mistakes[], joins each against srs-state.json
     (auto-creating a "new card" entry for any mistake never seen before)
  -> cards with dueDate <= now (plus all new cards) come back as the queue
  -> user attempts a move on the puzzle board (reusing Board.tsx + tryMove.ts)
  -> renderer runs two live evaluatePosition() calls (before/after the
     attempt) and computeMoveEvalDelta() - both already exist, built for
     variation exploration and full-game analysis respectively
  -> cp-loss maps to an SM-2 quality score -> pass/fail shown, correct
     move revealed
  -> submitPuzzleReview() persists the new SM-2 state, queue advances
```

No new main-process engine code and no new cp-loss formula: grading
reuses the exact `evaluatePosition` IPC channel `useVariationExplorer`
already calls, and the exact `computeMoveEvalDelta` function
(`src/shared/engineMath.ts:24-40`) that already computes every mistake's
original cp-loss during a scan. The only genuinely new logic is SM-2
scheduling itself and the queue-join.

### Main process — SRS store

New `src/main/srs/srsStore.ts`, following `insightsStore.ts`'s existing
pattern (JSON file(s) under `app.getPath('userData')`), but as a single
file rather than one-per-record — SRS state is small (a handful of
fields per card) and there's no per-card fetch pattern to optimize for,
unlike per-game insight records fetched incrementally during a scan:

```ts
export interface SrsCardState {
  cardId: string // `${gameUrl}#${ply}`
  easeFactor: number
  intervalDays: number
  repetitions: number
  dueDate: number // epoch ms
  lastReviewedAt: number | null
}

export function loadSrsState(): Record<string, SrsCardState>
export function saveSrsState(state: Record<string, SrsCardState>): void
```

New default for a card never reviewed: `{ easeFactor: 2.5, intervalDays: 0,
repetitions: 0, dueDate: <now>, lastReviewedAt: null }` — due immediately.

### Main process — SM-2 scheduler

New `src/main/srs/sm2.ts`, a pure function, no I/O:

```ts
export function nextCardState(
  current: SrsCardState,
  quality: 0 | 1 | 2 | 3 | 4 | 5,
  now: number
): SrsCardState
```

Standard SM-2: quality `>= 3` is a pass — `repetitions` increments,
`easeFactor` adjusts by `EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))`
(clamped to a 1.3 floor), and `intervalDays` becomes `1` (first
repetition), `6` (second), or `previousInterval * easeFactor` (third and
beyond) — the standard SM-2 interval-growth rule. Quality `< 3` is a
fail — `repetitions` resets to `0`, `intervalDays` resets to `1`,
`easeFactor` is left unchanged (SM-2's own rule: ease only ever moves on
a pass). `dueDate` is always `now + intervalDays * 86400000`.

### Main process — puzzle queue + grading IPC

New IPC channels (`src/shared/ipc.ts`):

```ts
getPuzzleQueue: 'puzzles:get-queue',
submitPuzzleReview: 'puzzles:submit-review'
```

`getPuzzleQueue` handler (`src/main/ipc/handlers.ts`): loads all game
records, flattens `mistakes[]` into `{ cardId, gameUrl, ply, ...mistake
fields, opponentUsername, endTime, userColor }` (denormalizing just
enough per-game context — opponent, date, which color the player had —
for display, without duplicating the whole `GameInsightRecord`), loads
SRS state, creates a default entry (above) for any `cardId` missing from
it. Returns `{ due: PuzzleCard[], nextDueAt: number | null }`: `due` is
every card with `dueDate <= Date.now()`, sorted oldest-due-first (new
cards, whose `dueDate` is "now" at creation time, naturally sort near the
front too) — no pagination, no cap, per the Non-goals above. `nextDueAt`
is the soonest `dueDate` across the *full* card set (including
not-yet-due cards), or `null` if there are no cards at all — this is
what powers the "you're all caught up, next review due `<date>`" empty
state without a second round-trip.

`submitPuzzleReview(cardId, quality)` handler: loads SRS state, looks up
(or defaults) the card, calls `nextCardState`, persists, returns the
updated `SrsCardState` (so the renderer can show "next review in N
days").

`src/preload/index.ts` and `ChessAPI` (`src/shared/types.ts`) get both
new methods, following the existing `T | { error: string }` convention
used elsewhere for IPC calls that can fail (e.g. reading a corrupted
store file).

### Renderer — grading

No new main-process engine logic is needed for grading itself; it
happens in the renderer, reusing existing plumbing end to end:

```ts
const evalBefore = await window.chessAPI.evaluatePosition(card.fenBefore, PUZZLE_DEPTH)
const fenAfterAttempt = tryMove(card.fenBefore, from, to) // existing lib/tryMove.ts, unchanged
const evalAfter = await window.chessAPI.evaluatePosition(fenAfterAttempt, PUZZLE_DEPTH)
const { cpLoss } = computeMoveEvalDelta(evalBefore, evalAfter, `${from}${to}`)
```

(`computeMoveEvalDelta`'s third argument is only used for its own
`isBestMove` string-equality shortcut, which — for an auto-queen
promotion — would need a `q` suffix to ever match; without it,
`isBestMove` simply comes back `false` and the function falls through to
computing `cpLoss` from the eval difference instead of short-circuiting
to `0`. For the actual best promotion move that eval difference is ~0
anyway, so this has no effect on the resulting quality score — not worth
threading promotion notation through `tryMove`'s return value just to
make this one internal flag technically accurate.)

(`PUZZLE_DEPTH = 12`, matching `useVariationExplorer`'s existing
exploration depth — live per-attempt feedback favors speed over the
scan's depth-14 precision, same tradeoff already made for exploration.)

cp-loss maps to SM-2 quality using `classification.ts`'s existing
cp-loss tier boundaries (`CP_LOSS_TIERS`, `src/main/analysis/
classification.ts:12-17`) as the source of truth, so puzzle grading and
game-review move classification share one yardstick rather than two:

| cp-loss | quality | outcome |
|---|---|---|
| ≤ 20 (excellent tier) | 5 | pass |
| ≤ 50 (good tier) | 4 | pass |
| ≤ 100 (inaccuracy tier) | 3 | pass (barely) |
| > 100 | 1 | fail |

This mapping is a small pure function, `cpLossToQuality(cpLoss): 0|1|3|4|5`,
in `src/renderer/src/lib/` alongside `tryMove.ts`.

Because grading compares evals rather than move-UCI strings, a
genuinely-equal alternative to the recorded `bestMoveUci` is accepted as
correct — the puzzle isn't "guess this exact string," it's "find a move
this good."

### Renderer — `usePuzzleSession` hook

New `src/renderer/src/hooks/usePuzzleSession.ts`:

```ts
export function usePuzzleSession(): {
  queue: PuzzleCard[]
  currentCard: PuzzleCard | null
  attempt: (from: string, to: string) => Promise<{ correct: boolean; cpLoss: number; bestMoveUci: string }>
  next: () => void
  isLoading: boolean
}
```

Fetches the queue on mount (and after each `submitPuzzleReview` call, so
a card that just passed with a long new interval drops out of the
visible due list immediately rather than waiting for a manual refresh).
`attempt()` runs the grading sequence above, calls
`submitPuzzleReview`, and returns the verdict for the UI to render;
it does not auto-advance — `next()` is a separate call so the UI can
hold the feedback state (revealed answer, pass/fail) on screen until the
user is ready to continue.

### Renderer — `PuzzlesTab.tsx`

New component, structurally parallel to the Analyze tab's board-column
layout. Reuses `Board.tsx` exactly as variation exploration left it —
`fen={currentCard.fenBefore}`, `onMove` wired to `usePuzzleSession`'s
`attempt`, `boardOrientation` derived from the card's `userColor`
(`'w' -> 'white'`, `'b' -> 'black'` — the board always faces the way the
player actually sat in the original game, not always white-at-bottom),
`bestMoveUci={null}` until an attempt has been graded (revealing the
answer before an attempt would defeat the puzzle), then the graded
`bestMoveUci` afterward so the existing arrow-rendering in `Board.tsx`
draws it with no new code there.

Status panel: "Card N of M due," the mistake's tactic tag(s)
(`missedTactics`/`punishedByTactics`, reusing the existing tactic-chip
styling from the Insights tab), how long ago the game was played, and
after an attempt: pass (green) / fail (red) plus a "Next" button.

Empty states:
- No scanned games at all (`getPuzzleQueue` returns `[]` and
  `loadScanMeta().lastScanTime === null`): "Run an Insights scan to build
  your practice queue," mirroring the Insights tab's own pre-scan empty
  state.
- Queue empty because everything's caught up: "You're all caught up —
  next review due `<date>`" (the earliest `dueDate` among all cards,
  even the not-yet-due ones, computed client-side from the full — not
  due-filtered — set, so this requires `getPuzzleQueue` to optionally
  return the single soonest-due timestamp alongside the empty due list
  rather than nothing at all).

### Nav

`AppTab` (`src/renderer/src/components/NavBar.tsx:5`) becomes `'analyze'
| 'insights' | 'puzzles'`; a third tab added to the nav bar after
Insights.

## Error handling

- `evaluatePosition` failing mid-grading (engine crashed, binary
  missing): `usePuzzleSession.attempt()` surfaces this as a visible
  inline error on the puzzle card ("Couldn't grade that attempt — try
  again") rather than silently swallowing it the way exploration does,
  since a puzzle attempt without a verdict is a dead end for the user
  (unlike exploration, where a stale-but-present eval is still useful) —
  this is a deliberate, narrow departure from the exploration feature's
  swallow-quietly precedent, justified by the different consequence of
  failure.
- `submitPuzzleReview` failing to persist: the grading verdict still
  displays (the user did get feedback), but the queue doesn't advance
  the card's schedule — logged, not surfaced, matching this app's
  existing precedent for storage-layer hiccups elsewhere.

## Testing

- `src/main/srs/sm2.test.ts` (new): pure function, no I/O — asserts the
  interval/ease progression against known SM-2 reference sequences for
  both an all-passes run and a fail-then-recover run, and that quality
  `< 3` always resets `repetitions`/`intervalDays` regardless of prior
  state.
- `src/main/srs/srsStore.test.ts` (new): following `insightsStore.test.ts`'s
  existing pattern — load/save round-trip, missing-file default,
  corrupted-file handling.
- Queue-join logic (new-card creation, due-filtering, sort order) gets a
  unit test with fixture `GameInsightRecord[]` + fixture SRS state —
  colocated with the handler or extracted to a small pure function if it
  grows past what's comfortable to test through the IPC handler
  directly.
- `cpLossToQuality` (new): pure function, exhaustive boundary-value
  tests (19/20/21, 49/50/51, 99/100/101).
- No new renderer-component-render tests, matching this codebase's
  established, deliberate no-jsdom policy. `PuzzlesTab`'s board
  interaction, grading round-trip, empty states, and nav tab all get
  verified via `run-desktop` against the real built app — same
  verification method used for `Board.tsx`'s drag/click input and the
  exploration banner.

## Future ideas (explicitly deferred)

- Filtering out "already-decided position" mistakes from the puzzle pool
  (requires storing the pre-mistake raw eval — a schema/rescan change).
- Daily new-card/review caps.
- Manual per-mistake curation ("add to queue" / "skip this one forever").
- Puzzle streaks, a completion calendar, or any other gamification layer
  on top of the raw SRS queue.
- Cross-device sync of SRS state.

## Minor findings parked at final whole-branch review (2026-07-25)

All Critical/Important findings from the final review were fixed (see
the plan's "Final review fixes" section and the commit it produced).
These nine Minor findings were deliberately left unfixed — non-blocking,
but worth revisiting if this area gets touched again:

- **Pre-scan vs. zero-mistakes empty state.** The empty state keys off
  `nextDueAt === null`, so a user who scanned but had zero mistakes sees
  "Run an Insights scan..." instead of a more accurate message. Would
  need `getPuzzleQueue` to also return scan metadata.
- **Unused payload fields.** `PuzzleCard.playedMoveUci`/`.classification`/
  `.phase`/`.gameUrl`/`.ply`, `PuzzleAttemptResult.cpLoss`, and
  `submitPuzzleReview`'s returned `SrsCardState` are all computed and
  shipped but never rendered. A "next review in N days" line on the
  feedback banner (from the returned `SrsCardState.dueDate`) would be
  cheap and would make the SRS layer legible to the user.
- **Unreachable error strings.** `usePuzzleSession.attempt()`'s
  `{error: 'No puzzle to attempt.'}`/`{error: 'Illegal move.'}` branches
  are dead code today — `PuzzlesTab`'s `handleMove` already pre-validates
  with the same `tryMove` call and only invokes `attempt` when a card
  exists. Harmless, kept for the hook's own self-contained safety.
- **Stale "N puzzles due" during feedback.** By design (`attempt()`
  doesn't refetch), the count still includes the just-answered card
  until "Next"/"Retry" is clicked. Cosmetic.
- **`srs-state.json` isn't cleared on a chess.com account switch.**
  `insightsStore.ensureUsernameScope` wipes the games cache but not the
  SRS store — the previous account's card entries (keyed by game URL)
  persist indefinitely. Harmless (the join drops unmatched entries) but
  unbounded growth plus residual URLs from another account.
- **A `submitPuzzleReview` failure silently repeats the same card
  forever.** If persistence fails, the card's due date never advances,
  so it resurfaces at the head of the queue on the next refetch with no
  indication to the user of why.
- **Auto-queen-only promotion.** `tryMove`'s hardcoded `promotion: 'q'`
  means a puzzle whose answer is an underpromotion can never be
  correctly answered. Inherited from the variation-exploration feature's
  own accepted limitation, not introduced here.
- **`Math.min(...cards.map(...))` spread.** Safe at today's real-world
  scale (~600 cards) but has no hard ceiling; a `reduce` would remove it
  for free if ever revisited.
- **No "Show answer" / "Skip" control for a puzzle the user genuinely
  can't solve.** Today the only way to see the solution is to play a
  move and fail — which pollutes that card's own SRS history with a
  miss the user didn't really attempt.

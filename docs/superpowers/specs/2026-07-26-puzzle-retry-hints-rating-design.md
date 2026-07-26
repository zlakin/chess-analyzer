# Puzzle retry, hints, and gamification — design

## Problem

The Puzzles tab (`src/renderer/src/components/PuzzlesTab.tsx`) has three gaps:

1. **No retry on a wrong answer.** `usePuzzleSession.attempt()` grades and submits an SM-2 review on *every* call, including retries — so simply adding a Retry button today would silently double/triple-submit SRS reviews for one card, corrupting its schedule. A wrong-but-legal move currently only offers **Next**, with no way to try again.
2. **No hints.** The board is fully blind — you either know the move or you don't.
3. **The tab feels bare.** Bare board, a queue count, and static metadata chips. No sense of progress, streak, or improvement over time.

## Scope

This spec covers the Puzzles tab only: the attempt/retry/hint/give-up flow, a new gamification stats layer, and the surrounding UI. It does not touch the Analyze tab or Insights tab (separate sub-projects).

## 1. Interaction state machine

Per card, starting from **unresolved**:

- Board is interactive. A **Hint** button is visible and enabled. No **Can't solve** button yet.
- **First attempt** (tracked via a `reviewSubmitted` flag scoped to the current `cardId`, reset whenever the card changes):
  - Graded via the existing `gradeAttempt()` path (exact-match-to-`bestMoveUci` shortcut, or live engine eval at `PUZZLE_DEPTH`).
  - If a hint was already used before this attempt, the quality passed to `submitPuzzleReview` is capped: `quality = Math.min(quality, 3)`. The `correct` boolean shown to the user is unaffected by the cap (still true if the literal best move was played).
  - `submitPuzzleReview(cardId, quality)` is called exactly once here. `reviewSubmitted` flips to true immediately, before any subsequent retry can reach this branch.
- **Wrong attempt, first or later**: show "Not quite — try again" plus a **Retry** button. Retry just clears the tagged attempt/result (mirrors the existing `handleRetry`); the board becomes interactive again. No SRS submission occurs (guarded by `reviewSubmitted`).
- **Hint** (single use per card): sets `hintUsed = true`. The board highlights the source square of `currentCard.bestMoveUci` (`bestMoveUci.slice(0, 2)`) via a new `hintSquare` prop on `Board`. The Hint button then disables; **Can't solve** enables.
- **Can't solve** (only enabled once `hintUsed`): reveals `bestMoveUci` as an arrow against `fenBefore` (existing reveal mechanism — unchanged), shows the answer, enables **Next**. Does not touch SRS. Records the card's outcome as `gaveUp` (see §2).
- **Correct** (first try or after any number of retries): "Correct!" + **Next**. Outcome recorded as `clean` (correct on the very first attempt, no hint), `retried` (correct after ≥1 wrong attempt, no hint), or `hinted` (correct, hint was used at any point before the correct attempt).
- **Illegal move**: unchanged from today — inline error + Retry/Next, no SRS submission, no outcome recorded (not a real attempt).

`hintUsed` and `reviewSubmitted` both reset when `next()` advances to a new card.

## 2. Gamification stats (new, decoupled from SRS)

SRS scheduling keeps its existing semantics exactly: the grade that determines the next due date is whatever happened on the *first* attempt, full stop — that's the correct spaced-repetition signal, and this spec only fixes the double-submission bug, not the underlying model.

The new **Puzzle Rating** system is a separate, purely motivational layer keyed off how the card was *finally* resolved — one of `'clean' | 'retried' | 'hinted' | 'gaveUp'` — not off the first-attempt SRS grade. This decoupling matters: a card can be SRS-graded as a fail on attempt 1 (quality < 3) and still resolve as `retried` once the user finds it a few tries later.

### Data shape (`src/shared/types.ts`)

```ts
export type PuzzleOutcome = 'clean' | 'retried' | 'hinted' | 'gaveUp'

export interface PuzzleStats {
  rating: number
  currentStreak: number
  longestStreak: number
  totalResolved: number
  totalCleanSolves: number
  solvedToday: number
  lastSolvedDate: string // 'YYYY-MM-DD', local time
}
```

### Rating delta

Not a calibrated Elo/Glicko — there's no shared pool of solvers to calibrate puzzle difficulty against (every puzzle is this one user's own mistake, seen once). It's presented as "Puzzle Rating" but is a fixed-delta motivational score, lightly weighted by `classification` (`blunder` vs `mistake`, already on `PuzzleCard`):

| Outcome | blunder | mistake |
|---|---|---|
| clean | +15 | +10 |
| retried | +8 | +6 |
| hinted | +3 | +3 |
| gaveUp | -10 | -8 |

Rating floors at 400. Lives in a new pure function `nextRating(current: number, outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): number` in `src/main/srs/puzzleRating.ts`.

### Streak / accuracy

- `currentStreak` increments on `clean`/`retried`/`hinted` (any non-give-up resolution), resets to 0 on `gaveUp`. `longestStreak` tracks the max.
- `totalResolved` increments on every one of the 4 outcomes; `totalCleanSolves` only on `clean`. Accuracy displayed as `totalCleanSolves / totalResolved`.
- `solvedToday`: if today's local date (`YYYY-MM-DD`) differs from `lastSolvedDate`, reset `solvedToday` to 0 and set `lastSolvedDate` to today, then increment `solvedToday` on any non-`gaveUp` resolution.

All of this lives in `nextPuzzleStats(current: PuzzleStats, outcome: PuzzleOutcome, classification, now: number): PuzzleStats` (same file), unit-tested directly like `sm2.ts`/`sm2.test.ts`.

### Persistence

`src/main/srs/puzzleStatsStore.ts` — `loadPuzzleStats()` / `savePuzzleStats()`, mirroring `srsStore.ts` exactly (same atomic tmp-file-then-rename write pattern), reading/writing `puzzle-stats.json` in `app.getPath('userData')`. Missing file → default stats (`rating: 1200`, everything else 0, `lastSolvedDate: ''`).

### IPC

- `getPuzzleStats(): Promise<PuzzleStats>` — new channel, called once on `usePuzzleSession` mount.
- `submitPuzzleOutcome(cardId: string, outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): Promise<PuzzleStats>` — new channel, called once per card at final resolution (correct or gave-up). Loads stats, applies `nextPuzzleStats`, saves, returns the updated stats.

Both added to `IPC_CHANNELS`, `handlers.ts`, and `preload/index.ts` alongside the existing `getPuzzleQueue`/`submitPuzzleReview`.

## 3. UI layout (`PuzzlesTab.tsx`)

- **Stats bar** above the board/side-panel grid: four small tiles — Rating, Streak, Solved today, Accuracy — plus session progress ("Puzzle 3 of 12 due", derived from `queue.length` same as today, just surfaced more prominently).
- **Board** (`Board.tsx`): new optional prop `hintSquare?: string | null`. Merged into the existing `squareStyles` memo alongside `selectedSquare`, with its own visual treatment (distinct from the click-to-move selection highlight) so a hint and an in-progress click-selection never look identical.
- **Feedback panel**: buttons swap per the state machine in §1 — `[Hint]` while unresolved and unused, `[Retry]` after a wrong attempt, `[Can't solve]` enabled once `hintUsed`, `[Next]` once resolved. Tactic chips (fork/pin/etc.) are unchanged — they're descriptive metadata shown before any attempt today, not a spoiler, since the hint mechanism is a square highlight, not a tactic name.

## 4. Testing

- `src/main/srs/puzzleRating.test.ts` — `nextRating` and `nextPuzzleStats`, covering all 4 outcomes × both classifications, the day-rollover reset, streak reset on `gaveUp`, and the rating floor.
- `src/main/srs/puzzleStatsStore.test.ts` — mirrors `srsStore.test.ts` (load-missing-file default, save-then-load roundtrip).
- `src/renderer/src/hooks/usePuzzleSession.test.ts` (new — the hook currently has no tests at all): the double-submission guard (retry never re-calls `submitPuzzleReview`), the hint-cap-to-3 behavior, `hintUsed`/`reviewSubmitted` resetting on `next()`, and outcome classification (`clean`/`retried`/`hinted`/`gaveUp`) being reported correctly to `submitPuzzleOutcome`.

## Out of scope

- Analyze tab performance, Insights tab layout — separate specs.
- Any true Elo/Glicko calibration, puzzle difficulty tiers, or leaderboards.
- Multiple hint tiers (only one hint exists, per the approved design).

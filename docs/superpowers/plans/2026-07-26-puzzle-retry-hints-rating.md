# Puzzle Retry, Hints, and Gamification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Puzzles tab so a wrong answer can be retried until solved, add a single-hint-then-give-up path, and add a decoupled "Puzzle Rating" gamification layer (rating/streak/solved-today/accuracy) so the tab stops feeling like a bare board.

**Architecture:** The existing SM-2 spaced-repetition grading (`usePuzzleSession.attempt()` → `submitPuzzleReview`) keeps its exact current semantics — it grades the *first* attempt only — but gets a real per-card guard so a new retry flow can't double-submit it (today it would, since `attempt()` submits on every call). A brand-new, fully separate `src/main/srs/puzzleRating.ts` + `puzzleStatsStore.ts` pair tracks a motivational "Puzzle Rating" keyed off how each card is *finally* resolved (`clean` / `retried` / `hinted` / `gaveUp`), persisted the same way `srsStore.ts` persists SM-2 state. `Board.tsx` gains one optional prop for the hint highlight; `PuzzlesTab.tsx` gains a stats bar and a retry/hint/give-up button flow.

**Tech Stack:** Existing stack only — no new dependencies. This codebase has a deliberate no-jsdom policy: hooks and components are verified via the `run-desktop` skill against the real built app, not mocked DOM tests. New *pure logic* (rating math, outcome classification) gets real unit tests, matching how `cpLossToQuality.ts`/`gradeAttempt.ts` were split out for the same reason.

## Global Constraints

- SRS scheduling (`submitPuzzleReview`) is graded from the *first* attempt only, exactly as today — retries never change what was already submitted for a card. Only the double-submission bug is fixed; the underlying model is untouched.
- Puzzle Rating is a fixed-delta motivational score, not a calibrated Elo/Glicko — there is no shared pool of solvers to calibrate puzzle difficulty against (every puzzle is this one user's own mistake, seen once).
- Exactly one hint per card. "Can't solve" is only enabled after that hint has been used.
- No new dependencies, no jsdom/testing-library — follow this repo's existing no-jsdom policy.
- This repo's git workflow: commit straight to `main`, no branches/worktrees/PRs.

---

### Task 1: Main process — puzzle rating logic

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/srs/puzzleRating.ts`
- Create: `src/main/srs/puzzleRating.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PuzzleOutcome`, `PuzzleStats` (both in `src/shared/types.ts` from this task on). `defaultPuzzleStats(): PuzzleStats`, `nextRating(current: number, outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): number`, `nextPuzzleStats(current: PuzzleStats, outcome: PuzzleOutcome, classification: 'mistake' | 'blunder', now: number): PuzzleStats` (all in `src/main/srs/puzzleRating.ts`) — Task 2's store and Task 3's IPC handler call these.

- [ ] **Step 1: Add `PuzzleOutcome`/`PuzzleStats` to `src/shared/types.ts`**

Add after the `PuzzleQueue` interface at the end of the file:

```ts
export type PuzzleOutcome = 'clean' | 'retried' | 'hinted' | 'gaveUp'

export interface PuzzleStats {
  rating: number
  currentStreak: number
  longestStreak: number
  totalResolved: number
  totalCleanSolves: number
  solvedToday: number
  lastSolvedDate: string
}
```

- [ ] **Step 2: Write `src/main/srs/puzzleRating.ts`**

```ts
import type { PuzzleOutcome, PuzzleStats } from '../../shared/types'

const RATING_FLOOR = 400
const STARTING_RATING = 1200

const RATING_DELTA: Record<PuzzleOutcome, { blunder: number; mistake: number }> = {
  clean: { blunder: 15, mistake: 10 },
  retried: { blunder: 8, mistake: 6 },
  hinted: { blunder: 3, mistake: 3 },
  gaveUp: { blunder: -10, mistake: -8 }
}

export function defaultPuzzleStats(): PuzzleStats {
  return {
    rating: STARTING_RATING,
    currentStreak: 0,
    longestStreak: 0,
    totalResolved: 0,
    totalCleanSolves: 0,
    solvedToday: 0,
    lastSolvedDate: ''
  }
}

export function nextRating(
  current: number,
  outcome: PuzzleOutcome,
  classification: 'mistake' | 'blunder'
): number {
  const delta = RATING_DELTA[outcome][classification]
  return Math.max(RATING_FLOOR, current + delta)
}

function localDateString(now: number): string {
  const d = new Date(now)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function nextPuzzleStats(
  current: PuzzleStats,
  outcome: PuzzleOutcome,
  classification: 'mistake' | 'blunder',
  now: number
): PuzzleStats {
  const rating = nextRating(current.rating, outcome, classification)
  const totalResolved = current.totalResolved + 1
  const totalCleanSolves = current.totalCleanSolves + (outcome === 'clean' ? 1 : 0)

  if (outcome === 'gaveUp') {
    // A give-up isn't a "solve" - it breaks the streak and moves the
    // rating/totals, but deliberately leaves solvedToday/lastSolvedDate
    // untouched, since those only ever count actual solves.
    return { ...current, rating, totalResolved, totalCleanSolves, currentStreak: 0 }
  }

  const today = localDateString(now)
  const solvedToday = (current.lastSolvedDate === today ? current.solvedToday : 0) + 1
  const currentStreak = current.currentStreak + 1

  return {
    rating,
    totalResolved,
    totalCleanSolves,
    currentStreak,
    longestStreak: Math.max(current.longestStreak, currentStreak),
    solvedToday,
    lastSolvedDate: today
  }
}
```

- [ ] **Step 3: Write `src/main/srs/puzzleRating.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { defaultPuzzleStats, nextRating, nextPuzzleStats } from './puzzleRating'
import type { PuzzleStats } from '../../shared/types'

const DAY_1 = new Date(2026, 0, 1, 10, 0).getTime()
const DAY_1_LATER = new Date(2026, 0, 1, 20, 0).getTime()
const DAY_2 = new Date(2026, 0, 2, 9, 0).getTime()

describe('defaultPuzzleStats', () => {
  it('starts at rating 1200 with everything else zeroed', () => {
    expect(defaultPuzzleStats()).toEqual({
      rating: 1200,
      currentStreak: 0,
      longestStreak: 0,
      totalResolved: 0,
      totalCleanSolves: 0,
      solvedToday: 0,
      lastSolvedDate: ''
    })
  })
})

describe('nextRating', () => {
  it('awards the largest gain for a clean blunder solve', () => {
    expect(nextRating(1200, 'clean', 'blunder')).toBe(1215)
  })

  it('awards a smaller gain for a clean mistake solve', () => {
    expect(nextRating(1200, 'clean', 'mistake')).toBe(1210)
  })

  it('awards a moderate gain for a retried solve', () => {
    expect(nextRating(1200, 'retried', 'blunder')).toBe(1208)
    expect(nextRating(1200, 'retried', 'mistake')).toBe(1206)
  })

  it('awards the same small gain for a hinted solve regardless of classification', () => {
    expect(nextRating(1200, 'hinted', 'blunder')).toBe(1203)
    expect(nextRating(1200, 'hinted', 'mistake')).toBe(1203)
  })

  it('penalizes giving up, more for a blunder than a mistake', () => {
    expect(nextRating(1200, 'gaveUp', 'blunder')).toBe(1190)
    expect(nextRating(1200, 'gaveUp', 'mistake')).toBe(1192)
  })

  it('floors at 400', () => {
    expect(nextRating(405, 'gaveUp', 'blunder')).toBe(400)
    expect(nextRating(400, 'gaveUp', 'blunder')).toBe(400)
  })
})

describe('nextPuzzleStats', () => {
  const fresh = defaultPuzzleStats()

  it('records a clean solve: rating, streak, today count, and clean-solve count all move', () => {
    const result = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    expect(result).toEqual({
      rating: 1210,
      currentStreak: 1,
      longestStreak: 1,
      totalResolved: 1,
      totalCleanSolves: 1,
      solvedToday: 1,
      lastSolvedDate: '2026-01-01'
    })
  })

  it('accumulates solvedToday across same-day solves, resets on a new day', () => {
    let state = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'retried', 'mistake', DAY_1_LATER)
    expect(state.solvedToday).toBe(2)
    expect(state.lastSolvedDate).toBe('2026-01-01')

    state = nextPuzzleStats(state, 'hinted', 'mistake', DAY_2)
    expect(state.solvedToday).toBe(1)
    expect(state.lastSolvedDate).toBe('2026-01-02')
  })

  it('resets currentStreak to 0 on gaveUp without touching solvedToday or lastSolvedDate', () => {
    let state = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'gaveUp', 'blunder', DAY_1_LATER)
    expect(state.currentStreak).toBe(0)
    expect(state.solvedToday).toBe(1)
    expect(state.lastSolvedDate).toBe('2026-01-01')
    expect(state.totalResolved).toBe(2)
    expect(state.totalCleanSolves).toBe(1)
  })

  it('tracks longestStreak across a streak that later breaks', () => {
    let state: PuzzleStats = fresh
    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    expect(state.longestStreak).toBe(2)

    state = nextPuzzleStats(state, 'gaveUp', 'mistake', DAY_1)
    expect(state.currentStreak).toBe(0)
    expect(state.longestStreak).toBe(2)

    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(2)
  })
})
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/main/srs/puzzleRating.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/srs/puzzleRating.ts src/main/srs/puzzleRating.test.ts
git commit -m "Add puzzle rating logic (rating, streak, accuracy)"
```

---

### Task 2: Main process — puzzle stats persistence

**Files:**
- Create: `src/main/srs/puzzleStatsStore.ts`
- Create: `src/main/srs/puzzleStatsStore.test.ts`

**Interfaces:**
- Consumes: `defaultPuzzleStats` (Task 1), `PuzzleStats` (Task 1, `src/shared/types.ts`).
- Produces: `loadPuzzleStats(): PuzzleStats`, `savePuzzleStats(stats: PuzzleStats): void` — Task 3's IPC handlers call both.

- [ ] **Step 1: Write `src/main/srs/puzzleStatsStore.ts`**

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { PuzzleStats } from '../../shared/types'
import { defaultPuzzleStats } from './puzzleRating'

function puzzleStatsPath(): string {
  return join(app.getPath('userData'), 'puzzle-stats.json')
}

export function loadPuzzleStats(): PuzzleStats {
  const path = puzzleStatsPath()
  if (!existsSync(path)) return defaultPuzzleStats()

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PuzzleStats
  } catch {
    return defaultPuzzleStats()
  }
}

export function savePuzzleStats(stats: PuzzleStats): void {
  const path = puzzleStatsPath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(stats, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}
```

- [ ] **Step 2: Write `src/main/srs/puzzleStatsStore.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`)
      return userDataDir
    }
  }
}))

import { loadPuzzleStats, savePuzzleStats } from './puzzleStatsStore'
import { defaultPuzzleStats } from './puzzleRating'
import type { PuzzleStats } from '../../shared/types'

function stats(overrides: Partial<PuzzleStats> = {}): PuzzleStats {
  return { ...defaultPuzzleStats(), rating: 1250, currentStreak: 3, ...overrides }
}

describe('puzzleStatsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-puzzle-stats-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default stats when nothing has been saved yet', () => {
    expect(loadPuzzleStats()).toEqual(defaultPuzzleStats())
  })

  it('round-trips saved stats', () => {
    savePuzzleStats(stats())
    expect(loadPuzzleStats()).toEqual(stats())
  })

  it('treats a corrupted store file as defaults rather than throwing', () => {
    savePuzzleStats(stats())
    writeFileSync(join(userDataDir, 'puzzle-stats.json'), '{not valid json', 'utf-8')

    expect(loadPuzzleStats()).toEqual(defaultPuzzleStats())
  })

  it('overwrites the whole file on save (not a merge)', () => {
    savePuzzleStats(stats({ rating: 1250 }))
    savePuzzleStats(stats({ rating: 1300 }))

    expect(loadPuzzleStats()).toEqual(stats({ rating: 1300 }))
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/main/srs/puzzleStatsStore.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/srs/puzzleStatsStore.ts src/main/srs/puzzleStatsStore.test.ts
git commit -m "Add puzzle stats persistence (puzzle-stats.json)"
```

---

### Task 3: Main process — IPC wiring

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `loadPuzzleStats`/`savePuzzleStats` (Task 2), `nextPuzzleStats` (Task 1), `PuzzleOutcome`/`PuzzleStats` (Task 1).
- Produces: `window.chessAPI.getPuzzleStats(): Promise<PuzzleStats>`, `window.chessAPI.submitPuzzleOutcome(outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): Promise<PuzzleStats>` — Task 5's hook calls both.

- [ ] **Step 1: Extend `ChessAPI` in `src/shared/types.ts`**

Add directly after the existing `submitPuzzleReview` line in the `ChessAPI` interface:

```ts
  getPuzzleStats(): Promise<PuzzleStats>
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder'
  ): Promise<PuzzleStats>
```

- [ ] **Step 2: Add two channels to `src/shared/ipc.ts`**

Add directly after the existing `submitPuzzleReview` entry:

```ts
  getPuzzleStats: 'puzzles:get-stats',
  submitPuzzleOutcome: 'puzzles:submit-outcome'
```

- [ ] **Step 3: Add two handlers to `src/main/ipc/handlers.ts`**

Add this import alongside the existing `srs` imports near the top of the file:

```ts
import { loadPuzzleStats, savePuzzleStats } from '../srs/puzzleStatsStore'
import { nextPuzzleStats } from '../srs/puzzleRating'
```

Add `PuzzleOutcome` to the existing `import type { SrsQuality } from '../../shared/types'` line, making it:

```ts
import type { PuzzleOutcome, SrsQuality } from '../../shared/types'
```

Add these two handlers directly after the existing `submitPuzzleReview` handler, before the function's closing brace:

```ts
  ipcMain.handle(IPC_CHANNELS.getPuzzleStats, async () => {
    return loadPuzzleStats()
  })

  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleOutcome,
    async (_event, outcome: PuzzleOutcome, classification: 'mistake' | 'blunder') => {
      const stats = loadPuzzleStats()
      const updated = nextPuzzleStats(stats, outcome, classification, Date.now())
      savePuzzleStats(updated)
      return updated
    }
  )
```

- [ ] **Step 4: Add two methods to `src/preload/index.ts`**

Add `PuzzleOutcome` and `PuzzleStats` to the existing type-only import block:

```ts
import type {
  AnalyzedPosition,
  AnalyzedMove,
  ChessAPI,
  ScanProgress,
  Theme,
  SrsQuality,
  PuzzleOutcome,
  PuzzleStats
} from '../shared/types'
```

Add these two methods to the `chessAPI` object, directly after the existing `submitPuzzleReview` entry:

```ts
  getPuzzleStats: () => ipcRenderer.invoke(IPC_CHANNELS.getPuzzleStats),
  submitPuzzleOutcome: (outcome: PuzzleOutcome, classification: 'mistake' | 'blunder') =>
    ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleOutcome, outcome, classification)
```

`PuzzleStats` is used only in the `ChessAPI` return type this file imports, not as a runtime value here — that's expected for a type-only import.

- [ ] **Step 5: Typecheck and run the full suite**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (this task adds no new test files — same total as Task 2 left it).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Wire puzzle-stats IPC channels end to end"
```

---

### Task 4: Renderer — puzzle outcome + quality-cap helpers

**Files:**
- Create: `src/renderer/src/lib/puzzleOutcome.ts`
- Create: `src/renderer/src/lib/puzzleOutcome.test.ts`

**Interfaces:**
- Consumes: `PuzzleOutcome`, `SrsQuality` (`src/shared/types.ts`).
- Produces: `resolveSolvedOutcome(hadWrongAttempt: boolean, hintUsed: boolean): PuzzleOutcome`, `cappedQuality(quality: SrsQuality, hintUsed: boolean): SrsQuality` — Task 5's hook calls both.

- [ ] **Step 1: Write `src/renderer/src/lib/puzzleOutcome.ts`**

```ts
import type { PuzzleOutcome, SrsQuality } from '../../../shared/types'

export function resolveSolvedOutcome(hadWrongAttempt: boolean, hintUsed: boolean): PuzzleOutcome {
  if (hintUsed) return 'hinted'
  if (hadWrongAttempt) return 'retried'
  return 'clean'
}

export function cappedQuality(quality: SrsQuality, hintUsed: boolean): SrsQuality {
  return hintUsed ? (Math.min(quality, 3) as SrsQuality) : quality
}
```

- [ ] **Step 2: Write `src/renderer/src/lib/puzzleOutcome.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { resolveSolvedOutcome, cappedQuality } from './puzzleOutcome'

describe('resolveSolvedOutcome', () => {
  it('is clean when solved on the first attempt with no hint', () => {
    expect(resolveSolvedOutcome(false, false)).toBe('clean')
  })

  it('is retried when solved after a wrong attempt, with no hint', () => {
    expect(resolveSolvedOutcome(true, false)).toBe('retried')
  })

  it('is hinted whenever a hint was used, regardless of prior wrong attempts', () => {
    expect(resolveSolvedOutcome(false, true)).toBe('hinted')
    expect(resolveSolvedOutcome(true, true)).toBe('hinted')
  })
})

describe('cappedQuality', () => {
  it('passes quality through unchanged when no hint was used', () => {
    expect(cappedQuality(5, false)).toBe(5)
    expect(cappedQuality(0, false)).toBe(0)
  })

  it('caps quality at 3 when a hint was used', () => {
    expect(cappedQuality(5, true)).toBe(3)
    expect(cappedQuality(4, true)).toBe(3)
    expect(cappedQuality(3, true)).toBe(3)
  })

  it('leaves an already-low quality untouched when a hint was used', () => {
    expect(cappedQuality(2, true)).toBe(2)
    expect(cappedQuality(0, true)).toBe(0)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/renderer/src/lib/puzzleOutcome.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/puzzleOutcome.ts src/renderer/src/lib/puzzleOutcome.test.ts
git commit -m "Add puzzle outcome classification and hint quality-cap helpers"
```

---

### Task 5: Renderer — `usePuzzleSession` hook rewrite

**Files:**
- Modify: `src/renderer/src/hooks/usePuzzleSession.ts`

**Interfaces:**
- Consumes: `resolveSolvedOutcome`/`cappedQuality` (Task 4), `window.chessAPI.getPuzzleStats`/`submitPuzzleOutcome` (Task 3), existing `gradeAttempt`/`tryMove`/`submitPuzzleReview`.
- Produces: the hook now returns `{ queue, nextDueAt, currentCard, sessionTotal, stats, hintUsed, attempt, requestHint, giveUp, next, isLoading }` — Task 6's `PuzzlesTab` consumes all of these. `PuzzleAttemptResult` is unchanged (`{ correct: boolean; cpLoss: number; bestMoveUci: string }`).

- [ ] **Step 1: Replace `src/renderer/src/hooks/usePuzzleSession.ts` in full**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PuzzleCard, PuzzleOutcome, PuzzleStats } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'
import { gradeAttempt } from '../lib/gradeAttempt'
import { resolveSolvedOutcome, cappedQuality } from '../lib/puzzleOutcome'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

interface CardProgress {
  cardId: string
  reviewSubmitted: boolean
  hadWrongAttempt: boolean
}

export function usePuzzleSession(): {
  queue: PuzzleCard[]
  nextDueAt: number | null
  currentCard: PuzzleCard | null
  sessionTotal: number
  stats: PuzzleStats | null
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<PuzzleCard[]>([])
  const [nextDueAt, setNextDueAt] = useState<number | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<PuzzleStats | null>(null)
  const [hintUsed, setHintUsed] = useState(false)
  const cardProgressRef = useRef<CardProgress | null>(null)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const result = await window.chessAPI.getPuzzleQueue()
    setQueue(result.due)
    setNextDueAt(result.nextDueAt)
    setSessionTotal(result.due.length)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    window.chessAPI.getPuzzleStats().then(setStats)
  }, [])

  const currentCard = queue[0] ?? null

  // A card's hint state and first-attempt/SRS-submission bookkeeping are
  // scoped to that one card - reset whenever the current card changes so
  // neither leaks into the next puzzle.
  useEffect(() => {
    cardProgressRef.current = null
    setHintUsed(false)
  }, [currentCard?.cardId])

  const submitOutcome = useCallback(
    async (outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): Promise<void> => {
      try {
        const updated = await window.chessAPI.submitPuzzleOutcome(outcome, classification)
        setStats(updated)
      } catch (err) {
        // Mirrors this hook's existing precedent for submitPuzzleReview below:
        // the puzzle-rating stats are a motivational extra, not load-bearing -
        // a failed write there shouldn't block showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    []
  )

  const attempt = useCallback(
    async (from: string, to: string): Promise<PuzzleAttemptResult | { error: string }> => {
      if (!currentCard) return { error: 'No puzzle to attempt.' }

      const uci = `${from}${to}`
      const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      let graded: ReturnType<typeof gradeAttempt>
      if (uci === currentCard.bestMoveUci || `${uci}q` === currentCard.bestMoveUci) {
        // Matches the recorded best move exactly - grade it a pass without
        // running a live eval at all. This also sidesteps a real problem:
        // bestMoveUci was found at the scan's depth (14), but grading runs
        // shallower (12) for speed - in a sharp, tactically-loaded position
        // (every puzzle is one, by definition), that depth gap could
        // otherwise make playing the *exact recorded answer* grade as a fail.
        graded = { correct: true, cpLoss: 0, quality: 5 }
      } else {
        const [evalBefore, evalAfter] = await Promise.all([
          window.chessAPI.evaluatePosition(currentCard.fenBefore, PUZZLE_DEPTH),
          window.chessAPI.evaluatePosition(fenAfterAttempt, PUZZLE_DEPTH)
        ])
        if ('error' in evalBefore) return { error: evalBefore.error }
        if ('error' in evalAfter) return { error: evalAfter.error }
        graded = gradeAttempt(evalBefore, evalAfter, uci, currentCard.bestMoveUci)
      }

      // Scoped to this card and mutated in place across retries (a ref, not
      // state) so that submitting the SRS review exactly once - and knowing
      // whether an earlier attempt on this same card was wrong - survives
      // across multiple attempt() calls without forcing a re-render for
      // bookkeeping nobody renders directly.
      const progress =
        cardProgressRef.current ?? { cardId: currentCard.cardId, reviewSubmitted: false, hadWrongAttempt: false }
      cardProgressRef.current = progress

      if (!progress.reviewSubmitted) {
        progress.reviewSubmitted = true
        const quality = cappedQuality(graded.quality, hintUsed)
        try {
          await window.chessAPI.submitPuzzleReview(currentCard.cardId, quality)
        } catch (err) {
          // The grading verdict itself is still valid and worth showing even
          // if persisting the new SRS schedule failed - logged, not surfaced,
          // matching this app's existing precedent for storage-layer hiccups
          // elsewhere.
          console.error('Failed to persist puzzle review', err)
        }
      }

      if (graded.correct) {
        void submitOutcome(resolveSolvedOutcome(progress.hadWrongAttempt, hintUsed), currentCard.classification)
      } else {
        progress.hadWrongAttempt = true
      }

      return { correct: graded.correct, cpLoss: graded.cpLoss, bestMoveUci: currentCard.bestMoveUci }
    },
    [currentCard, hintUsed, submitOutcome]
  )

  const requestHint = useCallback((): void => {
    if (!currentCard) return
    setHintUsed(true)
  }, [currentCard])

  const giveUp = useCallback((): void => {
    if (!currentCard || !hintUsed) return
    void submitOutcome('gaveUp', currentCard.classification)
  }, [currentCard, hintUsed, submitOutcome])

  const next = useCallback(() => {
    setQueue((q) => {
      const rest = q.slice(1)
      // Only go back to the server once the local queue is actually
      // drained - a just-reviewed card's new dueDate is always at least
      // 1 day out (SM-2's minimum interval), so it can never legitimately
      // reappear as due within this same session. Refetching on every
      // card instead would mean re-reading and re-parsing every cached
      // game record on disk (up to ~100 files) for every single puzzle.
      if (rest.length === 0) void loadQueue()
      return rest
    })
  }, [loadQueue])

  return {
    queue,
    nextDueAt,
    currentCard,
    sessionTotal,
    stats,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. (`PuzzlesTab.tsx` still compiles against the old hook shape at this point — every field it already used, `queue`/`nextDueAt`/`currentCard`/`attempt`/`next`/`isLoading`, kept the same name and type; the new fields are additive.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass (this task adds no new test files — `usePuzzleSession` has no direct tests per this repo's no-jsdom policy; its behavior is verified via `run-desktop` once Task 6 wires it into the UI).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/hooks/usePuzzleSession.ts
git commit -m "Add retry-safe SRS submission, hints, and give-up to usePuzzleSession"
```

---

### Task 6: Renderer — Board hint highlight + PuzzlesTab UI overhaul

**Files:**
- Modify: `src/renderer/src/components/Board.tsx`
- Modify: `src/renderer/src/components/PuzzlesTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `usePuzzleSession()`'s full new return shape (Task 5), `Board`'s new `hintSquare` prop (this task).
- Produces: nothing further consumes this — it's the top of the stack for this sub-project.

- [ ] **Step 1: Add a `hintSquare` prop to `src/renderer/src/components/Board.tsx`**

Replace the `BoardProps` interface and the `squareStyles` memo. The full file, with the two changed spots marked:

```tsx
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import type {
  Arrow,
  SquareRenderer,
  PieceDropHandlerArgs,
  SquareHandlerArgs,
  PieceHandlerArgs
} from 'react-chessboard'
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
  currentMove: AnalyzedMove | null
  boardOrientation: 'white' | 'black'
  onMove: (from: string, to: string) => boolean
  onHeightChange?: (height: number) => void
  hintSquare?: string | null
}

export const Board = memo(function Board({
  fen,
  bestMoveUci,
  currentMove,
  boardOrientation,
  onMove,
  onHeightChange,
  hintSquare = null
}: BoardProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !onHeightChange) return
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (height) onHeightChange(height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeightChange])

  // The board's own FEN changing (a real navigation, or a successful
  // exploration move) means any in-progress click-to-move selection is
  // stale - clear it rather than let a leftover selection apply against
  // a position it was never validated for.
  useEffect(() => {
    setSelectedSquare(null)
  }, [fen])

  const arrows: Arrow[] = useMemo(
    () =>
      bestMoveUci
        ? [
            {
              startSquare: bestMoveUci.slice(0, 2),
              endSquare: bestMoveUci.slice(2, 4),
              color: 'var(--accent)'
            }
          ]
        : [],
    [bestMoveUci]
  )

  const badgeSquare = currentMove ? currentMove.moveUci.slice(2, 4) : null
  const badgeStyle = currentMove ? MOVE_CLASSIFICATION_STYLE[currentMove.classification] : null

  const squareRenderer: SquareRenderer = useMemo(() => {
    return ({ square, children }) => {
      const showBadge = badgeSquare !== null && badgeStyle !== null && square === badgeSquare
      const BadgeIcon = badgeStyle?.icon
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {children}
          {showBadge && badgeStyle && BadgeIcon && (
            <span
              className="board-move-badge"
              style={{ backgroundColor: badgeStyle.color }}
              title={badgeStyle.label}
            >
              <BadgeIcon size={12} strokeWidth={2.5} color="var(--accent-contrast)" />
            </span>
          )}
        </div>
      )
    }
  }, [badgeSquare, badgeStyle])

  const squareStyles = useMemo(() => {
    const styles: Record<string, { boxShadow: string }> = {}
    if (hintSquare) styles[hintSquare] = { boxShadow: 'inset 0 0 0 3px var(--mq-inaccuracy)' }
    if (selectedSquare) styles[selectedSquare] = { boxShadow: 'inset 0 0 0 3px var(--accent)' }
    return styles
  }, [hintSquare, selectedSquare])

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    return onMove(sourceSquare, targetSquare)
  }

  function handleSquareClick({ piece, square }: SquareHandlerArgs): void {
    if (selectedSquare) {
      const moved = onMove(selectedSquare, square)
      setSelectedSquare(moved ? null : piece ? square : null)
      return
    }
    if (piece) setSelectedSquare(square)
  }

  function canDragPiece({ piece }: PieceHandlerArgs): boolean {
    // pieceType is 'w'+LETTER / 'b'+LETTER (e.g. 'wP', 'bQ') - confirmed
    // against react-chessboard's actual fenToPieceCode source, not assumed.
    const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    return piece.pieceType.startsWith(sideToMove)
  }

  return (
    <div className="board-container" ref={containerRef}>
      <Chessboard
        options={{
          position: fen,
          allowDragging: true,
          canDragPiece,
          onPieceDrop: handlePieceDrop,
          onSquareClick: handleSquareClick,
          arrows,
          boardOrientation,
          squareRenderer,
          squareStyles
        }}
      />
    </div>
  )
})
```

- [ ] **Step 2: Replace `src/renderer/src/components/PuzzlesTab.tsx` in full**

```tsx
import { useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { TACTIC_LABELS } from '../lib/tacticLabels'
import { Board } from './Board'
import type { TacticType } from '../../../shared/types'

function tacticTags(missed: TacticType[], punished: TacticType[]): TacticType[] {
  return Array.from(new Set([...missed, ...punished]))
}

interface TaggedAttempt {
  cardId: string
  fen: string
}

interface TaggedResult {
  cardId: string
  result: PuzzleAttemptResult | { error: string }
}

export function PuzzlesTab(): JSX.Element {
  const {
    queue,
    nextDueAt,
    currentCard,
    sessionTotal,
    stats,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  } = usePuzzleSession()
  const [taggedAttempt, setTaggedAttempt] = useState<TaggedAttempt | null>(null)
  const [taggedResult, setTaggedResult] = useState<TaggedResult | null>(null)
  const [taggedGaveUp, setTaggedGaveUp] = useState<string | null>(null)
  const [isGrading, setIsGrading] = useState(false)

  // Tagging each value with the cardId it belongs to, and only ever
  // reading it back when that tag matches the *current* card, means a
  // stale attempt/result from a just-abandoned card can never render -
  // structurally, not just via a same-tick effect racing the paint.
  const attemptFen =
    taggedAttempt && taggedAttempt.cardId === currentCard?.cardId ? taggedAttempt.fen : null
  const result =
    taggedResult && taggedResult.cardId === currentCard?.cardId ? taggedResult.result : null
  const gaveUp = taggedGaveUp === currentCard?.cardId

  if (isLoading) return <div className="puzzles-tab" />

  if (!currentCard) {
    return (
      <div className="puzzles-tab">
        <p className="puzzle-empty-message">
          {nextDueAt === null
            ? 'Run an Insights scan to build your practice queue.'
            : `You're all caught up — next review due ${new Date(nextDueAt).toLocaleDateString()}.`}
        </p>
      </div>
    )
  }

  const isCorrect = result !== null && 'correct' in result && result.correct
  const resolved = isCorrect || gaveUp
  const hintSquare = hintUsed && !resolved ? currentCard.bestMoveUci.slice(0, 2) : null
  const position = sessionTotal - queue.length + 1
  const accuracyLabel =
    stats && stats.totalResolved > 0
      ? `${Math.round((stats.totalCleanSolves / stats.totalResolved) * 100)}%`
      : '—'

  const handleMove = (from: string, to: string): boolean => {
    if (result !== null || gaveUp) return false // already resolved or waiting on Retry

    const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setTaggedAttempt({ cardId: currentCard.cardId, fen: fenAfterAttempt })
    setIsGrading(true)
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setTaggedResult({ cardId: currentCard.cardId, result: r })
    })
    return true
  }

  const handleRetry = (): void => {
    setTaggedAttempt(null)
    setTaggedResult(null)
  }

  const handleGiveUp = (): void => {
    giveUp()
    setTaggedGaveUp(currentCard.cardId)
  }

  const tags = tacticTags(currentCard.missedTactics, currentCard.punishedByTactics)

  return (
    <div className="puzzles-tab">
      {stats && (
        <div className="puzzle-stats-bar">
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.rating}</span>
            <span className="puzzle-stat-label">Rating</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.currentStreak}</span>
            <span className="puzzle-stat-label">Streak</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.solvedToday}</span>
            <span className="puzzle-stat-label">Solved today</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{accuracyLabel}</span>
            <span className="puzzle-stat-label">Accuracy</span>
          </div>
        </div>
      )}
      <p className="puzzle-status-panel">{`Puzzle ${position} of ${sessionTotal}`}</p>
      <div className="analysis-layout">
        <div className="board-column">
          <Board
            // While grading (or ungraded), show wherever the attempt
            // landed. Once a verdict exists, revert to fenBefore -
            // bestMoveUci describes a move IN fenBefore, one ply earlier
            // than wherever the attempt ended up, so the reveal arrow
            // below is only ever correct against fenBefore.
            fen={result === null && attemptFen !== null ? attemptFen : currentCard.fenBefore}
            bestMoveUci={resolved ? currentCard.bestMoveUci : null}
            currentMove={null}
            boardOrientation={currentCard.userColor === 'w' ? 'white' : 'black'}
            onMove={handleMove}
            hintSquare={hintSquare}
          />
          {result !== null && 'error' in result && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>{result.error}</span>
              <button className="button-secondary" onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}
          {result !== null && 'correct' in result && !result.correct && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>Not quite — try again.</span>
              <button className="button-secondary" onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}
          {result !== null && 'correct' in result && result.correct && (
            <div className="puzzle-feedback puzzle-feedback-correct">
              <span>Correct!</span>
              <button className="button-primary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {gaveUp && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>Here's the move you missed.</span>
              <button className="button-primary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {!resolved && (
            <div className="puzzle-hint-controls">
              <button className="button-secondary" onClick={requestHint} disabled={isGrading || hintUsed}>
                {hintUsed ? 'Hint used' : 'Hint'}
              </button>
              <button className="button-secondary" onClick={handleGiveUp} disabled={isGrading || !hintUsed}>
                Can't solve
              </button>
            </div>
          )}
          {isGrading && <p className="puzzle-status-panel">Grading…</p>}
        </div>
        <div className="side-panel">
          {tags.length > 0 && (
            <div className="tactic-chip-row">
              {tags.map((tag) => (
                <span key={tag} className="tactic-chip">
                  {TACTIC_LABELS[tag]}
                </span>
              ))}
            </div>
          )}
          <p className="puzzle-status-panel">
            {`vs ${currentCard.opponentUsername} · ${new Date(currentCard.endTime * 1000).toLocaleDateString()}`}
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add CSS to `src/renderer/src/app.css`**

Add directly after the existing `.puzzle-feedback-incorrect` rule:

```css
.puzzle-stats-bar {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.puzzle-stat-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  padding: 0.5rem 1rem;
  min-width: 5.5rem;
}

.puzzle-stat-value {
  font-family: var(--font-display);
  font-size: 1.3rem;
  color: var(--text);
}

.puzzle-stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.puzzle-hint-controls {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.75rem;
}
```

- [ ] **Step 4: Typecheck, run the full suite, build**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (same total as Task 5 left it — this task adds no new test files).

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 5: Verify via `run-desktop`**

Build first if not already done in Step 4, then drive the app. This requires at least one mistake already in the local Insights cache — if the dev environment's test chess.com account (`zlakin`, per this project's setup) hasn't been scanned yet in this environment, run an Insights scan first (via the app's own Insights tab) before running the script below, or the queue will legitimately be empty and the puzzle-solving path below won't be exercised.

```bash
cat > /tmp/verify-puzzle-flow.txt <<'EOF'
launch
click-text Puzzles
sleep 500
ss puzzle-flow-initial
eval document.querySelector('.puzzle-stats-bar')?.textContent
eval document.querySelector('.puzzle-hint-controls')?.textContent
click-text Hint
sleep 300
ss puzzle-flow-after-hint
eval document.querySelector('.puzzle-hint-controls')?.textContent
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-puzzle-flow.txt
```

Expected: `puzzle-flow-initial` shows the four stat tiles (Rating/Streak/Solved today/Accuracy) above the board, and `.puzzle-hint-controls` contains "Hint" and "Can't solve" (Can't solve disabled — confirm from the screenshot, since `eval ...textContent` doesn't show the `disabled` attribute). After clicking Hint, `puzzle-flow-after-hint` shows a highlighted square on the board and `.puzzle-hint-controls`'s text now reads "Hint used" / "Can't solve".

Now, using the actual position visible in `puzzle-flow-after-hint` (not the highlighted square — a different legal move for whichever side is to move, to test the wrong-answer path), continue the same session:

```bash
cat > /tmp/verify-puzzle-flow-2.txt <<'EOF'
launch
click-text Puzzles
sleep 500
click [data-square="<FROM>"]
sleep 200
click [data-square="<TO>"]
sleep 1500
ss puzzle-flow-after-wrong-move
eval document.querySelector('.puzzle-feedback')?.textContent
click-text Retry
sleep 300
ss puzzle-flow-after-retry
click-text Hint
sleep 300
click-text "Can't solve"
sleep 300
ss puzzle-flow-after-give-up
eval document.querySelector('.puzzle-feedback')?.textContent
click-text Next
sleep 500
ss puzzle-flow-after-next
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-puzzle-flow-2.txt
```

Replace `<FROM>`/`<TO>` with two squares that make a legal move in the position shown in the first script's screenshots, deliberately not the recorded best move (if unsure which move is "best," any legal move other than the hint's source→somewhere-plausible works — the goal is to land on the wrong-answer branch, not the correct one). Expected: after the wrong move, `.puzzle-feedback` reads "Not quite — try again." with a visible Retry button; after Retry, the board is interactive again with no feedback shown; after Hint then "Can't solve", `.puzzle-feedback` reads "Here's the move you missed." with the best-move arrow visible on the board and a Next button; after Next, either a new puzzle's stat bar/position line update, or the "You're all caught up" empty state appears.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-puzzle-flow.txt /tmp/verify-puzzle-flow-2.txt
git add src/renderer/src/components/Board.tsx src/renderer/src/components/PuzzlesTab.tsx src/renderer/src/app.css
git commit -m "Add retry, hints, give-up, and a stats bar to the Puzzles tab"
```

## Testing

Tasks 1, 2, and 4 have real unit tests for every pure/mockable unit (`puzzleRating.ts`, `puzzleStatsStore.ts`, `puzzleOutcome.ts`) — 18 new tests total. `usePuzzleSession` and `PuzzlesTab`/`Board` are verified via `run-desktop` against the actual built app, matching this codebase's established no-jsdom policy (the same approach the original `usePuzzleSession`/`PuzzlesTab` build used).

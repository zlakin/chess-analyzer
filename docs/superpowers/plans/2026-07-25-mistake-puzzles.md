# Mistake-Driven Puzzle Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a player's own recorded mistakes (already detected by the
Insights tactical-insights engine) into a spaced-repetition puzzle queue —
a new "Puzzles" tab where the player attempts the move they actually
missed, graded live against the engine, scheduled via SM-2.

**Architecture:** A new `src/main/srs/` module owns SM-2 scheduling and a
local JSON store of per-mistake review state, joined at read time against
the existing `GameInsightRecord` data Insights scans already produce — no
new detection logic. Grading happens in the renderer, reusing the
`evaluatePosition` IPC channel and `computeMoveEvalDelta` math that
variation exploration and full-game analysis already use, so puzzle
correctness and move classification share one yardstick.

**Tech Stack:** Existing stack only — `chess.js`, the existing
`StockfishManager`/IPC/preload patterns, Node's `fs`/`node:path` for a new
local JSON store (matching `insightsStore.ts`/`settingsStore.ts`). No new
dependencies.

## Global Constraints

- No filtering out mistakes from already-decided positions — out of
  scope for this pass (see the design spec's Future Ideas).
- No daily new-card/review caps — the Puzzles tab always shows whatever
  is currently due, no session-size limit.
- No manual curation of which mistakes enter the deck — every
  mistake/blunder an Insights scan finds is automatically enrolled.
- Grading accepts any move within a cp-loss threshold of best (see Task
  3), not just an exact match to the recorded `bestMoveUci` — only the
  recorded `bestMoveUci` is ever displayed as the answer, though.
- No cross-device sync. SRS state is local-only.
- This repo's git workflow: commit straight to `main`, no
  branches/worktrees/PRs.

---

### Task 1: Main process — SM-2 scheduler + SRS store

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/srs/sm2.ts`
- Create: `src/main/srs/sm2.test.ts`
- Create: `src/main/srs/srsStore.ts`
- Create: `src/main/srs/srsStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SrsCardState`, `SrsQuality` (both in `src/shared/types.ts`
  from this task on). `newCardState(cardId: string, now: number):
  SrsCardState`, `nextCardState(current: SrsCardState, quality:
  SrsQuality, now: number): SrsCardState` (`src/main/srs/sm2.ts`).
  `loadSrsState(): Record<string, SrsCardState>`, `saveSrsState(state:
  Record<string, SrsCardState>): void` (`src/main/srs/srsStore.ts`) —
  Task 2's IPC handlers call all four of these.

- [ ] **Step 1: Add `SrsCardState`/`SrsQuality` to `src/shared/types.ts`**

Add after the `ScanOutcome` type at the end of the file:

```ts
export type SrsQuality = 0 | 1 | 2 | 3 | 4 | 5

export interface SrsCardState {
  cardId: string
  easeFactor: number
  intervalDays: number
  repetitions: number
  dueDate: number
  lastReviewedAt: number | null
}
```

`cardId` is always `` `${gameUrl}#${ply}` `` (built in Task 2) —
`SrsCardState` itself doesn't need to know that, it just stores whatever
string it's given as the record's key. `dueDate`/`lastReviewedAt` are
epoch milliseconds.

- [ ] **Step 2: Write `src/main/srs/sm2.ts`**

**Revision (caught during Task 1's own task review — a real deviation
from the standard SM-2 algorithm, not from this plan's own text, so not
implementer error): the interval for the third-and-later successful
repetition must be computed using the *pre-update* ease factor, not the
one just recomputed for this review.** Real SM-2 computes `I(n) =
I(n-1) * EF` using the ease factor as it stood *before* this review's
quality-based adjustment, and only updates `EF` afterward, for the *next*
review to use. Computing the interval with the already-updated `EF` (as
an earlier draft of this code did) produces increasingly-too-long
intervals from the third successful review onward — about 12% too long
by the fifth, and worse from there, since each wrong interval compounds
into the next. The code below has this fixed: `intervalDays` is computed
first, against `current.easeFactor`, and `easeFactor` is computed
afterward.

```ts
import type { SrsCardState, SrsQuality } from '../../shared/types'

const DEFAULT_EASE_FACTOR = 2.5
const MIN_EASE_FACTOR = 1.3
const MS_PER_DAY = 86400000

export function newCardState(cardId: string, now: number): SrsCardState {
  return {
    cardId,
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 0,
    repetitions: 0,
    dueDate: now,
    lastReviewedAt: null
  }
}

export function nextCardState(current: SrsCardState, quality: SrsQuality, now: number): SrsCardState {
  if (quality < 3) {
    // SM-2: a fail resets the repetition streak and drops straight back
    // to a 1-day interval, but leaves easeFactor untouched - ease only
    // ever moves on a pass, per the standard SM-2 definition.
    return {
      ...current,
      repetitions: 0,
      intervalDays: 1,
      dueDate: now + MS_PER_DAY,
      lastReviewedAt: now
    }
  }

  const repetitions = current.repetitions + 1
  // Uses current.easeFactor (the PRE-update value) - real SM-2 computes
  // this review's interval from the ease factor as it stood going into
  // the review, then updates the ease factor afterward for next time.
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(current.intervalDays * current.easeFactor)
  const easeFactor = Math.max(
    MIN_EASE_FACTOR,
    current.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  )

  return {
    ...current,
    repetitions,
    easeFactor,
    intervalDays,
    dueDate: now + intervalDays * MS_PER_DAY,
    lastReviewedAt: now
  }
}
```

This is the standard SM-2 algorithm (SuperMemo-2, 1987) — quality `< 3`
is a fail, quality `>= 3` is a pass with the interval growing by
`previousInterval * easeFactor` (the pre-update ease factor) from the
third successful repetition onward. `easeFactor` is clamped to a `1.3`
floor so a run of weak passes can't shrink it (and therefore future
intervals) toward zero.

- [ ] **Step 3: Write `src/main/srs/sm2.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { newCardState, nextCardState } from './sm2'

const DAY = 86400000

describe('sm2', () => {
  it('newCardState is due immediately with SM-2 defaults', () => {
    expect(newCardState('card-1', 1000)).toEqual({
      cardId: 'card-1',
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      dueDate: 1000,
      lastReviewedAt: null
    })
  })

  it('produces the standard SM-2 interval/ease sequence for constant quality 5', () => {
    let state = newCardState('card-1', 0)
    const now = () => state.dueDate // each review happens exactly when the previous one came due

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(1)
    expect(state.easeFactor).toBeCloseTo(2.6)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(6)
    expect(state.easeFactor).toBeCloseTo(2.7)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(16) // round(6 * 2.7) - uses the PRE-update EF (2.7), not 2.8
    expect(state.easeFactor).toBeCloseTo(2.8)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(45) // round(16 * 2.8)
    expect(state.easeFactor).toBeCloseTo(2.9)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(131) // round(45 * 2.9)
    expect(state.easeFactor).toBeCloseTo(3.0)
  })

  it('holds easeFactor exactly flat for constant quality 4 (its delta is zero)', () => {
    let state = newCardState('card-1', 0)
    const now = () => state.dueDate

    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(1)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(6)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(15) // round(6 * 2.5)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(38) // round(15 * 2.5)

    expect(state.easeFactor).toBeCloseTo(2.5)
  })

  it('a fail resets repetitions and interval to a 1-day restart, leaving easeFactor untouched', () => {
    let state = newCardState('card-1', 0)
    state = nextCardState(state, 5, 0) // pass: repetitions 1, EF 2.6
    state = nextCardState(state, 5, DAY) // pass: repetitions 2, EF 2.7

    const failedAt = 7 * DAY
    state = nextCardState(state, 1, failedAt)

    expect(state.repetitions).toBe(0)
    expect(state.intervalDays).toBe(1)
    expect(state.dueDate).toBe(failedAt + DAY)
    expect(state.easeFactor).toBeCloseTo(2.7) // unchanged by the fail
    expect(state.lastReviewedAt).toBe(failedAt)

    // Recovering after a lapse restarts the 1/6/interval*EF progression
    // from repetition 1, but keeps the ease factor the lapse left behind.
    state = nextCardState(state, 5, state.dueDate)
    expect(state.repetitions).toBe(1)
    expect(state.intervalDays).toBe(1)
    expect(state.easeFactor).toBeCloseTo(2.8)
  })

  it('easeFactor never drops below the 1.3 floor under repeated weak passes', () => {
    let state = newCardState('card-1', 0)
    for (let i = 0; i < 20; i++) {
      state = nextCardState(state, 3, state.dueDate)
    }
    expect(state.easeFactor).toBe(1.3)
  })
})
```

- [ ] **Step 4: Run the SM-2 tests**

```bash
npx vitest run src/main/srs/sm2.test.ts
```

Expected: 5 passed, 0 failed.

- [ ] **Step 5: Write `src/main/srs/srsStore.ts`**

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SrsCardState } from '../../shared/types'

function srsStatePath(): string {
  return join(app.getPath('userData'), 'srs-state.json')
}

export function loadSrsState(): Record<string, SrsCardState> {
  const path = srsStatePath()
  if (!existsSync(path)) return {}

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, SrsCardState>
  } catch {
    return {}
  }
}

export function saveSrsState(state: Record<string, SrsCardState>): void {
  const path = srsStatePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}
```

One JSON file for the whole store (not one-per-card, unlike
`insightsStore.ts`'s per-game files) — SRS state is a handful of fields
per card with no per-card fetch pattern to optimize for.

- [ ] **Step 6: Write `src/main/srs/srsStore.test.ts`**

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

import { loadSrsState, saveSrsState } from './srsStore'
import type { SrsCardState } from '../../shared/types'

function card(cardId: string): SrsCardState {
  return { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate: 5000, lastReviewedAt: 1000 }
}

describe('srsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-srs-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns an empty object when nothing has been saved yet', () => {
    expect(loadSrsState()).toEqual({})
  })

  it('round-trips state for multiple cards', () => {
    saveSrsState({ 'game#1': card('game#1'), 'game#2': card('game#2') })
    expect(loadSrsState()).toEqual({ 'game#1': card('game#1'), 'game#2': card('game#2') })
  })

  it('treats a corrupted store file as empty rather than throwing', () => {
    saveSrsState({ 'game#1': card('game#1') })
    writeFileSync(join(userDataDir, 'srs-state.json'), '{not valid json', 'utf-8')

    expect(loadSrsState()).toEqual({})
  })

  it('overwrites the whole file on save (not a merge)', () => {
    saveSrsState({ 'game#1': card('game#1') })
    saveSrsState({ 'game#2': card('game#2') })

    expect(loadSrsState()).toEqual({ 'game#2': card('game#2') })
  })
})
```

- [ ] **Step 7: Run the SRS store tests**

```bash
npx vitest run src/main/srs/srsStore.test.ts
```

Expected: 4 passed, 0 failed.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: clean (neither new file is consumed by anything yet).

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/srs/sm2.ts src/main/srs/sm2.test.ts \
  src/main/srs/srsStore.ts src/main/srs/srsStore.test.ts
git commit -m "Add SM-2 scheduler and SRS state store"
```

---

### Task 2: Main process — puzzle queue join + IPC

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Create: `src/main/srs/puzzleQueue.ts`
- Create: `src/main/srs/puzzleQueue.test.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `newCardState`, `nextCardState` (`src/main/srs/sm2.ts`,
  Task 1). `loadSrsState`, `saveSrsState` (`src/main/srs/srsStore.ts`,
  Task 1). `SrsCardState`, `SrsQuality` (`src/shared/types.ts`, Task 1).
  Existing `loadAllGameRecords`, `ensureSchemaVersion`
  (`src/main/insights/insightsStore.ts`) and `GameInsightRecord`
  (`src/shared/types.ts`).
- Produces: `PuzzleCard`, `PuzzleQueue` (`src/shared/types.ts`).
  `buildPuzzleQueue(records: GameInsightRecord[], srsState:
  Record<string, SrsCardState>, now: number): PuzzleQueue`
  (`src/main/srs/puzzleQueue.ts`) — pure, no I/O. `ChessAPI.
  getPuzzleQueue(): Promise<PuzzleQueue>` and `ChessAPI.
  submitPuzzleReview(cardId: string, quality: SrsQuality):
  Promise<SrsCardState>` — Task 3 calls both from the renderer.

**A note on IPC error-handling convention:** the design spec suggested
these two calls follow the `T | { error: string }` union used elsewhere.
On closer look at this codebase, that union is only used by calls that
reach an external process/network/dialog (`evaluatePosition`,
`fetchChessComGames`, etc.) — reads/writes of local JSON storage
(`getSettings`, `setTheme`, `getInsightsReport`) don't use it, because the
underlying store functions already swallow corruption internally and
return safe defaults (see `insightsStore.ts`'s `loadAllGameRecords`,
which skips a corrupted file rather than surfacing an error). `srsStore.ts`
follows that same pattern (Task 1, Step 6's corrupted-file test), so
`getPuzzleQueue`/`submitPuzzleReview` follow `getSettings`/`setTheme`'s
precedent instead — no error union.

- [ ] **Step 1: Add `PuzzleCard`/`PuzzleQueue` to `src/shared/types.ts` and extend `ChessAPI`**

Add after the `SrsCardState` interface added in Task 1:

```ts
export interface PuzzleCard {
  cardId: string
  gameUrl: string
  ply: number
  fenBefore: string
  playedMoveUci: string
  bestMoveUci: string
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  opponentUsername: string
  endTime: number
  userColor: 'w' | 'b'
}

export interface PuzzleQueue {
  due: PuzzleCard[]
  nextDueAt: number | null
}
```

Add two methods to the `ChessAPI` interface (alongside `getInsightsReport`):

```ts
  getPuzzleQueue(): Promise<PuzzleQueue>
  submitPuzzleReview(cardId: string, quality: SrsQuality): Promise<SrsCardState>
```

- [ ] **Step 2: Add two IPC channels to `src/shared/ipc.ts`**

Add after `getInsightsReport: 'insights:get-report'`:

```ts
  getPuzzleQueue: 'puzzles:get-queue',
  submitPuzzleReview: 'puzzles:submit-review'
```

- [ ] **Step 3: Write `src/main/srs/puzzleQueue.ts`**

```ts
import type { GameInsightRecord, PuzzleCard, PuzzleQueue, SrsCardState } from '../../shared/types'
import { newCardState } from './sm2'

export function buildPuzzleQueue(
  records: GameInsightRecord[],
  srsState: Record<string, SrsCardState>,
  now: number
): PuzzleQueue {
  const cards: Array<{ card: PuzzleCard; state: SrsCardState }> = []

  for (const record of records) {
    for (const mistake of record.mistakes) {
      const cardId = `${record.gameUrl}#${mistake.ply}`
      const card: PuzzleCard = {
        cardId,
        gameUrl: record.gameUrl,
        ply: mistake.ply,
        fenBefore: mistake.fenBefore,
        playedMoveUci: mistake.playedMoveUci,
        bestMoveUci: mistake.bestMoveUci,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics,
        classification: mistake.classification,
        phase: mistake.phase,
        opponentUsername: record.opponentUsername,
        endTime: record.endTime,
        userColor: record.userColor
      }
      // A card missing from srsState (never reviewed) gets a synthesized
      // default here, in memory only - it is NOT written back to the
      // store. The default's dueDate is always "now" regardless of when
      // it's computed, so recomputing it fresh on every call is
      // equivalent to persisting it eagerly, without needing a write path
      // in what is otherwise a pure read. The store only ever gains an
      // entry for a card once it's actually been reviewed (Task 2, Step 5).
      const state = srsState[cardId] ?? newCardState(cardId, now)
      cards.push({ card, state })
    }
  }

  const due = cards
    .filter(({ state }) => state.dueDate <= now)
    .sort((a, b) => a.state.dueDate - b.state.dueDate)
    .map(({ card }) => card)

  const nextDueAt = cards.length === 0 ? null : Math.min(...cards.map(({ state }) => state.dueDate))

  return { due, nextDueAt }
}
```

- [ ] **Step 4: Write `src/main/srs/puzzleQueue.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildPuzzleQueue } from './puzzleQueue'
import type { GameInsightRecord, SrsCardState } from '../../shared/types'

function mistakeRecord(gameUrl: string, plies: number[]): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'loss',
    openingName: null,
    accuracy: 80,
    mistakes: plies.map((ply) => ({
      ply,
      classification: 'blunder',
      phase: 'middlegame',
      cpLoss: 250,
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      playedMoveUci: 'e2e3',
      bestMoveUci: 'e2e4',
      missedTactics: [],
      punishedByTactics: [],
      clockSecondsRemaining: null,
      isTimePressure: false
    }))
  }
}

function state(cardId: string, dueDate: number): SrsCardState {
  return { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate, lastReviewedAt: 0 }
}

describe('buildPuzzleQueue', () => {
  it('synthesizes a due-now default for a mistake never reviewed before', () => {
    const records = [mistakeRecord('g1', [10])]
    const queue = buildPuzzleQueue(records, {}, 5000)

    expect(queue.due).toHaveLength(1)
    expect(queue.due[0].cardId).toBe('g1#10')
    expect(queue.nextDueAt).toBe(5000)
  })

  it('excludes a card whose stored dueDate is in the future', () => {
    const records = [mistakeRecord('g1', [10])]
    const srsState = { 'g1#10': state('g1#10', 10000) }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due).toEqual([])
    expect(queue.nextDueAt).toBe(10000)
  })

  it('includes a card whose stored dueDate has already passed', () => {
    const records = [mistakeRecord('g1', [10])]
    const srsState = { 'g1#10': state('g1#10', 1000) }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due).toHaveLength(1)
    expect(queue.due[0].cardId).toBe('g1#10')
  })

  it('sorts due cards oldest-due-first', () => {
    const records = [mistakeRecord('g1', [10, 20])]
    const srsState = {
      'g1#10': state('g1#10', 3000),
      'g1#20': state('g1#20', 1000)
    }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due.map((c) => c.cardId)).toEqual(['g1#20', 'g1#10'])
  })

  it('nextDueAt is the soonest dueDate across the full set, including not-yet-due cards', () => {
    const records = [mistakeRecord('g1', [10, 20])]
    const srsState = {
      'g1#10': state('g1#10', 9000), // not due
      'g1#20': state('g1#20', 500) // due
    }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.nextDueAt).toBe(500)
  })

  it('returns an empty queue with a null nextDueAt when there are no mistakes at all', () => {
    const queue = buildPuzzleQueue([], {}, 5000)
    expect(queue).toEqual({ due: [], nextDueAt: null })
  })
})
```

- [ ] **Step 5: Run the puzzle queue tests**

```bash
npx vitest run src/main/srs/puzzleQueue.test.ts
```

Expected: 6 passed, 0 failed.

- [ ] **Step 6: Add two handlers to `src/main/ipc/handlers.ts`**

Add these imports alongside the existing ones:

```ts
import { loadSrsState, saveSrsState } from '../srs/srsStore'
import { newCardState, nextCardState } from '../srs/sm2'
import { buildPuzzleQueue } from '../srs/puzzleQueue'
import type { SrsQuality } from '../../shared/types'
```

Add two handlers after the existing `getInsightsReport` handler, inside
`registerIpcHandlers`:

```ts
  ipcMain.handle(IPC_CHANNELS.getPuzzleQueue, async () => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const srsState = loadSrsState()
    return buildPuzzleQueue(records, srsState, Date.now())
  })

  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleReview,
    async (_event, cardId: string, quality: SrsQuality) => {
      const now = Date.now()
      const srsState = loadSrsState()
      const current = srsState[cardId] ?? newCardState(cardId, now)
      const updated = nextCardState(current, quality, now)
      saveSrsState({ ...srsState, [cardId]: updated })
      return updated
    }
  )
```

- [ ] **Step 7: Add two methods to `src/preload/index.ts`**

Add to the `chessAPI` object, alongside `getInsightsReport`:

```ts
  getPuzzleQueue: () => ipcRenderer.invoke(IPC_CHANNELS.getPuzzleQueue),
  submitPuzzleReview: (cardId: string, quality: SrsQuality) =>
    ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleReview, cardId, quality),
```

Add `SrsQuality` to the existing type-only import from `'../shared/types'`
at the top of the file.

- [ ] **Step 8: Typecheck and run the full suite**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (this task adds 6 new tests —
`puzzleQueue.test.ts` — on top of Task 1's 9, so 235 total if the suite
was at 226 going into this task).

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/main/srs/puzzleQueue.ts \
  src/main/srs/puzzleQueue.test.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Add puzzle queue join logic and IPC"
```

---

### Task 3: Renderer — grading logic + `usePuzzleSession` hook

**Files:**
- Create: `src/renderer/src/lib/cpLossToQuality.ts`
- Create: `src/renderer/src/lib/cpLossToQuality.test.ts`
- Create: `src/renderer/src/hooks/usePuzzleSession.ts`

**Interfaces:**
- Consumes: `window.chessAPI.getPuzzleQueue`,
  `window.chessAPI.evaluatePosition`, `window.chessAPI.submitPuzzleReview`
  (Task 2). `tryMove` (`src/renderer/src/lib/tryMove.ts`, already exists
  from the variation-exploration sub-project — signature `tryMove(fen:
  string, from: string, to: string): string | null`).
  `computeMoveEvalDelta` (`src/shared/engineMath.ts`, already exists —
  `computeMoveEvalDelta(evalBefore: PositionEvaluation, evalAfter:
  PositionEvaluation, playedMoveUci: string): MoveEvalDelta`, where
  `MoveEvalDelta.cpLoss: number`). `PuzzleCard`, `PuzzleQueue`
  (`src/shared/types.ts`, Task 2).
- Produces: `cpLossToQuality(cpLoss: number): SrsQuality`
  (`src/renderer/src/lib/cpLossToQuality.ts`). `usePuzzleSession(): {
  queue: PuzzleCard[]; nextDueAt: number | null; currentCard: PuzzleCard |
  null; attempt: (from: string, to: string) => Promise<PuzzleAttemptResult
  | { error: string }>; next: () => void; isLoading: boolean }` and the
  exported `PuzzleAttemptResult` type (`src/renderer/src/hooks/
  usePuzzleSession.ts`) — Task 4's `PuzzlesTab` consumes all of it.

- [ ] **Step 1: Write `src/renderer/src/lib/cpLossToQuality.ts`**

```ts
import type { SrsQuality } from '../../../shared/types'

export function cpLossToQuality(cpLoss: number): SrsQuality {
  if (cpLoss <= 20) return 5
  if (cpLoss <= 50) return 4
  if (cpLoss <= 100) return 3
  return 1
}
```

These boundaries are `classification.ts`'s existing `CP_LOSS_TIERS`
excellent/good/inaccuracy cutoffs (`src/main/analysis/classification.ts:
12-17`) — puzzle grading and move classification share one yardstick.

- [ ] **Step 2: Write `src/renderer/src/lib/cpLossToQuality.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { cpLossToQuality } from './cpLossToQuality'

describe('cpLossToQuality', () => {
  it('is quality 5 at and below the excellent-tier boundary', () => {
    expect(cpLossToQuality(0)).toBe(5)
    expect(cpLossToQuality(19)).toBe(5)
    expect(cpLossToQuality(20)).toBe(5)
  })

  it('is quality 4 just past the excellent boundary, through the good-tier boundary', () => {
    expect(cpLossToQuality(21)).toBe(4)
    expect(cpLossToQuality(49)).toBe(4)
    expect(cpLossToQuality(50)).toBe(4)
  })

  it('is quality 3 just past the good boundary, through the inaccuracy-tier boundary', () => {
    expect(cpLossToQuality(51)).toBe(3)
    expect(cpLossToQuality(99)).toBe(3)
    expect(cpLossToQuality(100)).toBe(3)
  })

  it('is quality 1 past the inaccuracy boundary', () => {
    expect(cpLossToQuality(101)).toBe(1)
    expect(cpLossToQuality(500)).toBe(1)
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/renderer/src/lib/cpLossToQuality.test.ts
```

Expected: 4 passed, 0 failed.

- [ ] **Step 4: Write `src/renderer/src/hooks/usePuzzleSession.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import type { PuzzleCard } from '../../../shared/types'
import { computeMoveEvalDelta } from '../../../shared/engineMath'
import { tryMove } from '../lib/tryMove'
import { cpLossToQuality } from '../lib/cpLossToQuality'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

export function usePuzzleSession(): {
  queue: PuzzleCard[]
  nextDueAt: number | null
  currentCard: PuzzleCard | null
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<PuzzleCard[]>([])
  const [nextDueAt, setNextDueAt] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const result = await window.chessAPI.getPuzzleQueue()
    setQueue(result.due)
    setNextDueAt(result.nextDueAt)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const currentCard = queue[0] ?? null

  const attempt = useCallback(
    async (from: string, to: string): Promise<PuzzleAttemptResult | { error: string }> => {
      if (!currentCard) return { error: 'No puzzle to attempt.' }

      const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      const [evalBefore, evalAfter] = await Promise.all([
        window.chessAPI.evaluatePosition(currentCard.fenBefore, PUZZLE_DEPTH),
        window.chessAPI.evaluatePosition(fenAfterAttempt, PUZZLE_DEPTH)
      ])
      if ('error' in evalBefore) return { error: evalBefore.error }
      if ('error' in evalAfter) return { error: evalAfter.error }

      const { cpLoss } = computeMoveEvalDelta(evalBefore, evalAfter, `${from}${to}`)
      const quality = cpLossToQuality(cpLoss)
      try {
        await window.chessAPI.submitPuzzleReview(currentCard.cardId, quality)
      } catch (err) {
        // The grading verdict itself is still valid and worth showing even
        // if persisting the new SRS schedule failed - the user did get
        // real feedback, only the "when do I see this again" bookkeeping
        // is at risk. Logged, not surfaced, matching this app's existing
        // precedent for storage-layer hiccups elsewhere.
        console.error('Failed to persist puzzle review', err)
      }

      return { correct: quality >= 3, cpLoss, bestMoveUci: currentCard.bestMoveUci }
    },
    [currentCard]
  )

  // Deliberately does NOT refetch the queue - if it did, a card that just
  // passed could drop out (or the whole queue reorder) while its pass/fail
  // feedback is still on screen, snapping the board to a different puzzle
  // out from under the user before they've clicked "Next". next() (below)
  // is the point where the user has said they're done looking at this
  // card, so that's when it's safe to advance and reconcile with the
  // server's state.
  const next = useCallback(() => {
    setQueue((q) => q.slice(1))
    void loadQueue()
  }, [loadQueue])

  return { queue, nextDueAt, currentCard, attempt, next, isLoading }
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean (this hook isn't consumed by anything yet — Task 4 wires
it up — so this just confirms the file itself is well-typed).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/cpLossToQuality.ts \
  src/renderer/src/lib/cpLossToQuality.test.ts \
  src/renderer/src/hooks/usePuzzleSession.ts
git commit -m "Add puzzle grading logic and usePuzzleSession hook"
```

---

### Task 4: Renderer — `PuzzlesTab`, nav, and `App.tsx` wiring

**Files:**
- Create: `src/renderer/src/components/PuzzlesTab.tsx`
- Modify: `src/renderer/src/components/NavBar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `usePuzzleSession` (Task 3). `Board` (`src/renderer/src/
  components/Board.tsx`, already exists — `fen`, `bestMoveUci`,
  `currentMove`, `boardOrientation`, `onMove`, `onHeightChange?` props,
  unchanged by this task). `tryMove` (existing). `TACTIC_LABELS`
  (`src/renderer/src/lib/tacticLabels.ts`, existing).
- Produces: nothing new consumed by other tasks — this is the last task.

- [ ] **Step 1: Write `src/renderer/src/components/PuzzlesTab.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { TACTIC_LABELS } from '../lib/tacticLabels'
import { Board } from './Board'
import type { TacticType } from '../../../shared/types'

function tacticTags(missed: TacticType[], punished: TacticType[]): TacticType[] {
  return Array.from(new Set([...missed, ...punished]))
}

export function PuzzlesTab(): JSX.Element {
  const { queue, nextDueAt, currentCard, attempt, next, isLoading } = usePuzzleSession()
  const [attemptFen, setAttemptFen] = useState<string | null>(null)
  const [result, setResult] = useState<PuzzleAttemptResult | { error: string } | null>(null)
  const [isGrading, setIsGrading] = useState(false)

  // A new card (via next(), or the very first card loading in) starts
  // clean - any leftover attempt/result/grading state described a
  // *previous* card and would otherwise leak into this one.
  useEffect(() => {
    setAttemptFen(null)
    setResult(null)
    setIsGrading(false)
  }, [currentCard?.cardId])

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

  const handleMove = (from: string, to: string): boolean => {
    if (result !== null) return false // already graded this card, waiting on Next

    const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setAttemptFen(fenAfterAttempt)
    setIsGrading(true)
    // attempt() re-derives the same resulting FEN internally (it needs to
    // evaluate that position, not just know it) - recomputing tryMove
    // there is cheap and keeps the hook self-contained rather than
    // threading this component's already-computed FEN through its
    // signature.
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setResult(r)
    })
    return true
  }

  const tags = tacticTags(currentCard.missedTactics, currentCard.punishedByTactics)

  return (
    <div className="puzzles-tab">
      <div className="analysis-layout">
        <div className="board-column">
          <Board
            fen={attemptFen ?? currentCard.fenBefore}
            bestMoveUci={result !== null && 'correct' in result ? currentCard.bestMoveUci : null}
            currentMove={null}
            boardOrientation={currentCard.userColor === 'w' ? 'white' : 'black'}
            onMove={handleMove}
          />
          {result !== null && 'error' in result && <div className="import-error">{result.error}</div>}
          {result !== null && 'correct' in result && (
            <div className={`puzzle-feedback ${result.correct ? 'puzzle-feedback-correct' : 'puzzle-feedback-incorrect'}`}>
              <span>{result.correct ? 'Correct!' : 'Not quite.'}</span>
              <button className="button-secondary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {isGrading && <p className="puzzle-status-panel">Grading…</p>}
        </div>
        <div className="side-panel">
          <p className="puzzle-status-panel">
            {queue.length} puzzle{queue.length === 1 ? '' : 's'} due
          </p>
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

`endTime` is in seconds (chess.com API convention, matching
`RecentMistakesList.tsx`'s identical `* 1000` conversion) — not a new
pattern, reused as-is.

- [ ] **Step 2: Add the `puzzles` tab to `src/renderer/src/components/NavBar.tsx`**

Change the `AppTab` type:

```ts
export type AppTab = 'analyze' | 'insights' | 'puzzles'
```

Add a third tab button, after the existing Insights button (inside the
`<nav className="segmented-control">` block):

```tsx
        <button
          className={`segmented-control-option${activeTab === 'puzzles' ? ' active' : ''}`}
          onClick={() => onSelectTab('puzzles')}
        >
          Puzzles
        </button>
```

No new props needed — `PuzzlesTab` manages its own loading state
internally (Step 1), unlike `isAnalyzing`/`isScanning` which reflect
long-running background operations `NavBar` shows a spinner for.

- [ ] **Step 3: Wire `PuzzlesTab` into `src/renderer/src/App.tsx`**

Add the import, alongside the existing `InsightsTab` import:

```ts
import { PuzzlesTab } from './components/PuzzlesTab'
```

Add the tab render, after the existing `{activeTab === 'insights' && ...}`
block, before the closing `</main>`:

```tsx
        {activeTab === 'puzzles' && <PuzzlesTab />}
```

- [ ] **Step 4: Add CSS to `src/renderer/src/app.css`**

Add near the existing `.exploring-banner`/`.insights-empty-message` rules:

```css
.puzzles-tab {
  padding: 1.5rem;
}

.puzzle-empty-message {
  color: var(--text-muted);
  font-size: 1rem;
}

.puzzle-status-panel {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0.5rem 0;
}

.puzzle-feedback {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.puzzle-feedback-correct {
  border-color: var(--mq-best);
  color: var(--mq-best);
}

.puzzle-feedback-incorrect {
  border-color: var(--mq-blunder);
  color: var(--mq-blunder);
}
```

`--mq-best`/`--mq-blunder` are the app's existing move-classification
green/red tokens (`src/renderer/src/app.css`'s `:root` block) — reused
here rather than introducing new colors, and they already have both
light- and dark-theme values defined.

- [ ] **Step 5: Typecheck, run the full suite, build**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (this task adds no new test
files — same total as Task 3 left it).

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 6: Verify via `run-desktop`**

Build first if not already done in Step 5, then drive the app. This
requires at least one mistake already in the local Insights cache — if
the dev environment's test chess.com account (`zlakin`, per this
project's setup) hasn't been scanned yet in this environment, run an
Insights scan first (via the app's own Insights tab) before running the
script below, or the queue will legitimately be empty and the
empty-state assertions won't exercise the real puzzle-solving path.

```bash
cat > /tmp/verify-puzzles.txt <<'EOF'
launch
click-text Puzzles
sleep 500
ss puzzles-tab-initial
eval document.querySelector('.puzzle-feedback')
click [data-square="e2"]
sleep 200
click [data-square="e4"]
sleep 1500
eval document.querySelector('.puzzle-feedback')?.textContent
ss puzzles-tab-after-attempt
click-text Next
sleep 500
ss puzzles-tab-after-next
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-puzzles.txt
```

Expected: the first `eval document.querySelector('.puzzle-feedback')`
prints `null` (no attempt made yet). If e2/e4 isn't a legal move in
whatever puzzle position happens to be due first (very likely, since the
puzzle's actual starting position is whatever the user's own historical
mistake was, not the game's opening), the click will just be rejected by
`handleMove`'s legality check — pick two squares that make sense for
the position actually shown in `ss puzzles-tab-initial` instead of
guessing blindly a second time, per this same technique already used and
documented in the variation-exploration plan. After a legal attempt,
`.puzzle-feedback` should show "Correct!" or "Not quite." plus a visible
"Next" button, and clicking it should either advance to a new puzzle
position or show the empty/caught-up state if that was the only due
card.

- [ ] **Step 7: Clean up and commit**

```bash
rm -f /tmp/verify-puzzles.txt
git add src/renderer/src/components/PuzzlesTab.tsx src/renderer/src/components/NavBar.tsx \
  src/renderer/src/App.tsx src/renderer/src/app.css
git commit -m "Add the Puzzles tab and wire it into the app"
```

## Testing

Tasks 1-3 have real unit tests for every pure/mockable unit (`sm2.ts`,
`srsStore.ts`, `puzzleQueue.ts`, `cpLossToQuality.ts`) — 15 new tests
total across those three files. `usePuzzleSession` itself and Task 4's
UI are verified via `run-desktop` against the actual built app, matching
this codebase's established, deliberate no-jsdom policy (the same
approach already used for `Board.tsx`'s drag/click input and the
exploration banner).

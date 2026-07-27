# Mastery Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Puzzles tab's flat, due-date-gated SM-2 queue with an 18-node skill tree (6 tactic types × 3 difficulty levels), gated by real mastery streaks, backfilled from an already-generated, already-verified slice of the Lichess open puzzle database so sparse nodes still have real content to practice.

**Architecture:** Three new main-process modules layer cleanly on top of existing SRS infrastructure without changing it: `masteryTree.ts` (pure logic — node keys, unlock cascade, active-level determination, streak progression), `masteryStore.ts` (persistence, mirrors `srsStore.ts` exactly), and `masteryQueue.ts` (builds a node's practice queue and the whole tree's overview, mirroring `puzzleQueue.ts`'s shape). The existing `sm2.ts`, `srsStore.ts`, `puzzleRating.ts`, `puzzleStatsStore.ts`, and `puzzleOutcome.ts` are all reused unchanged — SM-2 still schedules every card (mistake or backfill) by cardId, Puzzle Rating still tracks the same global motivational score, and the retry/hint/give-up claim-guard logic is untouched. The renderer's `PuzzlesTab.tsx` becomes a two-screen router (tree view ↔ practice session), with the existing session UI extracted into its own component and re-scoped to pull from a node's queue instead of a global one. The flat due-queue this replaces (`puzzleQueue.ts`, `getPuzzleQueue`) is removed, not kept alongside — it has no remaining caller once the tree ships.

## Global Constraints

- The backfill dataset (`src/main/srs/backfillPuzzles.json`, 4,500 puzzles, ~530KB) already exists, is already committed, and its every entry already verified as a legal move sequence — no task in this plan downloads, re-generates, or re-validates it. Treat it exactly like any other static asset already in the repo.
- Backfill puzzles are truncated to the solver's first move only (documented in the design spec) — never attempt to extend grading to a multi-move forced sequence.
- SM-2 (`sm2.ts`), Puzzle Rating (`puzzleRating.ts`/`puzzleStatsStore.ts`), and the retry/hint/give-up claim-guard logic (`puzzleOutcome.ts`) do not change in this plan — Mastery Tree is a layer on top of them, not a replacement.
- Due-dates never gate whether a node can be practiced — only which of its cards sort first within a session.
- Mastery is 5 consecutive `'clean'` outcomes per node; unlocking is strictly sequential within one tactic's 3 levels, with all 6 tactics' Level 1 unlocked from the start.
- The old flat queue (`src/main/srs/puzzleQueue.ts` + its test, the `getPuzzleQueue` IPC channel/handler/preload entry, the `PuzzleCard`/`PuzzleQueue` shared types) is deleted once nothing references it — verified via grep before this plan's tasks began; no other file depends on it.
- This repo's git workflow: commit straight to `main` (no branches/worktrees/PRs).

---

### Task 1: Shared types + mastery tree logic

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/srs/masteryTree.ts`
- Create: `src/main/srs/masteryTree.test.ts`

**Interfaces:**
- Consumes: `TacticType`, `TACTIC_TYPES`, `PuzzleOutcome` (`src/shared/types.ts`, unchanged).
- Produces: `MasteryLevel`, `MasteryNodeKey`, `MasteryNodeProgress`, `MasteryNodeState`, `MasteryTree`, `MasteryPuzzleCard` (all in `src/shared/types.ts` from this task on). `MASTERY_STREAK_TO_MASTER`, `masteryNodeKey(tactic, level)`, `parseMasteryNodeKey(key)`, `allMasteryNodeKeys()`, `defaultMasteryProgress()`, `nodeProgress(state, key)`, `MasteryState`, `isUnlocked(state, tactic, level)`, `currentActiveLevel(state, tactic)`, `nextMasteryProgress(current, outcome)` (all in `src/main/srs/masteryTree.ts`) — Task 2's store, Task 3's queue builder, and Task 4's IPC handlers all call these.

- [ ] **Step 1: Add the new types to `src/shared/types.ts`**

Add after the `PuzzleQueue` interface (which Task 4 will delete — these new types replace it in place):

```ts
export type MasteryLevel = 1 | 2 | 3

export type MasteryNodeKey = string // `${TacticType}:${MasteryLevel}`, e.g. "fork:2"

export interface MasteryNodeProgress {
  cleanStreak: number
  mastered: boolean
}

export interface MasteryNodeState {
  key: MasteryNodeKey
  tactic: TacticType
  level: MasteryLevel
  unlocked: boolean
  mastered: boolean
  cleanStreak: number
  dueCount: number
}

export type MasteryTree = MasteryNodeState[]

export interface MasteryPuzzleCard {
  cardId: string
  source: 'mistake' | 'backfill'
  fenBefore: string
  bestMoveUci: string
  tactic: TacticType
  userColor: 'w' | 'b'
  gameUrl: string | null
  opponentUsername: string | null
  endTime: number | null
  classification: 'mistake' | 'blunder'
}
```

- [ ] **Step 2: Write `src/main/srs/masteryTree.ts`**

```ts
import type {
  MasteryLevel,
  MasteryNodeKey,
  MasteryNodeProgress,
  PuzzleOutcome,
  TacticType
} from '../../shared/types'
import { TACTIC_TYPES } from '../../shared/types'

export const MASTERY_LEVELS: MasteryLevel[] = [1, 2, 3]
export const MASTERY_STREAK_TO_MASTER = 5

export type MasteryState = Record<MasteryNodeKey, MasteryNodeProgress>

export function masteryNodeKey(tactic: TacticType, level: MasteryLevel): MasteryNodeKey {
  return `${tactic}:${level}`
}

export function parseMasteryNodeKey(key: MasteryNodeKey): { tactic: TacticType; level: MasteryLevel } {
  const [tactic, levelStr] = key.split(':')
  return { tactic: tactic as TacticType, level: Number(levelStr) as MasteryLevel }
}

export function allMasteryNodeKeys(): MasteryNodeKey[] {
  const keys: MasteryNodeKey[] = []
  for (const tactic of TACTIC_TYPES) {
    for (const level of MASTERY_LEVELS) keys.push(masteryNodeKey(tactic, level))
  }
  return keys
}

export function defaultMasteryProgress(): MasteryNodeProgress {
  return { cleanStreak: 0, mastered: false }
}

export function nodeProgress(state: MasteryState, key: MasteryNodeKey): MasteryNodeProgress {
  return state[key] ?? defaultMasteryProgress()
}

export function isUnlocked(state: MasteryState, tactic: TacticType, level: MasteryLevel): boolean {
  if (level === 1) return true
  const priorLevel = (level - 1) as MasteryLevel
  return nodeProgress(state, masteryNodeKey(tactic, priorLevel)).mastered
}

// The lowest not-yet-mastered level for a tactic - where a *new* real
// mistake of that tactic gets assigned. Once all three levels are
// mastered, new mistakes keep flowing into level 3 (there's nowhere
// further to progress to).
export function currentActiveLevel(state: MasteryState, tactic: TacticType): MasteryLevel {
  for (const level of MASTERY_LEVELS) {
    if (!nodeProgress(state, masteryNodeKey(tactic, level)).mastered) return level
  }
  return 3
}

// A clean solve extends the streak (and masters the node once it reaches
// the threshold, permanently - mastered never reverts to false even if a
// later review on the same node isn't clean). Anything else (retried,
// hinted, gaveUp) resets the streak to 0 without touching mastered.
export function nextMasteryProgress(
  current: MasteryNodeProgress,
  outcome: PuzzleOutcome
): MasteryNodeProgress {
  if (outcome !== 'clean') {
    return { ...current, cleanStreak: 0 }
  }
  const cleanStreak = current.cleanStreak + 1
  return {
    cleanStreak,
    mastered: current.mastered || cleanStreak >= MASTERY_STREAK_TO_MASTER
  }
}
```

- [ ] **Step 3: Write `src/main/srs/masteryTree.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  allMasteryNodeKeys,
  currentActiveLevel,
  defaultMasteryProgress,
  isUnlocked,
  masteryNodeKey,
  nextMasteryProgress,
  parseMasteryNodeKey
} from './masteryTree'
import type { MasteryState } from './masteryTree'

describe('masteryNodeKey / parseMasteryNodeKey', () => {
  it('round-trips a tactic and level through a key', () => {
    expect(masteryNodeKey('fork', 2)).toBe('fork:2')
    expect(parseMasteryNodeKey('fork:2')).toEqual({ tactic: 'fork', level: 2 })
  })
})

describe('allMasteryNodeKeys', () => {
  it('produces exactly 18 unique keys, one per tactic x level', () => {
    const keys = allMasteryNodeKeys()
    expect(keys).toHaveLength(18)
    expect(new Set(keys).size).toBe(18)
    expect(keys).toContain('back_rank_mate:3')
    expect(keys).toContain('hung_piece:1')
  })
})

describe('isUnlocked', () => {
  it('level 1 is always unlocked regardless of state', () => {
    expect(isUnlocked({}, 'fork', 1)).toBe(true)
  })

  it('level 2 is locked until level 1 is mastered', () => {
    const state: MasteryState = {}
    expect(isUnlocked(state, 'fork', 2)).toBe(false)
  })

  it('level 2 unlocks once level 1 is mastered', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(isUnlocked(state, 'fork', 2)).toBe(true)
  })

  it('a different tactic mastering its level 1 does not unlock this one', () => {
    const state: MasteryState = { 'pin:1': { cleanStreak: 5, mastered: true } }
    expect(isUnlocked(state, 'fork', 2)).toBe(false)
  })
})

describe('currentActiveLevel', () => {
  it('is level 1 for a tactic with no progress yet', () => {
    expect(currentActiveLevel({}, 'fork')).toBe(1)
  })

  it('advances to level 2 once level 1 is mastered', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(currentActiveLevel(state, 'fork')).toBe(2)
  })

  it('stays at level 3 once every level is mastered', () => {
    const state: MasteryState = {
      'fork:1': { cleanStreak: 5, mastered: true },
      'fork:2': { cleanStreak: 5, mastered: true },
      'fork:3': { cleanStreak: 5, mastered: true }
    }
    expect(currentActiveLevel(state, 'fork')).toBe(3)
  })
})

describe('nextMasteryProgress', () => {
  it('extends the streak on a clean solve without mastering below the threshold', () => {
    const result = nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'clean')
    expect(result).toEqual({ cleanStreak: 4, mastered: false })
  })

  it('masters the node the moment the streak reaches the threshold', () => {
    const result = nextMasteryProgress({ cleanStreak: 4, mastered: false }, 'clean')
    expect(result).toEqual({ cleanStreak: 5, mastered: true })
  })

  it('resets the streak to 0 on a retried/hinted/gaveUp outcome', () => {
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'retried')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'hinted')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'gaveUp')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
  })

  it('never un-masters a node once mastered, even on a later non-clean outcome', () => {
    const result = nextMasteryProgress({ cleanStreak: 7, mastered: true }, 'retried')
    expect(result).toEqual({ cleanStreak: 0, mastered: true })
  })
})

describe('defaultMasteryProgress', () => {
  it('starts at a zero streak, unmastered', () => {
    expect(defaultMasteryProgress()).toEqual({ cleanStreak: 0, mastered: false })
  })
})
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/main/srs/masteryTree.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/srs/masteryTree.ts src/main/srs/masteryTree.test.ts
git commit -m "Add mastery tree data model and progression logic"
```

---

### Task 2: Mastery state persistence + backfill puzzle loader

**Files:**
- Create: `src/main/srs/masteryStore.ts`
- Create: `src/main/srs/masteryStore.test.ts`
- Create: `src/main/srs/backfillPuzzles.ts`
- Create: `src/main/srs/backfillPuzzles.test.ts`

**Interfaces:**
- Consumes: `MasteryState` (Task 1, `src/main/srs/masteryTree.ts`); `masteryNodeKey` (Task 1); `src/main/srs/backfillPuzzles.json` (already committed).
- Produces: `loadMasteryState(): MasteryState`, `saveMasteryState(state: MasteryState): void` (`src/main/srs/masteryStore.ts`); `BackfillPuzzle` interface, `getBackfillPuzzles(tactic: TacticType, level: MasteryLevel): BackfillPuzzle[]` (`src/main/srs/backfillPuzzles.ts`) — Task 3's queue builder calls all of these.

- [ ] **Step 1: Write `src/main/srs/masteryStore.ts`**

Mirrors `src/main/srs/srsStore.ts`'s exact pattern (same atomic tmp-file-then-rename write).

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { MasteryState } from './masteryTree'

function masteryStatePath(): string {
  return join(app.getPath('userData'), 'mastery-state.json')
}

export function loadMasteryState(): MasteryState {
  const path = masteryStatePath()
  if (!existsSync(path)) return {}

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as MasteryState
  } catch {
    return {}
  }
}

export function saveMasteryState(state: MasteryState): void {
  const path = masteryStatePath()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}
```

- [ ] **Step 2: Write `src/main/srs/masteryStore.test.ts`**

Mirrors `src/main/srs/srsStore.test.ts`'s exact pattern.

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

import { loadMasteryState, saveMasteryState } from './masteryStore'
import type { MasteryState } from './masteryTree'

function state(overrides: MasteryState = {}): MasteryState {
  return { 'fork:1': { cleanStreak: 3, mastered: false }, ...overrides }
}

describe('masteryStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-mastery-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns an empty object when nothing has been saved yet', () => {
    expect(loadMasteryState()).toEqual({})
  })

  it('round-trips saved state', () => {
    saveMasteryState(state())
    expect(loadMasteryState()).toEqual(state())
  })

  it('treats a corrupted store file as empty rather than throwing', () => {
    saveMasteryState(state())
    writeFileSync(join(userDataDir, 'mastery-state.json'), '{not valid json', 'utf-8')

    expect(loadMasteryState()).toEqual({})
  })

  it('overwrites the whole file on save (not a merge)', () => {
    saveMasteryState(state({ 'fork:1': { cleanStreak: 3, mastered: false } }))
    saveMasteryState(state({ 'pin:2': { cleanStreak: 1, mastered: false } }))

    expect(loadMasteryState()).toEqual(state({ 'pin:2': { cleanStreak: 1, mastered: false } }))
  })
})
```

- [ ] **Step 3: Write `src/main/srs/backfillPuzzles.ts`**

```ts
import backfillData from './backfillPuzzles.json'
import type { MasteryLevel, TacticType } from '../../shared/types'
import { masteryNodeKey } from './masteryTree'

export interface BackfillPuzzle {
  id: string
  fenBefore: string
  bestMoveUci: string
  rating: number
}

const DATA = backfillData as Record<string, BackfillPuzzle[]>

export function getBackfillPuzzles(tactic: TacticType, level: MasteryLevel): BackfillPuzzle[] {
  return DATA[masteryNodeKey(tactic, level)] ?? []
}
```

- [ ] **Step 4: Write `src/main/srs/backfillPuzzles.test.ts`**

Doubles as a regression check on the committed data asset itself.

```ts
import { describe, it, expect } from 'vitest'
import { getBackfillPuzzles } from './backfillPuzzles'
import { TACTIC_TYPES } from '../../shared/types'
import type { MasteryLevel } from '../../shared/types'

const LEVELS: MasteryLevel[] = [1, 2, 3]

describe('getBackfillPuzzles', () => {
  it('returns a non-empty, capped, well-formed puzzle list for every tactic and level', () => {
    for (const tactic of TACTIC_TYPES) {
      for (const level of LEVELS) {
        const puzzles = getBackfillPuzzles(tactic, level)
        expect(puzzles.length).toBeGreaterThan(0)
        expect(puzzles.length).toBeLessThanOrEqual(250)
        for (const puzzle of puzzles) {
          expect(typeof puzzle.id).toBe('string')
          expect(typeof puzzle.fenBefore).toBe('string')
          expect(typeof puzzle.bestMoveUci).toBe('string')
          expect(typeof puzzle.rating).toBe('number')
        }
      }
    }
  })

  it('returns an empty array rather than throwing for a key the dataset has no entry for', () => {
    // Every real (tactic, level) combination has data (proven above) - this
    // exercises the defensive fallback for a shape the loader itself would
    // never produce, not a real gap in the shipped dataset.
    expect(getBackfillPuzzles('fork', 99 as MasteryLevel)).toEqual([])
  })
})
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/main/srs/masteryStore.test.ts src/main/srs/backfillPuzzles.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. (Confirms `resolveJsonModule` — already enabled in `tsconfig.node.json` — lets `backfillPuzzles.ts` import the `.json` asset directly.)

- [ ] **Step 7: Commit**

```bash
git add src/main/srs/masteryStore.ts src/main/srs/masteryStore.test.ts src/main/srs/backfillPuzzles.ts src/main/srs/backfillPuzzles.test.ts
git commit -m "Add mastery state persistence and the backfill puzzle loader"
```

---

### Task 3: Node queue construction

**Files:**
- Create: `src/main/srs/masteryQueue.ts`
- Create: `src/main/srs/masteryQueue.test.ts`

**Interfaces:**
- Consumes: `MasteryState`, `MASTERY_LEVELS`, `allMasteryNodeKeys`, `parseMasteryNodeKey`, `currentActiveLevel`, `isUnlocked`, `nodeProgress` (Task 1); `getBackfillPuzzles` (Task 2); `newCardState` (existing `src/main/srs/sm2.ts`, unchanged).
- Produces: `buildNodeQueue(key, records, masteryState, srsState, now): MasteryPuzzleCard[]`, `buildMasteryTree(records, masteryState, srsState, now): MasteryTree` — Task 4's IPC handlers call both.

- [ ] **Step 1: Write `src/main/srs/masteryQueue.ts`**

```ts
import type {
  GameInsightRecord,
  MasteryNodeKey,
  MasteryPuzzleCard,
  MasteryTree,
  SrsCardState,
  TacticType
} from '../../shared/types'
import { TACTIC_TYPES } from '../../shared/types'
import { newCardState } from './sm2'
import {
  allMasteryNodeKeys,
  currentActiveLevel,
  isUnlocked,
  nodeProgress,
  parseMasteryNodeKey
} from './masteryTree'
import type { MasteryState } from './masteryTree'
import { getBackfillPuzzles } from './backfillPuzzles'

const MIN_NODE_QUEUE_SIZE = 15

function mistakeCardsFor(records: GameInsightRecord[], tactic: TacticType): MasteryPuzzleCard[] {
  const cards: MasteryPuzzleCard[] = []
  for (const record of records) {
    for (const mistake of record.mistakes) {
      const tags = new Set([...mistake.missedTactics, ...mistake.punishedByTactics])
      if (!tags.has(tactic)) continue
      cards.push({
        cardId: `${record.gameUrl}#${mistake.ply}`,
        source: 'mistake',
        fenBefore: mistake.fenBefore,
        bestMoveUci: mistake.bestMoveUci,
        tactic,
        userColor: record.userColor,
        gameUrl: record.gameUrl,
        opponentUsername: record.opponentUsername,
        endTime: record.endTime,
        classification: mistake.classification
      })
    }
  }
  return cards
}

function backfillCardsFor(tactic: TacticType, level: 1 | 2 | 3): MasteryPuzzleCard[] {
  return getBackfillPuzzles(tactic, level).map((puzzle) => ({
    cardId: `backfill:${puzzle.id}`,
    source: 'backfill',
    fenBefore: puzzle.fenBefore,
    bestMoveUci: puzzle.bestMoveUci,
    tactic,
    userColor: puzzle.fenBefore.split(' ')[1] === 'b' ? 'b' : 'w',
    gameUrl: null,
    opponentUsername: null,
    endTime: null,
    classification: 'mistake'
  }))
}

// A node's queue: the user's own real mistakes of that tactic, but only
// while this node is the current frontier for that tactic (a mastered,
// superseded node stops receiving new mistakes - see masteryTree.ts's
// currentActiveLevel), topped up with backfill puzzles until the pool
// reaches a reasonable minimum. Real mistakes are never displaced by
// backfill, only supplemented.
export function buildNodeQueue(
  key: MasteryNodeKey,
  records: GameInsightRecord[],
  masteryState: MasteryState,
  srsState: Record<string, SrsCardState>,
  now: number
): MasteryPuzzleCard[] {
  const { tactic, level } = parseMasteryNodeKey(key)

  const cards: MasteryPuzzleCard[] =
    level === currentActiveLevel(masteryState, tactic) ? mistakeCardsFor(records, tactic) : []

  if (cards.length < MIN_NODE_QUEUE_SIZE) {
    const needed = MIN_NODE_QUEUE_SIZE - cards.length
    cards.push(...backfillCardsFor(tactic, level).slice(0, needed))
  }

  // Cards already past their SM-2 due-date sort first within the session;
  // not-yet-due cards fill the rest - due-dates prioritize but never gate.
  return cards
    .map((card) => ({ card, state: srsState[card.cardId] ?? newCardState(card.cardId, now) }))
    .sort((a, b) => a.state.dueDate - b.state.dueDate)
    .map(({ card }) => card)
}

export function buildMasteryTree(
  records: GameInsightRecord[],
  masteryState: MasteryState,
  srsState: Record<string, SrsCardState>,
  now: number
): MasteryTree {
  return allMasteryNodeKeys().map((key) => {
    const { tactic, level } = parseMasteryNodeKey(key)
    const progress = nodeProgress(masteryState, key)
    const unlocked = isUnlocked(masteryState, tactic, level)
    const dueCount = unlocked
      ? buildNodeQueue(key, records, masteryState, srsState, now).filter((card) => {
          const cardState = srsState[card.cardId]
          return !cardState || cardState.dueDate <= now
        }).length
      : 0

    return {
      key,
      tactic,
      level,
      unlocked,
      mastered: progress.mastered,
      cleanStreak: progress.cleanStreak,
      dueCount
    }
  })
}
```

Note: `TACTIC_TYPES` is imported but unused directly in this file's logic (tactic iteration happens via `allMasteryNodeKeys()`) - remove that import if your editor/typecheck flags it as unused; it was listed here only because early drafts referenced it directly. Verify with typecheck in Step 3 rather than assuming.

- [ ] **Step 2: Write `src/main/srs/masteryQueue.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildMasteryTree, buildNodeQueue } from './masteryQueue'
import type { GameInsightRecord, MasteryState, SrsCardState, TacticType } from '../../shared/types'

function mistakeRecord(
  gameUrl: string,
  ply: number,
  tactic: TacticType,
  overrides: Partial<GameInsightRecord['mistakes'][number]> = {}
): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'loss',
    openingName: null,
    accuracy: 80,
    mistakes: [
      {
        ply,
        classification: 'blunder',
        phase: 'middlegame',
        cpLoss: 250,
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        playedMoveUci: 'e2e3',
        bestMoveUci: 'e2e4',
        missedTactics: [tactic],
        punishedByTactics: [],
        clockSecondsRemaining: null,
        isTimePressure: false,
        ...overrides
      }
    ]
  }
}

function srsState(cardId: string, dueDate: number): Record<string, SrsCardState> {
  return { [cardId]: { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate, lastReviewedAt: 0 } }
}

describe('buildNodeQueue', () => {
  it('includes the user\'s own mistakes of the matching tactic at the active level', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.some((c) => c.cardId === 'g1#10' && c.source === 'mistake')).toBe(true)
  })

  it('excludes mistakes tagged with a different tactic', () => {
    const records = [mistakeRecord('g1', 10, 'pin')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.some((c) => c.cardId === 'g1#10')).toBe(false)
  })

  it('tops up with backfill puzzles when real mistakes fall short of the minimum pool size', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.length).toBeGreaterThanOrEqual(15)
    expect(queue.some((c) => c.source === 'backfill')).toBe(true)
  })

  it('does not include backfill once real mistakes alone already meet the minimum', () => {
    const records = Array.from({ length: 20 }, (_, i) => mistakeRecord(`g${i}`, 10, 'fork'))
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.every((c) => c.source === 'mistake')).toBe(true)
    expect(queue.length).toBe(20)
  })

  it('stops feeding new mistakes into a mastered, superseded level, using only backfill there', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const masteryState: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }

    const queue = buildNodeQueue('fork:1', records, masteryState, {}, 5000)

    expect(queue.every((c) => c.source === 'backfill')).toBe(true)
  })

  it('sorts cards with a past due-date before not-yet-due cards', () => {
    const records = [mistakeRecord('g1', 10, 'fork'), mistakeRecord('g2', 20, 'fork')]
    const state = {
      ...srsState('g1#10', 9000), // not due
      ...srsState('g2#20', 1000) // due
    }

    const queue = buildNodeQueue('fork:1', records, {}, state, 5000)

    expect(queue[0].cardId).toBe('g2#20')
  })
})

describe('buildMasteryTree', () => {
  it('returns all 18 nodes', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    expect(tree).toHaveLength(18)
  })

  it('unlocks only level 1 of every tactic by default', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    for (const node of tree) {
      expect(node.unlocked).toBe(node.level === 1)
    }
  })

  it('unlocks level 2 of a tactic once level 1 is mastered, leaving other tactics untouched', () => {
    const masteryState: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    const tree = buildMasteryTree([], masteryState, {}, 5000)

    const fork2 = tree.find((n) => n.key === 'fork:2')
    const pin2 = tree.find((n) => n.key === 'pin:2')
    expect(fork2?.unlocked).toBe(true)
    expect(pin2?.unlocked).toBe(false)
  })

  it('reports dueCount as 0 for a locked node without building its queue', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    const fork2 = tree.find((n) => n.key === 'fork:2')
    expect(fork2?.dueCount).toBe(0)
  })

  it('reports a nonzero dueCount for an unlocked node backed only by never-attempted backfill (immediately due)', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    const fork1 = tree.find((n) => n.key === 'fork:1')
    expect(fork1?.dueCount).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/main/srs/masteryQueue.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If the unused `TACTIC_TYPES` import flagged in Step 1's note causes a build warning (this repo has no lint step, so it will not fail typecheck, but remove it for cleanliness if you notice it).

- [ ] **Step 5: Commit**

```bash
git add src/main/srs/masteryQueue.ts src/main/srs/masteryQueue.test.ts
git commit -m "Build per-node and whole-tree mastery queues"
```

---

### Task 4: IPC wiring — new channels, extended outcome submission, remove the old flat queue

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Delete: `src/main/srs/puzzleQueue.ts`
- Delete: `src/main/srs/puzzleQueue.test.ts`

**Interfaces:**
- Consumes: `buildNodeQueue`, `buildMasteryTree` (Task 3); `loadMasteryState`, `saveMasteryState` (Task 2); `nextMasteryProgress`, `nodeProgress` (Task 1); existing `loadAllGameRecords`, `ensureSchemaVersion` (`insightsStore.ts`), `loadSrsState` (`srsStore.ts`), `loadPuzzleStats`/`savePuzzleStats` (`puzzleStatsStore.ts`), `nextPuzzleStats`/`localDateString` (`puzzleRating.ts`) — all unchanged.
- Produces: `window.chessAPI.getMasteryTree(): Promise<MasteryTree>`, `window.chessAPI.getNodeQueue(key): Promise<MasteryPuzzleCard[]>`, `window.chessAPI.submitPuzzleOutcome(outcome, classification, nodeKey): Promise<{ stats: PuzzleStats; nodeProgress: MasteryNodeProgress }>` (signature/return type changed — the `nodeKey` parameter is now required) — Task 5's hook calls all three. `window.chessAPI.getPuzzleQueue` no longer exists.

- [ ] **Step 1: Update `ChessAPI` in `src/shared/types.ts`**

Remove the `getPuzzleQueue` line and the now-unused `PuzzleCard`/`PuzzleQueue` interfaces (search for `export interface PuzzleCard` and `export interface PuzzleQueue` near the end of the file and delete both blocks — Task 1 already added the mastery types directly after where `PuzzleQueue` was, so removing `PuzzleQueue` now just deletes the interface itself, not the surrounding mastery types).

Replace this line in `ChessAPI`:

```ts
  getPuzzleQueue(): Promise<PuzzleQueue>
```

with:

```ts
  getMasteryTree(): Promise<MasteryTree>
  getNodeQueue(key: MasteryNodeKey): Promise<MasteryPuzzleCard[]>
```

Replace the `submitPuzzleOutcome` signature:

```ts
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder'
  ): Promise<PuzzleStats>
```

with:

```ts
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey
  ): Promise<{ stats: PuzzleStats; nodeProgress: MasteryNodeProgress }>
```

- [ ] **Step 2: Update `src/shared/ipc.ts`**

Replace:

```ts
  getPuzzleQueue: 'puzzles:get-queue',
```

with:

```ts
  getMasteryTree: 'mastery:get-tree',
  getNodeQueue: 'mastery:get-node-queue',
```

- [ ] **Step 3: Update `src/main/ipc/handlers.ts`**

Replace the import of `buildPuzzleQueue`:

```ts
import { buildPuzzleQueue } from '../srs/puzzleQueue'
```

with:

```ts
import { buildMasteryTree, buildNodeQueue } from '../srs/masteryQueue'
import { loadMasteryState, saveMasteryState } from '../srs/masteryStore'
import { nodeProgress, nextMasteryProgress } from '../srs/masteryTree'
```

Add `MasteryNodeKey` to the existing type-only import:

```ts
import type { MasteryNodeKey, PuzzleOutcome, SrsQuality } from '../../shared/types'
```

Replace the `getPuzzleQueue` handler:

```ts
  ipcMain.handle(IPC_CHANNELS.getPuzzleQueue, async () => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const srsState = loadSrsState()
    return buildPuzzleQueue(records, srsState, Date.now())
  })
```

with two handlers:

```ts
  ipcMain.handle(IPC_CHANNELS.getMasteryTree, async () => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const masteryState = loadMasteryState()
    const srsState = loadSrsState()
    return buildMasteryTree(records, masteryState, srsState, Date.now())
  })

  ipcMain.handle(IPC_CHANNELS.getNodeQueue, async (_event, key: MasteryNodeKey) => {
    ensureSchemaVersion()
    const records = loadAllGameRecords()
    const masteryState = loadMasteryState()
    const srsState = loadSrsState()
    return buildNodeQueue(key, records, masteryState, srsState, Date.now())
  })
```

Replace the `submitPuzzleOutcome` handler:

```ts
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

with:

```ts
  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleOutcome,
    async (
      _event,
      outcome: PuzzleOutcome,
      classification: 'mistake' | 'blunder',
      nodeKey: MasteryNodeKey
    ) => {
      const stats = loadPuzzleStats()
      const updatedStats = nextPuzzleStats(stats, outcome, classification, Date.now())
      savePuzzleStats(updatedStats)

      const masteryState = loadMasteryState()
      const updatedProgress = nextMasteryProgress(nodeProgress(masteryState, nodeKey), outcome)
      saveMasteryState({ ...masteryState, [nodeKey]: updatedProgress })

      return { stats: updatedStats, nodeProgress: updatedProgress }
    }
  )
```

- [ ] **Step 4: Update `src/preload/index.ts`**

Add `MasteryNodeKey`, `MasteryNodeProgress`, `MasteryTree`, `MasteryPuzzleCard` to the type-only import block; remove `PuzzleStats` only if it becomes otherwise unused (it is still used by `getPuzzleStats`'s return type, so keep it).

Replace:

```ts
  getPuzzleQueue: () => ipcRenderer.invoke(IPC_CHANNELS.getPuzzleQueue),
```

with:

```ts
  getMasteryTree: () => ipcRenderer.invoke(IPC_CHANNELS.getMasteryTree),
  getNodeQueue: (key: MasteryNodeKey) => ipcRenderer.invoke(IPC_CHANNELS.getNodeQueue, key),
```

Replace:

```ts
  submitPuzzleOutcome: (outcome: PuzzleOutcome, classification: 'mistake' | 'blunder') =>
    ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleOutcome, outcome, classification)
```

with:

```ts
  submitPuzzleOutcome: (
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey
  ) => ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleOutcome, outcome, classification, nodeKey)
```

- [ ] **Step 5: Delete the old flat queue**

```bash
rm src/main/srs/puzzleQueue.ts src/main/srs/puzzleQueue.test.ts
```

- [ ] **Step 6: Typecheck and run the full suite**

```bash
npm run verify
```

Expected: typecheck clean (this will surface any remaining reference to `getPuzzleQueue`/`PuzzleCard`/`PuzzleQueue`/`buildPuzzleQueue` outside this task's files — none are expected, per the Global Constraints grep already done, but this is the actual verification). Test count drops by the 5 tests `puzzleQueue.test.ts` carried (its removal), otherwise unchanged from Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/main/ipc/handlers.ts src/preload/index.ts
git add src/main/srs/puzzleQueue.ts src/main/srs/puzzleQueue.test.ts
git commit -m "Wire mastery tree IPC channels, extend outcome submission, remove the flat queue"
```

---

### Task 5: `usePuzzleSession` — node-scoped rewrite

**Files:**
- Modify: `src/renderer/src/hooks/usePuzzleSession.ts`

**Interfaces:**
- Consumes: `window.chessAPI.getNodeQueue`, `getPuzzleStats`, `submitPuzzleReview`, `submitPuzzleOutcome` (Task 4); `resolveSolvedOutcome`, `cappedQuality`, `newCardProgress`, `claimReview`, `claimOutcome`, `CardProgress` (existing `src/renderer/src/lib/puzzleOutcome.ts`, unchanged); `gradeAttempt`, `tryMove` (existing, unchanged).
- Produces: the hook now takes a required `nodeKey: MasteryNodeKey` argument and returns `{ queue, currentCard, sessionTotal, stats, nodeProgress, hintUsed, attempt, requestHint, giveUp, next, isLoading }` (`nextDueAt` is removed — no longer meaningful once due-dates don't gate a node's availability). `PuzzleAttemptResult` is unchanged. Task 6's `PuzzleSessionView` consumes this shape.

- [ ] **Step 1: Replace `src/renderer/src/hooks/usePuzzleSession.ts` in full**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MasteryNodeKey, MasteryNodeProgress, MasteryPuzzleCard, PuzzleOutcome, PuzzleStats } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'
import { gradeAttempt } from '../lib/gradeAttempt'
import type { CardProgress } from '../lib/puzzleOutcome'
import {
  resolveSolvedOutcome,
  cappedQuality,
  newCardProgress,
  claimReview,
  claimOutcome
} from '../lib/puzzleOutcome'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

/**
 * Get-or-create the CardProgress for `cardId`, writing it back to the ref.
 * Scoped to one card and mutated in place across retries (a ref, not state)
 * so the one-write-per-card claims - and whether an earlier attempt on this
 * card was wrong - survive multiple attempt()/giveUp() calls without forcing
 * a re-render for bookkeeping nobody renders directly. The cardId check
 * backstops the reset effect: progress from another card is never reused.
 */
function progressFor(ref: { current: CardProgress | null }, cardId: string): CardProgress {
  const existing = ref.current
  if (existing !== null && existing.cardId === cardId) return existing
  const fresh = newCardProgress(cardId)
  ref.current = fresh
  return fresh
}

export function usePuzzleSession(nodeKey: MasteryNodeKey): {
  queue: MasteryPuzzleCard[]
  currentCard: MasteryPuzzleCard | null
  sessionTotal: number
  stats: PuzzleStats | null
  nodeProgress: MasteryNodeProgress | null
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<MasteryPuzzleCard[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<PuzzleStats | null>(null)
  const [nodeProgressState, setNodeProgressState] = useState<MasteryNodeProgress | null>(null)
  const [hintUsed, setHintUsed] = useState(false)
  const cardProgressRef = useRef<CardProgress | null>(null)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const due = await window.chessAPI.getNodeQueue(nodeKey)
    setQueue(due)
    setSessionTotal(due.length)
    setIsLoading(false)
  }, [nodeKey])

  // A fresh node selection is a fresh session: reload its queue and drop
  // whatever the previous node's hint/progress state was.
  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    window.chessAPI
      .getPuzzleStats()
      .then(setStats)
      .catch((err) => {
        // Stats are a motivational extra - failing to read them just leaves
        // the stats bar hidden, same as before the first solve ever.
        console.error('Failed to load puzzle stats', err)
      })
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
        const updated = await window.chessAPI.submitPuzzleOutcome(outcome, classification, nodeKey)
        setStats(updated.stats)
        setNodeProgressState(updated.nodeProgress)
      } catch (err) {
        // Mirrors this hook's existing precedent for submitPuzzleReview below:
        // the puzzle-rating stats and mastery progress are a motivational
        // extra, not load-bearing - a failed write there shouldn't block
        // showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    [nodeKey]
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

      const progress = progressFor(cardProgressRef, currentCard.cardId)

      if (claimReview(progress)) {
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
        // Guarded the same way as the review above (read-check-set before
        // the await) so a solved card can't fire the gamification outcome
        // write twice - e.g. if giveUp() already claimed this card, or
        // attempt() itself were somehow reachable again after resolving.
        if (claimOutcome(progress)) {
          void submitOutcome(resolveSolvedOutcome(progress.hadWrongAttempt, hintUsed), currentCard.classification)
        }
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

    // Shares one CardProgress per card with attempt(), so the two can't
    // each keep their own view of what has already been written.
    const progress = progressFor(cardProgressRef, currentCard.cardId)

    // Giving up has to record an SRS review too, not just the gamification
    // outcome: without one, no SRS entry ever exists for this card, so
    // buildNodeQueue keeps synthesizing a fresh due-now state for it and
    // the same given-up card loops back forever. Quality 0 is SM-2's
    // "couldn't recall it", which puts the card a day out. The claim guard
    // preserves first-resolution-wins - a wrong attempt before the give-up
    // already submitted its own (capped) review, and that one stands.
    if (claimReview(progress)) {
      void window.chessAPI.submitPuzzleReview(currentCard.cardId, 0).catch((err) => {
        // Same precedent as attempt(): the reveal is still worth showing
        // even if persisting the new schedule failed.
        console.error('Failed to persist puzzle review', err)
      })
    }

    if (claimOutcome(progress)) {
      void submitOutcome('gaveUp', currentCard.classification)
    }
  }, [currentCard, hintUsed, submitOutcome])

  const next = useCallback(() => {
    setQueue((q) => {
      const rest = q.slice(1)
      // Only go back to the server once the local queue is actually
      // drained - a just-reviewed card's new dueDate is always at least
      // 1 day out (SM-2's minimum interval), so it can never legitimately
      // reappear as due within this same session. Refetching on every
      // card instead would mean re-reading and re-parsing every cached
      // game record on disk for every single puzzle. Because backfill
      // guarantees an unlocked node always has content, this refetch will
      // almost always find more cards to continue with rather than
      // reaching an empty state.
      if (rest.length === 0) void loadQueue()
      return rest
    })
  }, [loadQueue])

  return {
    queue,
    currentCard,
    sessionTotal,
    stats,
    nodeProgress: nodeProgressState,
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

Expected: errors in `src/renderer/src/components/PuzzlesTab.tsx` (it still calls the old hook shape — `usePuzzleSession()` with no argument, and reads `nextDueAt`, which no longer exists). This is expected and resolved by Task 6, which rewrites that file next; do not modify `PuzzlesTab.tsx` in this task.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/usePuzzleSession.ts
git commit -m "Re-scope usePuzzleSession to a single mastery node"
```

Note: this commit leaves the build typecheck-broken until Task 6 lands (`PuzzlesTab.tsx` still calls the old shape) - this mirrors how earlier plans in this repo sequenced a hook rewrite before its consuming component, and is resolved within the same overall plan, not left broken across a merge boundary.

---

### Task 6: Tree view, session view, router, CSS, and verification

**Files:**
- Create: `src/renderer/src/components/MasteryTreeView.tsx`
- Create: `src/renderer/src/components/PuzzleSessionView.tsx`
- Modify: `src/renderer/src/components/PuzzlesTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `usePuzzleSession(nodeKey)` (Task 5); `window.chessAPI.getMasteryTree()` (Task 4); `Board`, `tryMove`, `TACTIC_LABELS` (existing, unchanged); `TACTIC_TYPES`, `MasteryTree`, `MasteryNodeKey` (`src/shared/types.ts`).
- Produces: nothing further consumes this — it's the top of the stack.

- [ ] **Step 1: Write `src/renderer/src/lib/tacticLabels.ts` addition check**

No change needed here — `TACTIC_LABELS` already exists and is reused as-is by `MasteryTreeView.tsx` below. This step is a no-op reminder, not a real edit; skip to Step 2.

- [ ] **Step 2: Write `src/renderer/src/components/MasteryTreeView.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { MasteryNodeKey, MasteryTree } from '../../../shared/types'
import { TACTIC_TYPES } from '../../../shared/types'
import { TACTIC_LABELS } from '../lib/tacticLabels'

interface MasteryTreeViewProps {
  onSelectNode: (key: MasteryNodeKey) => void
}

export function MasteryTreeView({ onSelectNode }: MasteryTreeViewProps): JSX.Element {
  const [tree, setTree] = useState<MasteryTree | null>(null)

  useEffect(() => {
    window.chessAPI.getMasteryTree().then(setTree)
  }, [])

  if (!tree) return <div className="puzzles-tab" />

  return (
    <div className="puzzles-tab">
      <div className="mastery-tree">
        {TACTIC_TYPES.map((tactic) => {
          const nodes = tree.filter((node) => node.tactic === tactic).sort((a, b) => a.level - b.level)
          return (
            <div key={tactic} className="mastery-tactic-column">
              <h3 className="mastery-tactic-heading">{TACTIC_LABELS[tactic]}</h3>
              {nodes.map((node) => (
                <button
                  key={node.key}
                  className={`mastery-node${node.mastered ? ' mastered' : ''}${!node.unlocked ? ' locked' : ''}`}
                  disabled={!node.unlocked}
                  onClick={() => onSelectNode(node.key)}
                >
                  <span className="mastery-node-level">Level {node.level}</span>
                  <span className="mastery-node-status">
                    {node.mastered
                      ? 'Mastered'
                      : node.unlocked
                        ? `${node.cleanStreak}/5${node.dueCount > 0 ? ` · ${node.dueCount} due` : ''}`
                        : 'Locked'}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/components/PuzzleSessionView.tsx`**

This is the existing `PuzzlesTab.tsx` session-rendering body, re-scoped to a `nodeKey` prop with an `onBack` affordance, the now-redundant tactic-chip row removed (the tree screen you just came from already told you which tactic you're practicing), and the "vs opponent" line made conditional on the card actually coming from a real game.

```tsx
import { useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { Board } from './Board'
import type { MasteryNodeKey } from '../../../shared/types'

interface TaggedAttempt {
  cardId: string
  fen: string
}

interface TaggedResult {
  cardId: string
  result: PuzzleAttemptResult | { error: string }
}

interface PuzzleSessionViewProps {
  nodeKey: MasteryNodeKey
  onBack: () => void
}

export function PuzzleSessionView({ nodeKey, onBack }: PuzzleSessionViewProps): JSX.Element {
  const {
    queue,
    currentCard,
    sessionTotal,
    stats,
    nodeProgress,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  } = usePuzzleSession(nodeKey)
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

  const backButton = (
    <button className="button-secondary puzzle-session-back" onClick={onBack}>
      ← Back to tree
    </button>
  )

  if (isLoading) {
    return (
      <div className="puzzles-tab">
        {backButton}
      </div>
    )
  }

  if (!currentCard) {
    return (
      <div className="puzzles-tab">
        {backButton}
        <p className="puzzle-empty-message">No puzzles available for this node right now.</p>
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
    // Already resolved, waiting on Retry, or still awaiting the engine on a
    // previous move - a second concurrent attempt() would race the first.
    if (result !== null || gaveUp || isGrading) return false

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
    // Mirrors the button's own disabled condition, so taggedGaveUp can't
    // flip on a click the hook itself would have no-opped. (giveUp() also
    // no-ops when !hintUsed, which the button already gates.)
    if (!currentCard || isGrading) return
    giveUp()
    setTaggedGaveUp(currentCard.cardId)
    // The reveal is the whole story now - clear any wrong-attempt feedback
    // so two contradictory panels can't render at once.
    setTaggedResult(null)
    setTaggedAttempt(null)
  }

  return (
    <div className="puzzles-tab">
      {backButton}
      {stats && (
        <div className="puzzle-stats-bar">
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.rating}</span>
            <span className="puzzle-stat-label">Rating</span>
          </div>
          <div className="puzzle-stat-tile" title={`Best: ${stats.longestStreak}`}>
            <span className="puzzle-stat-value">{stats.currentStreak}</span>
            <span className="puzzle-stat-label">Solve streak</span>
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
      {nodeProgress && (
        <p className="puzzle-status-panel">
          {nodeProgress.mastered ? 'Node mastered!' : `Mastery streak: ${nodeProgress.cleanStreak}/5`}
        </p>
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
              {/* An error is an illegal move or an engine failure, not a real
                  attempt - nothing was graded and no review or outcome was
                  recorded - so skipping past it doesn't undermine the rule
                  that giving up requires a hint first. Without Next, a
                  persistently failing engine leaves the card unskippable. */}
              <button className="button-primary" onClick={next}>
                Next
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
          <p className="puzzle-status-panel">
            {currentCard.gameUrl !== null && currentCard.opponentUsername !== null && currentCard.endTime !== null
              ? `vs ${currentCard.opponentUsername} · ${new Date(currentCard.endTime * 1000).toLocaleDateString()}`
              : 'From the practice library'}
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Replace `src/renderer/src/components/PuzzlesTab.tsx` in full**

```tsx
import { useState } from 'react'
import type { MasteryNodeKey } from '../../../shared/types'
import { MasteryTreeView } from './MasteryTreeView'
import { PuzzleSessionView } from './PuzzleSessionView'

export function PuzzlesTab(): JSX.Element {
  const [selectedNode, setSelectedNode] = useState<MasteryNodeKey | null>(null)

  if (selectedNode === null) {
    return <MasteryTreeView onSelectNode={setSelectedNode} />
  }

  return <PuzzleSessionView nodeKey={selectedNode} onBack={() => setSelectedNode(null)} />
}
```

- [ ] **Step 5: Update `src/renderer/src/app.css`**

Remove the now-unused `tacticTags`-related tag-row rendering has no CSS of its own to remove (it reused the existing `.tactic-chip-row`/`.tactic-chip` classes, which stay — they're still used by the Insights tab). Add, directly after the existing `.puzzle-hint-controls` rule:

```css
.puzzle-session-back {
  margin-bottom: 0.75rem;
}

.mastery-tree {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.mastery-tactic-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 140px;
}

.mastery-tactic-heading {
  font-family: var(--font-display);
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.mastery-node {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.6rem 0.8rem;
  text-align: left;
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
}

.mastery-node:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.mastery-node.mastered {
  border-color: var(--mq-best);
  color: var(--mq-best);
}

.mastery-node-level {
  font-weight: 600;
  font-size: 0.85rem;
}

.mastery-node-status {
  font-size: 0.78rem;
  color: var(--text-muted);
}
```

- [ ] **Step 6: Typecheck, run the full suite, build**

```bash
npm run verify
```

Expected: typecheck clean (this is where Task 5's deliberately-left-broken build gets fixed), all tests pass — same total as Task 4 left it, since this task adds no new test files (this repo's no-jsdom policy for components).

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 7: Verify via `run-desktop`**

This requires at least one game with a detected mistake in the local Insights cache (test account `zlakin` already has one scanned in this dev environment) — but note that even a fresh account with zero mistakes should still show a fully populated, practiceable tree, since backfill alone guarantees every Level-1 node has content.

```bash
cat > /tmp/verify-mastery-tree.txt <<'EOF'
launch
click-text Puzzles
sleep 500
ss mastery-tree-initial
eval document.querySelectorAll('.mastery-node').length
eval document.querySelectorAll('.mastery-node:not(:disabled)').length
eval document.querySelector('.mastery-node')?.textContent
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-mastery-tree.txt
```

Expected: 18 total `.mastery-node` buttons; exactly 6 enabled (one per tactic's Level 1 — every Level 2/3 should be `disabled` on a fresh account with no mastered nodes yet).

Then drive into a session and back out, reading the real position from the screenshot before picking squares (this codebase's established technique — never guess blindly):

```bash
cat > /tmp/verify-mastery-session.txt <<'EOF'
launch
click-text Puzzles
sleep 500
click-text Level 1
sleep 500
ss mastery-session-initial
eval document.querySelector('.puzzle-status-panel')?.textContent
click-text Back to tree
sleep 300
ss mastery-tree-after-back
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-mastery-session.txt
```

`click-text Level 1` will click whichever tactic's Level 1 button appears first in the DOM — check `mastery-session-initial` to confirm a practice session actually loaded (board, stats bar, hint/give-up controls, a "Mastery streak: 0/5" line) rather than the empty-state fallback. Confirm "Back to tree" returns cleanly to the tree view (`mastery-tree-after-back` should look like the initial tree screenshot again). If you want to verify mastery unlocking end-to-end, solve 5 puzzles cleanly in a row on one node (playing the exact move shown by the reveal arrow after using the hint doesn't count as clean — you'd need to actually find the move yourself, or use `eval` to read `currentCard`'s best move from React devtools state if driving 5 genuine clean solves through the UI proves impractical in this environment) and confirm that node's status flips to "Mastered" and the next level's button becomes enabled; if a full 5-solve walkthrough isn't practical here, it's acceptable to trace this path through the code instead and note that explicitly, since Task 1-3's unit tests already cover the unlock/streak logic directly.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f /tmp/verify-mastery-tree.txt /tmp/verify-mastery-session.txt
git add src/renderer/src/components/MasteryTreeView.tsx src/renderer/src/components/PuzzleSessionView.tsx \
  src/renderer/src/components/PuzzlesTab.tsx src/renderer/src/app.css
git commit -m "Add the mastery tree view and re-scope the Puzzles tab around it"
```

## Testing

Tasks 1-3 have real unit tests for every pure/mockable unit — node-key parsing, unlock cascade, active-level determination, streak progression, mastery-state persistence, the committed backfill dataset's structural integrity (all 4,500 entries, every tactic/level bucket), and node/tree queue construction (mistake inclusion, backfill top-up, mastered-node supersession, due-first sorting) — roughly 30 new tests total. Tasks 4-6's IPC wiring and UI are verified via `npm run verify`/`run-desktop` against the real built app, matching this codebase's established no-jsdom policy for components and its convention of not unit-testing `handlers.ts` directly.

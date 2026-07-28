# Insights Coaching Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Insights' "Recent mistakes" rows clickable into an interactive mini-puzzle at that exact position — reusing the existing puzzle grading/SRS/rating machinery — instead of dead-ending as plain text.

**Architecture:** A new IPC handler (`getMistakeDetail`) resolves a mistake's full position data from the already-cached `GameInsightRecord[]` (no new scanning, no chess.com re-fetch) and, via a new pure function `resolveMistakeCredit`, which mastery node (if any) the attempt should credit. A new hook (`useMistakeAttempt`) and modal component (`MistakeCoachModal`) mirror the existing `usePuzzleSession`/`PuzzleSessionView` attempt/hint/give-up flow for a single ad-hoc card instead of a queue, submitting through the *same* `submitPuzzleReview`/`submitPuzzleOutcome` endpoints real puzzle sessions use — this is provably the same card (`cardId = gameUrl#ply`, matching `mistakeCardsFor`'s existing convention), not a parallel system.

**Tech Stack:** React 18, TypeScript, Electron IPC, Vitest.

## Global Constraints

- No new scanning, no chess.com re-fetch, no engine re-analysis of a whole game — this reuses data the existing scan pipeline already cached in `GameInsightRecord[]` on disk.
- This repo's git workflow: commit straight to `main` (no branches/worktrees/PRs).
- `submitPuzzleOutcome`'s `nodeKey` parameter widens from `MasteryNodeKey` to `MasteryNodeKey | null` — additive only. The existing call site (`usePuzzleSession.ts`) always passes a concrete non-null value today and is not otherwise touched.
- A mistake tagged with more than one tactic only credits the first tag (`missedTactics` before `punishedByTactics`, matching `RecentMistakesList`'s existing display-order dedup) — Puzzle Rating still updates regardless of tag count.
- Neither `src/main/ipc/handlers.ts` nor React hooks with local state (`usePuzzleSession.ts` is the precedent) have dedicated unit tests anywhere in this codebase today — they're thin wiring around already-tested pure functions, verified live via the `run-desktop` skill instead. `useMistakeAttempt` and the new/modified IPC handlers follow this same convention: the one genuinely new piece of *logic* (`resolveMistakeCredit`) gets a real unit test; the wiring around it is verified live.
- Component-level tests stay out of scope per this repo's established no-jsdom-for-components policy — verify `MistakeCoachModal` via `run-desktop`.

---

### Task 1: Shared types and the `resolveMistakeCredit` pure function

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/srs/masteryTree.ts`
- Modify: `src/main/srs/masteryTree.test.ts`

**Interfaces:**
- Consumes: `MasteryState`, `masteryNodeKey`, `currentActiveLevel` (all already in `masteryTree.ts`, unchanged).
- Produces: `MistakeDetail` (new shared type); `resolveMistakeCredit(state: MasteryState, missedTactics: TacticType[], punishedByTactics: TacticType[]): MasteryNodeKey | null`, consumed by Task 2's handler. `ChessAPI.submitPuzzleOutcome`'s widened signature and `ChessAPI.getMistakeDetail`, consumed by Task 2 (preload) and Task 3 (renderer hook).

- [ ] **Step 1: Write the failing test**

Add to `src/main/srs/masteryTree.test.ts`, as a new `describe` block (after the existing `describe('defaultMasteryProgress', ...)` block, at the end of the file):

```ts
describe('resolveMistakeCredit', () => {
  it('returns null when no tactic was detected', () => {
    expect(resolveMistakeCredit({}, [], [])).toBeNull()
  })

  it('credits the first missed tactic at its current active level', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(resolveMistakeCredit(state, ['fork'], [])).toBe('fork:2')
  })

  it('falls back to punishedByTactics when missedTactics is empty', () => {
    expect(resolveMistakeCredit({}, [], ['pin'])).toBe('pin:1')
  })

  it('prefers missedTactics over punishedByTactics when both are present', () => {
    expect(resolveMistakeCredit({}, ['fork'], ['pin'])).toBe('fork:1')
  })
})
```

Add `resolveMistakeCredit` to the existing import from `./masteryTree` at the top of the test file (it currently imports `allMasteryNodeKeys, currentActiveLevel, defaultMasteryProgress, isUnlocked, masteryNodeKey, nextMasteryProgress, parseMasteryNodeKey` — add `resolveMistakeCredit` to that list).

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run src/main/srs/masteryTree.test.ts
```

Expected: FAIL — `resolveMistakeCredit` doesn't exist yet (`does not provide an export named 'resolveMistakeCredit'`).

- [ ] **Step 3: Implement `resolveMistakeCredit` in `src/main/srs/masteryTree.ts`**

Add `TacticType` to the existing top-of-file import (it currently imports `MasteryLevel, MasteryNodeKey, MasteryNodeProgress, PuzzleOutcome, TacticType` from `'../../shared/types'` already — `TacticType` is already imported, no change needed there).

Add this function at the end of the file, after `nextMasteryProgress`:

```ts
// Which mastery node (if any) a real mistake's attempt should credit - the
// first tag (missedTactics before punishedByTactics, matching the same
// priority order RecentMistakesList already displays them in) at that
// tactic's current active level. Untagged ("Positional") mistakes have no
// natural node to credit and resolve to null - Puzzle Rating still updates
// for these, just not any specific node's streak.
export function resolveMistakeCredit(
  state: MasteryState,
  missedTactics: TacticType[],
  punishedByTactics: TacticType[]
): MasteryNodeKey | null {
  const tag = [...missedTactics, ...punishedByTactics][0]
  if (!tag) return null
  return masteryNodeKey(tag, currentActiveLevel(state, tag))
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run src/main/srs/masteryTree.test.ts
```

Expected: PASS, all tests in the file (existing + 4 new).

- [ ] **Step 5: Add `MistakeDetail` and widen `submitPuzzleOutcome`/add `getMistakeDetail` in `src/shared/types.ts`**

Add this interface directly after `MistakeSummary` (currently at line 190-199):

```ts
export interface MistakeDetail {
  fenBefore: string
  playedMoveUci: string
  bestMoveUci: string
  classification: 'mistake' | 'blunder'
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  userColor: 'w' | 'b'
  cardId: string
  nodeKey: MasteryNodeKey | null
}
```

In the `ChessAPI` interface, replace:

```ts
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey
  ): Promise<{ stats: PuzzleStats; nodeProgress: MasteryNodeProgress }>
}
```

with:

```ts
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey | null
  ): Promise<{ stats: PuzzleStats; nodeProgress: MasteryNodeProgress | null }>
  getMistakeDetail(gameUrl: string, ply: number): Promise<MistakeDetail | null>
}
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
```

Expected: errors in `src/main/ipc/handlers.ts` and `src/preload/index.ts` (both still implement the old `submitPuzzleOutcome` signature and neither implements `getMistakeDetail` yet — Task 2 fixes both). No errors anywhere else.

```bash
npx vitest run
```

Expected: all tests pass (existing suite + the 4 new `resolveMistakeCredit` cases).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/srs/masteryTree.ts src/main/srs/masteryTree.test.ts
git commit -m "Add MistakeDetail type and resolveMistakeCredit"
```

Note: this commit leaves `npm run typecheck` failing in `handlers.ts`/`preload/index.ts` until Task 2 lands next — the same one-task lag pattern used elsewhere in this repo's plans (a shared-type change before its consumers catch up).

---

### Task 2: IPC wiring — `getMistakeDetail` handler and nullable `nodeKey`

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `resolveMistakeCredit`, `MasteryState` (Task 1); `loadAllGameRecords` (`insightsStore.ts`, unchanged); `loadMasteryState`/`saveMasteryState` (`masteryStore.ts`, unchanged); `MistakeDetail` (Task 1).
- Produces: working `getMistakeDetail` and nullable-`nodeKey` `submitPuzzleOutcome` end-to-end (main handler → preload → `window.chessAPI`), consumed by Task 3's hook.

- [ ] **Step 1: Add the channel constant**

In `src/shared/ipc.ts`, add a new entry after `submitPuzzleOutcome`:

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  fetchChessComStats: 'chess:fetch-chesscom-stats',
  getSettings: 'settings:get',
  setTheme: 'settings:set-theme',
  evaluatePosition: 'engine:evaluate-position',
  startAccountLink: 'account:start-link',
  verifyAccountLink: 'account:verify-link',
  disconnectAccount: 'account:disconnect',
  openChessComProfileSettings: 'app:open-chesscom-profile-settings',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report',
  getMistakeDetail: 'insights:get-mistake-detail',
  getMasteryTree: 'mastery:get-tree',
  getNodeQueue: 'mastery:get-node-queue',
  submitPuzzleReview: 'puzzles:submit-review',
  getPuzzleStats: 'puzzles:get-stats',
  submitPuzzleOutcome: 'puzzles:submit-outcome'
} as const
```

- [ ] **Step 2: Add the handler and modify `submitPuzzleOutcome`'s handler**

In `src/main/ipc/handlers.ts`, add `resolveMistakeCredit` to the existing `masteryTree` import (currently `import { nodeProgress, nextMasteryProgress } from '../srs/masteryTree'` — change to `import { nodeProgress, nextMasteryProgress, resolveMistakeCredit } from '../srs/masteryTree'`). Add `MistakeDetail` to the existing type-only import from `'../../shared/types'` (currently `import type { MasteryNodeKey, PuzzleOutcome, SrsQuality } from '../../shared/types'` — change to `import type { MasteryNodeKey, MistakeDetail, PuzzleOutcome, SrsQuality } from '../../shared/types'`).

Add this handler directly after the `getInsightsReport` handler (before `getMasteryTree`):

```ts
  ipcMain.handle(
    IPC_CHANNELS.getMistakeDetail,
    async (_event, gameUrl: string, ply: number): Promise<MistakeDetail | null> => {
      ensureSchemaVersion()
      const records = loadAllGameRecords()
      const record = records.find((r) => r.gameUrl === gameUrl)
      const mistake = record?.mistakes.find((m) => m.ply === ply)
      if (!record || !mistake) return null

      const masteryState = loadMasteryState()
      return {
        fenBefore: mistake.fenBefore,
        playedMoveUci: mistake.playedMoveUci,
        bestMoveUci: mistake.bestMoveUci,
        classification: mistake.classification,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics,
        userColor: record.userColor,
        cardId: `${gameUrl}#${ply}`,
        nodeKey: resolveMistakeCredit(masteryState, mistake.missedTactics, mistake.punishedByTactics)
      }
    }
  )
```

Replace the existing `submitPuzzleOutcome` handler:

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

with:

```ts
  ipcMain.handle(
    IPC_CHANNELS.submitPuzzleOutcome,
    async (
      _event,
      outcome: PuzzleOutcome,
      classification: 'mistake' | 'blunder',
      nodeKey: MasteryNodeKey | null
    ) => {
      const stats = loadPuzzleStats()
      const updatedStats = nextPuzzleStats(stats, outcome, classification, Date.now())
      savePuzzleStats(updatedStats)

      if (nodeKey === null) {
        return { stats: updatedStats, nodeProgress: null }
      }

      const masteryState = loadMasteryState()
      const updatedProgress = nextMasteryProgress(nodeProgress(masteryState, nodeKey), outcome)
      saveMasteryState({ ...masteryState, [nodeKey]: updatedProgress })

      return { stats: updatedStats, nodeProgress: updatedProgress }
    }
  )
```

- [ ] **Step 3: Wire the preload bridge**

In `src/preload/index.ts`, add `MistakeDetail` to the type-only import from `'../shared/types'` (currently ends with `MasteryTree, MasteryPuzzleCard` — add `MistakeDetail` to that list).

Replace:

```ts
  submitPuzzleOutcome: (
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey
  ) => ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleOutcome, outcome, classification, nodeKey)
}
```

with:

```ts
  submitPuzzleOutcome: (
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey | null
  ) => ipcRenderer.invoke(IPC_CHANNELS.submitPuzzleOutcome, outcome, classification, nodeKey),
  getMistakeDetail: (gameUrl: string, ply: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMistakeDetail, gameUrl, ply)
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: all clean — this closes the typecheck gap Task 1 deliberately left open.

- [ ] **Step 5: Verify visually via `run-desktop`**

The dev environment's linked test account (`zlakin`) already has scanned Insights data. Query the new handler directly (bypassing UI, since nothing renders it yet) and confirm both the tagged and untagged cases resolve correctly:

```bash
cat > /tmp/verify-mistake-detail.txt <<'EOF'
launch
click-text Insights
sleep 1000
eval (async () => { const report = await window.chessAPI.getInsightsReport(); const overall = report.buckets.find((b) => b.key === 'overall'); const tagged = overall.recentMistakes.find((m) => m.missedTactics.length > 0 || m.punishedByTactics.length > 0); const untagged = overall.recentMistakes.find((m) => m.missedTactics.length === 0 && m.punishedByTactics.length === 0); const taggedDetail = tagged ? await window.chessAPI.getMistakeDetail(tagged.gameUrl, tagged.ply) : null; const untaggedDetail = untagged ? await window.chessAPI.getMistakeDetail(untagged.gameUrl, untagged.ply) : null; return { taggedDetail, untaggedDetail } })()
eval window.chessAPI.submitPuzzleOutcome('clean', 'mistake', null)
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-mistake-detail.txt
```

Expected: `taggedDetail` (if a tagged mistake exists in the recent list) has a non-null `nodeKey` matching `${tag}:${level}` shape, plus real `fenBefore`/`bestMoveUci`. `untaggedDetail` (if an untagged one exists) has `nodeKey: null`. The `submitPuzzleOutcome(..., null)` call returns `{ stats: {...}, nodeProgress: null }` without throwing — confirms the nullable path works before anything in the UI depends on it.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-mistake-detail.txt
git add src/shared/ipc.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Wire getMistakeDetail and a nullable nodeKey for submitPuzzleOutcome"
```

---

### Task 3: `useMistakeAttempt` hook

**Files:**
- Create: `src/renderer/src/hooks/useMistakeAttempt.ts`

**Interfaces:**
- Consumes: `MistakeDetail` (Task 1); `tryMove` (`../lib/tryMove`, unchanged); `gradeAttempt` (`../lib/gradeAttempt`, unchanged); `resolveSolvedOutcome`, `cappedQuality`, `newCardProgress`, `claimReview`, `claimOutcome`, `CardProgress` (`../lib/puzzleOutcome`, unchanged); `window.chessAPI.evaluatePosition`/`submitPuzzleReview`/`submitPuzzleOutcome` (Task 2).
- Produces: `useMistakeAttempt(detail: MistakeDetail): { hintUsed: boolean; attempt: (from: string, to: string) => Promise<MistakeAttemptResult | { error: string }>; requestHint: () => void; giveUp: () => void }`, consumed by Task 4's `MistakeCoachModal`.

This mirrors `usePuzzleSession.ts`'s `attempt`/`requestHint`/`giveUp` logic (same fast-path grading, same live-eval fallback, same SRS/outcome submission calls), adapted for exactly one fixed card instead of a queue — no `currentCard` null-checks (the modal only ever renders this hook once a real `MistakeDetail` exists), no `next()`/queue-advance, no card-change reset effect (there is only ever one card for the hook's lifetime).

- [ ] **Step 1: Write `src/renderer/src/hooks/useMistakeAttempt.ts`**

```ts
import { useCallback, useRef, useState } from 'react'
import type { MistakeDetail, PuzzleOutcome } from '../../../shared/types'
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

const ATTEMPT_DEPTH = 12

export interface MistakeAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

export function useMistakeAttempt(detail: MistakeDetail): {
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<MistakeAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
} {
  const [hintUsed, setHintUsed] = useState(false)
  // One card for this hook's whole lifetime (unlike usePuzzleSession's ref,
  // which resets across queue advances) - initialized once, not in an effect.
  const progressRef = useRef<CardProgress>(newCardProgress(detail.cardId))

  const submitOutcome = useCallback(
    async (outcome: PuzzleOutcome): Promise<void> => {
      try {
        await window.chessAPI.submitPuzzleOutcome(outcome, detail.classification, detail.nodeKey)
      } catch (err) {
        // Mirrors usePuzzleSession's precedent: the puzzle-rating/mastery
        // update is a motivational extra, not load-bearing - a failed write
        // here shouldn't block showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    [detail.classification, detail.nodeKey]
  )

  const attempt = useCallback(
    async (from: string, to: string): Promise<MistakeAttemptResult | { error: string }> => {
      const uci = `${from}${to}`
      const fenAfterAttempt = tryMove(detail.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      let graded: ReturnType<typeof gradeAttempt>
      if (uci === detail.bestMoveUci || `${uci}q` === detail.bestMoveUci) {
        // Same depth-mismatch rationale as usePuzzleSession: bestMoveUci was
        // found by the original scan at a higher depth than live grading
        // runs at, so re-evaluating the exact recorded answer could
        // otherwise wrongly fail it.
        graded = { correct: true, cpLoss: 0, quality: 5 }
      } else {
        const [evalBefore, evalAfter] = await Promise.all([
          window.chessAPI.evaluatePosition(detail.fenBefore, ATTEMPT_DEPTH),
          window.chessAPI.evaluatePosition(fenAfterAttempt, ATTEMPT_DEPTH)
        ])
        if ('error' in evalBefore) return { error: evalBefore.error }
        if ('error' in evalAfter) return { error: evalAfter.error }
        graded = gradeAttempt(evalBefore, evalAfter, uci, detail.bestMoveUci)
      }

      const progress = progressRef.current

      if (claimReview(progress)) {
        const quality = cappedQuality(graded.quality, hintUsed)
        try {
          await window.chessAPI.submitPuzzleReview(detail.cardId, quality)
        } catch (err) {
          console.error('Failed to persist puzzle review', err)
        }
      }

      if (graded.correct) {
        if (claimOutcome(progress)) {
          void submitOutcome(resolveSolvedOutcome(progress.hadWrongAttempt, hintUsed))
        }
      } else {
        progress.hadWrongAttempt = true
      }

      return { correct: graded.correct, cpLoss: graded.cpLoss, bestMoveUci: detail.bestMoveUci }
    },
    [detail, hintUsed, submitOutcome]
  )

  const requestHint = useCallback((): void => {
    setHintUsed(true)
  }, [])

  const giveUp = useCallback((): void => {
    if (!hintUsed) return
    const progress = progressRef.current

    if (claimReview(progress)) {
      void window.chessAPI.submitPuzzleReview(detail.cardId, 0).catch((err) => {
        console.error('Failed to persist puzzle review', err)
      })
    }

    if (claimOutcome(progress)) {
      void submitOutcome('gaveUp')
    }
  }, [detail.cardId, hintUsed, submitOutcome])

  return { hintUsed, attempt, requestHint, giveUp }
}
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npx vitest run
```

Expected: both clean. No new test file for this hook — per this plan's Global Constraints, hooks with local React state have no dedicated unit tests anywhere in this codebase (`usePuzzleSession.ts` is the precedent); the grading logic it calls (`gradeAttempt`) already has its own coverage in `gradeAttempt.test.ts`, and the hook itself is verified live in Task 4 once it has a UI to drive it through.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useMistakeAttempt.ts
git commit -m "Add useMistakeAttempt hook"
```

---

### Task 4: `MistakeCoachModal`, wiring, and CSS

**Files:**
- Create: `src/renderer/src/components/MistakeCoachModal.tsx`
- Modify: `src/renderer/src/components/insights/RecentMistakesList.tsx`
- Modify: `src/renderer/src/components/insights/TimeControlSection.tsx`
- Modify: `src/renderer/src/components/insights/BucketTabs.tsx`
- Modify: `src/renderer/src/components/InsightsTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `useMistakeAttempt` (Task 3); `window.chessAPI.getMistakeDetail` (Task 2); `Board` (unchanged); `TACTIC_LABELS` (`../lib/tacticLabels`, unchanged); `MistakeDetail`, `MistakeSummary` (Task 1, existing).
- Produces: nothing further consumes this — it's the top of this feature's stack.

- [ ] **Step 1: Write `src/renderer/src/components/MistakeCoachModal.tsx`**

```tsx
import { useState } from 'react'
import type { MistakeAttemptResult } from '../hooks/useMistakeAttempt'
import { useMistakeAttempt } from '../hooks/useMistakeAttempt'
import { tryMove } from '../lib/tryMove'
import { Board } from './Board'
import type { MistakeDetail } from '../../../shared/types'
import { TACTIC_LABELS } from '../lib/tacticLabels'

interface MistakeCoachModalProps {
  detail: MistakeDetail
  onClose: () => void
}

export function MistakeCoachModal({ detail, onClose }: MistakeCoachModalProps): JSX.Element {
  const { hintUsed, attempt, requestHint, giveUp } = useMistakeAttempt(detail)
  const [attemptFen, setAttemptFen] = useState<string | null>(null)
  const [result, setResult] = useState<MistakeAttemptResult | { error: string } | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const [isGrading, setIsGrading] = useState(false)

  const isCorrect = result !== null && 'correct' in result && result.correct
  const resolved = isCorrect || gaveUp
  const hintSquare = hintUsed && !resolved ? detail.bestMoveUci.slice(0, 2) : null
  // Same dedup as RecentMistakesList's displayTags() - a mistake can
  // legitimately carry the same tag in both arrays, and two identical chips
  // would read as a rendering glitch rather than one distinct fact.
  const tags = Array.from(new Set([...detail.missedTactics, ...detail.punishedByTactics]))

  const handleMove = (from: string, to: string): boolean => {
    if (result !== null || gaveUp || isGrading) return false

    const fenAfterAttempt = tryMove(detail.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setAttemptFen(fenAfterAttempt)
    setIsGrading(true)
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setResult(r)
    })
    return true
  }

  const handleRetry = (): void => {
    setAttemptFen(null)
    setResult(null)
  }

  const handleGiveUp = (): void => {
    if (isGrading) return
    giveUp()
    setGaveUp(true)
    setResult(null)
    setAttemptFen(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="mistake-coach-modal" onClick={(e) => e.stopPropagation()}>
        <div className="recent-mistake-tags">
          {tags.length === 0 ? (
            <span className="recent-mistake-tag">Positional</span>
          ) : (
            tags.map((tag) => (
              <span key={tag} className="recent-mistake-tag">
                {TACTIC_LABELS[tag]}
              </span>
            ))
          )}
        </div>
        <Board
          fen={result === null && attemptFen !== null ? attemptFen : detail.fenBefore}
          bestMoveUci={resolved ? detail.bestMoveUci : null}
          currentMove={null}
          boardOrientation={detail.userColor === 'w' ? 'white' : 'black'}
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
          </div>
        )}
        {gaveUp && (
          <div className="puzzle-feedback puzzle-feedback-incorrect">
            <span>Here's the move you missed.</span>
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
        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Make `RecentMistakesList.tsx` rows clickable**

Replace the file's contents in full:

```tsx
import type { MistakeSummary, TacticType } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'

interface RecentMistakesListProps {
  mistakes: MistakeSummary[]
  onSelectMistake: (gameUrl: string, ply: number) => void
}

const PHASE_LABELS = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' }

// missedTactics and punishedByTactics can legitimately share a tag (e.g. the
// player missed a fork earlier and was separately forked later in the same
// move) -- dedupe for display, since two identical "Fork" chips read as a
// rendering glitch rather than two distinct facts.
function displayTags(mistake: MistakeSummary): TacticType[] {
  return Array.from(new Set([...mistake.missedTactics, ...mistake.punishedByTactics]))
}

export function RecentMistakesList({ mistakes, onSelectMistake }: RecentMistakesListProps): JSX.Element | null {
  if (mistakes.length === 0) return null

  return (
    <ul className="recent-mistakes-list">
      {mistakes.map((mistake) => {
        const tags = displayTags(mistake)
        return (
          <li key={`${mistake.gameUrl}-${mistake.ply}`}>
            <button
              className="recent-mistake-row"
              onClick={() => onSelectMistake(mistake.gameUrl, mistake.ply)}
            >
              <span className="recent-mistake-meta">
                {`${new Date(mistake.endTime * 1000).toLocaleDateString()} · vs ${mistake.opponentUsername} · move ${Math.ceil(mistake.ply / 2)} · ${PHASE_LABELS[mistake.phase]}`}
              </span>
              <span className="recent-mistake-tags">
                {tags.length === 0 ? (
                  <span className="recent-mistake-tag">Positional</span>
                ) : (
                  tags.map((tag) => (
                    <span key={tag} className="recent-mistake-tag">
                      {TACTIC_LABELS[tag]}
                    </span>
                  ))
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 3: Thread `onSelectMistake` through `TimeControlSection.tsx` and `BucketTabs.tsx`**

In `src/renderer/src/components/insights/TimeControlSection.tsx`, add `onSelectMistake: (gameUrl: string, ply: number) => void` to `TimeControlSectionProps` and to the destructured props, and pass it through to `RecentMistakesList`:

```tsx
interface TimeControlSectionProps {
  bucket: InsightsBucket
  onSelectMistake: (gameUrl: string, ply: number) => void
}
```

```tsx
export function TimeControlSection({ bucket, onSelectMistake }: TimeControlSectionProps): JSX.Element {
```

```tsx
          <RecentMistakesList mistakes={visibleMistakes} onSelectMistake={onSelectMistake} />
```

In `src/renderer/src/components/insights/BucketTabs.tsx`, add the same prop and pass it through:

```tsx
interface BucketTabsProps {
  buckets: InsightsBucket[]
  onSelectMistake: (gameUrl: string, ply: number) => void
}

export function BucketTabs({ buckets, onSelectMistake }: BucketTabsProps): JSX.Element | null {
```

```tsx
      <TimeControlSection key={selected.key} bucket={selected} onSelectMistake={onSelectMistake} />
```

- [ ] **Step 4: Wire state and the modal into `InsightsTab.tsx`**

Add imports:

```ts
import { useState } from 'react'
import type { MistakeDetail } from '../../../shared/types'
import { MistakeCoachModal } from './MistakeCoachModal'
```

Inside the component, before the `return`, add:

```ts
const [selectedMistake, setSelectedMistake] = useState<{ gameUrl: string; ply: number } | null>(null)
const [mistakeDetail, setMistakeDetail] = useState<MistakeDetail | null>(null)

const handleSelectMistake = (gameUrl: string, ply: number): void => {
  setSelectedMistake({ gameUrl, ply })
  setMistakeDetail(null)
  window.chessAPI.getMistakeDetail(gameUrl, ply).then(setMistakeDetail)
}

const handleCloseMistake = (): void => {
  setSelectedMistake(null)
  setMistakeDetail(null)
}
```

Update the `BucketTabs` usage to pass the new prop:

```tsx
<BucketTabs buckets={state.report.buckets} onSelectMistake={handleSelectMistake} />
```

Add the modal render, as the last thing inside the top-level `<div className="insights-tab">` (after the existing `{hasReport && ...}` block, still inside that same outer div):

```tsx
      {selectedMistake && mistakeDetail && (
        <MistakeCoachModal detail={mistakeDetail} onClose={handleCloseMistake} />
      )}
```

(`selectedMistake` without `mistakeDetail` yet — the brief window while the IPC call resolves — renders nothing, matching this app's existing precedent elsewhere of a silent gap during a fetch rather than a spinner for near-instant reads.)

- [ ] **Step 5: Add CSS**

In `src/renderer/src/app.css`, modify the existing `.recent-mistake-row` rule (currently a plain `flex` container, now applied to a `<button>` instead of an `<li>`) — add `width: 100%; text-align: left;` and a hover rule, matching `.chesscom-game-card`'s exact pattern:

```css
.recent-mistake-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  padding: 0.45rem 0.65rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 0.82rem;
  width: 100%;
  text-align: left;
}

.recent-mistake-row:hover:not(:disabled) {
  border-color: var(--accent);
}
```

Add a new rule directly after `.verification-code` (end of the existing modal-related CSS block):

```css
.mistake-coach-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-modal);
  padding: 1.25rem;
  width: 100%;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: all clean.

- [ ] **Step 7: Verify visually via `run-desktop`**

```bash
cat > /tmp/verify-coach-modal.txt <<'EOF'
launch
click-text Insights
sleep 1000
eval window.scrollTo(0, 500)
sleep 300
ss coach-01-mistakes-list
eval document.querySelectorAll('.recent-mistake-row').length
click .recent-mistake-row
sleep 500
ss coach-02-modal-open
eval document.querySelector('.mistake-coach-modal') !== null
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-coach-modal.txt
```

Read both screenshots before proceeding. `coach-01-mistakes-list.png` should show the recent-mistakes rows now visibly clickable (hover border on `:hover`, not verifiable from a static screenshot but confirm the rows are real `<button>`s via the `eval` count). `coach-02-modal-open.png` should show the modal open: tactic tag(s) or "Positional", a real board position, Hint/Can't-solve controls.

Then drive a full attempt through both paths — a tagged mistake (to confirm mastery-node crediting) and an untagged one (to confirm rating-only), reading the mastery tree's state before and after each via `eval` rather than guessing from the UI:

```bash
cat > /tmp/verify-coach-modal-2.txt <<'EOF'
launch
click-text Insights
sleep 1000
eval (async () => { const report = await window.chessAPI.getInsightsReport(); const overall = report.buckets.find((b) => b.key === 'overall'); const tagged = overall.recentMistakes.find((m) => m.missedTactics.length > 0 || m.punishedByTactics.length > 0); if (!tagged) return 'no tagged mistake in this account\'s recent list'; const detail = await window.chessAPI.getMistakeDetail(tagged.gameUrl, tagged.ply); const before = detail.nodeKey ? await window.chessAPI.getMasteryTree() : null; const beforeNode = before ? before.find((n) => n.key === detail.nodeKey) : null; return { detail, beforeStreak: beforeNode?.cleanStreak } })()
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-coach-modal-2.txt
```

Use the printed `detail.bestMoveUci` to actually play the correct move on the board in a follow-up script (open the modal for that same `gameUrl`/`ply` by clicking the matching row, or re-derive the click target the same way Task 6/7 of the earlier Analyze-tab plan did for real-game rows — read the DOM to find the matching `.recent-mistake-row`), then confirm via a final `eval window.chessAPI.getMasteryTree()` call that the node's `cleanStreak` increased by exactly 1 from `beforeStreak`, and that `window.chessAPI.getPuzzleStats()`'s `rating` increased. Repeat with an untagged mistake and confirm the mastery tree is unchanged (no node's `cleanStreak` moved) while `getPuzzleStats()`'s rating still increased.

If a real correct-move walkthrough proves impractical to script reliably against a live position (finding and clicking the exact two squares), it's acceptable to instead verify the "Can't solve" reveal path live (hint → can't solve → confirm the board reveals `bestMoveUci` and the SRS/outcome calls fire without error) and confirm the exact-match/live-eval grading branches through `useMistakeAttempt`'s already-covered dependency (`gradeAttempt.test.ts`) plus this task's own read of the diff — note explicitly in the report which path was actually driven live and which was traced through code, since Task 1-3's tests already cover the underlying grading and credit-resolution logic directly.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f /tmp/verify-coach-modal.txt /tmp/verify-coach-modal-2.txt
git add src/renderer/src/components/MistakeCoachModal.tsx \
  src/renderer/src/components/insights/RecentMistakesList.tsx \
  src/renderer/src/components/insights/TimeControlSection.tsx \
  src/renderer/src/components/insights/BucketTabs.tsx \
  src/renderer/src/components/InsightsTab.tsx \
  src/renderer/src/app.css
git commit -m "Make Insights mistakes clickable into an interactive coaching modal"
```

---

### Task 5: Full verification pass

**Files:** none (verification only).

**Interfaces:** none — this task confirms Tasks 1-4 work together as a whole.

- [ ] **Step 1: Full verify**

```bash
npm run verify
```

Expected: typecheck clean, full test suite passes (baseline + `resolveMistakeCredit`'s 4 new cases).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: End-to-end live verification via `run-desktop`**

Drive one continuous session: open Insights, open the coaching modal from a real mistake row, attempt it (correct or hint/reveal path, whichever is practical to script reliably), close it, and confirm the row list is still intact and the tab is usable afterward (no leftover backdrop, no broken layout). Screenshot each step and read every screenshot before concluding success — do not delete any screenshots.

- [ ] **Step 4: Clean up**

```bash
rm -f /tmp/verify-*.txt
```

No commit for this task — it's verification only, nothing changed.

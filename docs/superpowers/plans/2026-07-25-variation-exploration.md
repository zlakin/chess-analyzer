# Variation Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users move pieces on the Analyze board to explore "what if" variations off the recorded game, with a live (shallow-depth) engine evaluation of wherever they've moved to — without ever modifying the recorded game's own analysis (move list, eval graph, accuracy, classifications).

**Architecture:** A persistent (lazily-started, reused) Stockfish process in the main process for live eval, exposed via one new narrow IPC channel. A renderer-side `useVariationExplorer` hook holds an ephemeral scratch-move stack (chess.js-validated) that resets the instant any real-game navigation happens. `Board.tsx` gains real move input (drag via react-chessboard's `onPieceDrop`, hand-built click-to-move via `onSquareClick` — the library has no built-in click-to-move). `App.tsx` swaps the board's displayed FEN/eval to the scratch state while exploring and swaps `MoveDetail` for a new `ExploringBanner`.

**Tech Stack:** Existing stack only — `chess.js` (already a renderer dependency, already used in `lib/moveDetail.ts`), `react-chessboard`'s real (not assumed) v5 API, the existing `StockfishManager`/IPC/preload patterns. No new dependencies.

## Global Constraints

- No branching move-list UI, no PGN tree, no persistence of explored lines — exploration is ephemeral scratch state only. The recorded game's move list, eval graph, accuracy, and classifications are never modified by exploration.
- No move classification of explored moves — only a live eval number, not brilliant/blunder/etc.
- No pawn-promotion picker — promotion auto-queens (`promotion: 'q'` in `tryMove`).
- No legal-move-dot highlighting on candidate destinations — out of scope for this pass (see the design spec's Future Ideas).
- Any real-game navigation (arrow keys, clicking a move-list row, clicking the eval graph) resets exploration back to empty — this must hold regardless of which of those three triggered it.
- The persistent exploration engine must be reused across calls, not spawned fresh per move (spawning per move would add real per-move latency) — verified by the Task 1 test asserting spawn count, not just "it works."
- `pieceType` strings from react-chessboard are `'w'+LETTER`/`'b'+LETTER` (e.g. `'wP'`, `'bQ'`) — confirmed against the installed package's actual source (`fenToPieceCode` in `react-chessboard/dist/index.esm.js`), not assumed.
- This repo's git workflow: commit straight to `main`, no branches/worktrees/PRs.

---

### Task 1: Main process — persistent exploration engine + IPC

**Files:**
- Create: `src/main/engine/explorationEngine.ts`
- Create: `src/main/engine/explorationEngine.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: `StockfishManager` (`src/main/engine/stockfishManager.ts`, already exists — its constructor takes `(binaryPath: string, spawnFn?: SpawnFn)`, and `evaluatePosition(fen, { depth }): Promise<PositionEvaluation>`), `getStockfishBinaryPath()` (`src/main/engine/stockfishPath.ts`, already exists).
- Produces: `evaluateExplorationPosition(fen: string, depth: number, spawnFn?: SpawnFn): Promise<PositionEvaluation | { error: string }>`, `stopExplorationEngine(): void`, `__resetExplorationEngineForTests(): void` (exported from `explorationEngine.ts`) — Task 2 and later tasks don't call these main-process functions directly, but the IPC channel (`ChessAPI.evaluatePosition`) they back is what Task 2's hook calls.

- [ ] **Step 1: Write `src/main/engine/explorationEngine.ts`**

```ts
import { spawn } from 'node:child_process'
import { StockfishManager } from './stockfishManager'
import type { SpawnFn } from './stockfishManager'
import { getStockfishBinaryPath } from './stockfishPath'
import type { PositionEvaluation } from '../../shared/types'

let engine: StockfishManager | null = null
let starting: Promise<StockfishManager> | null = null

async function getEngine(spawnFn: SpawnFn): Promise<StockfishManager> {
  if (engine) return engine
  if (!starting) {
    starting = (async () => {
      const instance = new StockfishManager(getStockfishBinaryPath(), spawnFn)
      await instance.start()
      engine = instance
      return instance
    })()
  }
  return starting
}

export async function evaluateExplorationPosition(
  fen: string,
  depth: number,
  spawnFn: SpawnFn = spawn as SpawnFn
): Promise<PositionEvaluation | { error: string }> {
  try {
    const instance = await getEngine(spawnFn)
    return await instance.evaluatePosition(fen, { depth })
  } catch (err) {
    // The persistent engine died (crashed, killed) - drop the cached
    // reference so the next call starts a fresh one instead of retrying
    // a dead process forever.
    engine = null
    starting = null
    return { error: `Could not evaluate position: ${(err as Error).message}` }
  }
}

export function stopExplorationEngine(): void {
  engine?.stop()
  engine = null
  starting = null
}

// Exposed only so tests can reset module-level state between cases,
// matching the pattern already used in accountLink.ts's
// __resetPendingChallengeForTests.
export function __resetExplorationEngineForTests(): void {
  engine = null
  starting = null
}
```

- [ ] **Step 2: Write `src/main/engine/explorationEngine.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  evaluateExplorationPosition,
  stopExplorationEngine,
  __resetExplorationEngineForTests
} from './explorationEngine'

function createFakeProcess(): { proc: ChildProcessWithoutNullStreams; kill: ReturnType<typeof vi.fn> } {
  const stdout = new EventEmitter()
  const kill = vi.fn()
  const fakeProc = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new EventEmitter(),
    stdin: {
      write: (data: string) => {
        const command = data.trim()
        if (command === 'uci') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('uciok\n')))
        } else if (command === 'isready') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('readyok\n')))
        } else if (command.startsWith('go depth')) {
          queueMicrotask(() => {
            stdout.emit('data', Buffer.from('info depth 12 multipv 1 score cp 20 pv e2e4\n'))
            stdout.emit('data', Buffer.from('bestmove e2e4\n'))
          })
        }
      }
    },
    kill
  })
  return { proc: fakeProc as unknown as ChildProcessWithoutNullStreams, kill }
}

describe('explorationEngine', () => {
  beforeEach(() => {
    __resetExplorationEngineForTests()
  })

  it('reuses one engine instance across multiple evaluate calls', async () => {
    let spawnCount = 0
    const spawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      return createFakeProcess().proc
    }

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    await evaluateExplorationPosition('startpos', 12, spawnFn)

    expect(spawnCount).toBe(1)
  })

  it('resets the cached instance after an error so the next call starts fresh', async () => {
    let spawnCount = 0
    const throwingSpawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      throw new Error('spawn failed')
    }

    const first = await evaluateExplorationPosition('startpos', 12, throwingSpawnFn)
    expect('error' in first && first.error).toContain('Could not evaluate position')

    const workingSpawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      return createFakeProcess().proc
    }
    await evaluateExplorationPosition('startpos', 12, workingSpawnFn)

    expect(spawnCount).toBe(2)
  })

  it('stopExplorationEngine kills the process and clears the cache so the next call spawns fresh', async () => {
    let spawnCount = 0
    const kills: Array<ReturnType<typeof vi.fn>> = []
    const spawnFn = (): ChildProcessWithoutNullStreams => {
      spawnCount++
      const fake = createFakeProcess()
      kills.push(fake.kill)
      return fake.proc
    }

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    stopExplorationEngine()
    expect(kills[0]).toHaveBeenCalled()

    await evaluateExplorationPosition('startpos', 12, spawnFn)
    expect(spawnCount).toBe(2)
  })
})
```

- [ ] **Step 3: Run the new test file**

```bash
npx vitest run src/main/engine/explorationEngine.test.ts
```

Expected: 3 passed, 0 failed.

- [ ] **Step 4: Add the IPC channel to `src/shared/ipc.ts`**

Add this line inside the `IPC_CHANNELS` object (anywhere is fine; grouping it near `getSettings`/`setTheme` is reasonable):

```ts
  evaluatePosition: 'engine:evaluate-position',
```

- [ ] **Step 5: Add `evaluatePosition` to `ChessAPI` in `src/shared/types.ts`**

Add this line inside the `ChessAPI` interface:

```ts
  evaluatePosition(fen: string, depth: number): Promise<PositionEvaluation | { error: string }>
```

`PositionEvaluation` is already imported/defined in this file (used by `getSettings`'s neighbors) — confirm it's in scope; if the type isn't already exported near the top of the file where `AnalyzedMove` etc. live, no import change is needed since this interface is in the same file as the type definition.

- [ ] **Step 6: Add the handler to `src/main/ipc/handlers.ts`**

Add the import:

```ts
import { evaluateExplorationPosition } from '../engine/explorationEngine'
```

Add the handler, near the other `settings:*` handlers for grouping (exact placement doesn't matter functionally):

```ts
  ipcMain.handle(IPC_CHANNELS.evaluatePosition, async (_event, fen: string, depth: number) => {
    return evaluateExplorationPosition(fen, depth)
  })
```

- [ ] **Step 7: Expose it in `src/preload/index.ts`**

Add this line inside the `chessAPI` object:

```ts
  evaluatePosition: (fen: string, depth: number) => ipcRenderer.invoke(IPC_CHANNELS.evaluatePosition, fen, depth),
```

- [ ] **Step 8: Stop the persistent engine on app quit in `src/main/index.ts`**

Add the import:

```ts
import { stopExplorationEngine } from './engine/explorationEngine'
```

Change:

```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

to:

```ts
app.on('window-all-closed', () => {
  stopExplorationEngine()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 9: Typecheck and run the full suite**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (217 existing + 3 new = 220).

- [ ] **Step 10: Commit**

```bash
git add src/main/engine/explorationEngine.ts src/main/engine/explorationEngine.test.ts \
  src/main/index.ts src/main/ipc/handlers.ts src/preload/index.ts \
  src/shared/ipc.ts src/shared/types.ts
git commit -m "Add a persistent exploration engine and evaluatePosition IPC channel"
```

---

### Task 2: Renderer — pure move validation + the exploration hook

**Files:**
- Create: `src/renderer/src/lib/tryMove.ts`
- Create: `src/renderer/src/lib/tryMove.test.ts`
- Create: `src/renderer/src/hooks/useVariationExplorer.ts`

**Interfaces:**
- Consumes: `window.chessAPI.evaluatePosition(fen, depth)` from Task 1 (already wired into the global `Window.chessAPI` type via `env.d.ts` referencing `ChessAPI`, which Task 1 already extended — no further type-plumbing needed here). `whiteWinPercent`/`formatScore` are NOT used inside this hook (App.tsx will call those itself in Task 4, same as it already does for the recorded game) — this hook only returns the raw `PositionEvaluation`.
- Produces: `tryMove(fen: string, from: string, to: string): string | null` (pure). `useVariationExplorer(baseFen: string): { isExploring: boolean; currentFen: string; sideToMove: 'w' | 'b'; evaluation: PositionEvaluation | null; isEvaluating: boolean; makeMove: (from: string, to: string) => boolean; undoLastMove: () => void; exitExploration: () => void }` — Task 3 (Board) consumes `makeMove`; Task 4 (App) consumes everything else.

- [ ] **Step 1: Write `src/renderer/src/lib/tryMove.ts`**

```ts
import { Chess } from 'chess.js'

export function tryMove(fen: string, from: string, to: string): string | null {
  const chess = new Chess(fen)
  try {
    const move = chess.move({ from, to, promotion: 'q' })
    return move ? chess.fen() : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Write `src/renderer/src/lib/tryMove.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { tryMove } from './tryMove'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

describe('tryMove', () => {
  it('returns the resulting FEN for a legal move', () => {
    expect(tryMove(START_FEN, 'e2', 'e4')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    )
  })

  it('returns null for an illegal move', () => {
    expect(tryMove(START_FEN, 'e2', 'e5')).toBeNull()
  })

  it('returns null when moving from an empty square', () => {
    expect(tryMove(START_FEN, 'e4', 'e5')).toBeNull()
  })

  it("returns null when attempting to move the side not to move's piece", () => {
    // White to move; e7 has a black pawn.
    expect(tryMove(START_FEN, 'e7', 'e5')).toBeNull()
  })

  it('auto-queens a pawn promotion', () => {
    const fenBeforePromotion = '8/P7/8/8/8/8/8/k6K w - - 0 1'
    const result = tryMove(fenBeforePromotion, 'a7', 'a8')
    expect(result).not.toBeNull()
    expect(result).toContain('Q')
  })
})
```

- [ ] **Step 3: Run the new test file**

```bash
npx vitest run src/renderer/src/lib/tryMove.test.ts
```

Expected: 5 passed, 0 failed. If the first test's exact FEN string doesn't match (e.g. a chess.js version formatting difference), fix the expected string to whatever the real output is — the important behaviors are the other four cases, not this one's exact byte-for-byte string.

- [ ] **Step 4: Write `src/renderer/src/hooks/useVariationExplorer.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PositionEvaluation } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'

const EXPLORATION_DEPTH = 12

export function useVariationExplorer(baseFen: string): {
  isExploring: boolean
  currentFen: string
  sideToMove: 'w' | 'b'
  evaluation: PositionEvaluation | null
  isEvaluating: boolean
  makeMove: (from: string, to: string) => boolean
  undoLastMove: () => void
  exitExploration: () => void
} {
  const [scratchHistory, setScratchHistory] = useState<string[]>([])
  const [evaluation, setEvaluation] = useState<PositionEvaluation | null>(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const requestIdRef = useRef(0)

  // Real-game navigation changed baseFen out from under us - any
  // in-progress exploration is relative to a position that's no longer
  // being viewed, so it's cleared rather than left dangling.
  useEffect(() => {
    setScratchHistory([])
    setEvaluation(null)
  }, [baseFen])

  const currentFen = scratchHistory[scratchHistory.length - 1] ?? baseFen
  const isExploring = scratchHistory.length > 0
  const sideToMove: 'w' | 'b' = currentFen.split(' ')[1] === 'b' ? 'b' : 'w'

  useEffect(() => {
    if (!isExploring) return
    const requestId = ++requestIdRef.current
    setIsEvaluating(true)
    window.chessAPI.evaluatePosition(currentFen, EXPLORATION_DEPTH).then((result) => {
      // A newer move superseded this request while it was in flight -
      // discard the now-stale response rather than overwrite a newer one.
      if (requestIdRef.current !== requestId) return
      setIsEvaluating(false)
      if ('error' in result) return
      setEvaluation(result)
    })
  }, [currentFen, isExploring])

  const makeMove = useCallback(
    (from: string, to: string): boolean => {
      const nextFen = tryMove(currentFen, from, to)
      if (!nextFen) return false
      setScratchHistory((history) => [...history, nextFen])
      return true
    },
    [currentFen]
  )

  const undoLastMove = useCallback(() => {
    setScratchHistory((history) => history.slice(0, -1))
  }, [])

  const exitExploration = useCallback(() => {
    setScratchHistory([])
    setEvaluation(null)
  }, [])

  return {
    isExploring,
    currentFen,
    sideToMove,
    evaluation,
    isEvaluating,
    makeMove,
    undoLastMove,
    exitExploration
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean (this hook isn't consumed by anything yet — Task 4 wires it up — so a typecheck pass here just confirms the file itself is well-typed in isolation).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/tryMove.ts src/renderer/src/lib/tryMove.test.ts \
  src/renderer/src/hooks/useVariationExplorer.ts
git commit -m "Add tryMove and the useVariationExplorer hook"
```

---

### Task 3: Board.tsx — drag and click move input

**Files:**
- Modify: `src/renderer/src/components/Board.tsx`

**Interfaces:**
- Consumes: `onMove: (from: string, to: string) => boolean` (from Task 2's `useVariationExplorer.makeMove`, wired in by Task 4 — this task's own verification passes a plain test callback, not the real hook, since `Board` doesn't know or care where `onMove` comes from).
- Produces: `Board`'s prop list changes — `boardOrientation` moves from a hardcoded internal literal to a required prop, and a new required `onMove` prop is added. Task 4 must pass both when rendering `<Board>`, or the build fails to typecheck (a deliberate signal, not a note-to-self — this is the correct way to force Task 4 to actually wire it up, not skip it).

- [ ] **Step 1: Replace `src/renderer/src/components/Board.tsx` in full**

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
}

export const Board = memo(function Board({
  fen,
  bestMoveUci,
  currentMove,
  boardOrientation,
  onMove,
  onHeightChange
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

  const squareStyles = useMemo(
    () => (selectedSquare ? { [selectedSquare]: { boxShadow: 'inset 0 0 0 3px var(--accent)' } } : {}),
    [selectedSquare]
  )

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

- [ ] **Step 2: Confirm this alone doesn't yet typecheck (expected, not a bug)**

```bash
npm run typecheck
```

Expected: **fails**, because `App.tsx` (not yet updated — that's Task 4) still renders `<Board fen={...} bestMoveUci={...} currentMove={...} onHeightChange={...} />` without the two new required props (`boardOrientation`, `onMove`). This is the correct, expected state at the end of this task — do not attempt to fix `App.tsx` here, that's Task 4's job. Confirm the *only* typecheck errors are in `App.tsx` about `Board`'s props, not inside `Board.tsx` itself (a `Board.tsx`-internal error would mean a real mistake in this file).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Board.tsx
git commit -m "Add drag and click-to-move input to Board.tsx"
```

Note for whoever reviews or resumes this plan: `npm run verify` will fail after this commit until Task 4 lands. That's expected given Task 3's own scope is complete and correct in isolation — don't "fix" it by reverting or by doing Task 4's work here.

---

### Task 4: App.tsx integration, ExploringBanner, CSS

**Files:**
- Create: `src/renderer/src/components/ExploringBanner.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `useVariationExplorer` (Task 2), `Board`'s new `boardOrientation`/`onMove` props (Task 3), `whiteWinPercent`/`formatScore` (already exist in `lib/displayEval.ts`, unchanged).
- Produces: nothing new consumed by other tasks — this is the last task.

- [ ] **Step 1: Write `src/renderer/src/components/ExploringBanner.tsx`**

```tsx
import type { PositionEvaluation } from '../../../shared/types'
import { whiteWinPercent, formatScore } from '../lib/displayEval'

interface ExploringBannerProps {
  evaluation: PositionEvaluation | null
  isEvaluating: boolean
  sideToMove: 'w' | 'b'
  canUndo: boolean
  onUndo: () => void
  onExit: () => void
}

export function ExploringBanner({
  evaluation,
  isEvaluating,
  sideToMove,
  canUndo,
  onUndo,
  onExit
}: ExploringBannerProps): JSX.Element {
  const scoreText = evaluation ? formatScore(evaluation, sideToMove) : null

  return (
    <div className="exploring-banner">
      <span className="exploring-banner-label">Exploring a variation</span>
      <span className="exploring-banner-eval">
        {isEvaluating && !evaluation ? '…' : (scoreText ?? '')}
      </span>
      <button className="button-secondary" onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>
      <button className="button-secondary" onClick={onExit}>
        Back to game
      </button>
    </div>
  )
}
```

`whiteWinPercent` is imported but intentionally unused in this file's JSX directly — it's re-exported implicitly through `formatScore`'s sibling usage pattern elsewhere in the app (EvalBar in `App.tsx` calls `whiteWinPercent` itself for the bar's fill). Remove the unused `whiteWinPercent` import from this file if the linter/typecheck flags it as unused — check in Step 4 below.

- [ ] **Step 2: Add CSS to `src/renderer/src/app.css`**

Add near the existing `.move-detail`/`.board-nav` rules (exact location doesn't matter functionally — grouping with board-column-related rules is reasonable):

```css
.exploring-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
}

.exploring-banner-label {
  font-weight: 600;
  color: var(--text);
}

.exploring-banner-eval {
  font-family: var(--font-mono);
  color: var(--text-muted);
  margin-right: auto;
}
```

- [ ] **Step 3: Update `src/renderer/src/App.tsx`**

Add imports:

```ts
import { useVariationExplorer } from './hooks/useVariationExplorer'
import { ExploringBanner } from './components/ExploringBanner'
```

Add state and the hook call, alongside the existing `boardHeight` state (from the sub-project 2 responsive-layout work):

```ts
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const explorer = useVariationExplorer(position.fen)
```

Place this *after* `position` is computed (the existing `useMemo` for `position`/`currentMove` earlier in the file) since it depends on `position.fen`.

Extend the existing keydown `useEffect` (the one handling `ArrowLeft`/`ArrowRight`/`Home`/`End`) to also handle `F`:

```ts
      if (e.key === 'ArrowLeft') goToPly(currentPly - 1)
      else if (e.key === 'ArrowRight') goToPly(currentPly + 1)
      else if (e.key === 'Home') goToPly(0)
      else if (e.key === 'End') goToPly(state.moves.length)
      else if (e.key === 'f' || e.key === 'F') setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
```

Update the `<EvalBar>` render to show the exploration eval while exploring:

```tsx
                <EvalBar
                  whiteWinPercent={
                    explorer.isExploring
                      ? explorer.evaluation
                        ? whiteWinPercent(explorer.evaluation, explorer.sideToMove)
                        : 50
                      : position.evaluation
                        ? whiteWinPercent(position.evaluation, position.sideToMove)
                        : 50
                  }
                  displayScore={
                    explorer.isExploring
                      ? explorer.evaluation
                        ? formatScore(explorer.evaluation, explorer.sideToMove)
                        : '...'
                      : position.evaluation
                        ? formatScore(position.evaluation, position.sideToMove)
                        : '0.00'
                  }
                  height={boardHeight}
                />
```

Update the `<Board>` render:

```tsx
                  <Board
                    fen={explorer.currentFen}
                    bestMoveUci={explorer.isExploring ? null : position.bestMoveUci}
                    currentMove={explorer.isExploring ? null : currentMove}
                    boardOrientation={boardOrientation}
                    onMove={explorer.makeMove}
                    onHeightChange={handleBoardHeightChange}
                  />
```

Replace the existing `<MoveDetail move={currentMove} />` line with:

```tsx
                  {explorer.isExploring ? (
                    <ExploringBanner
                      evaluation={explorer.evaluation}
                      isEvaluating={explorer.isEvaluating}
                      sideToMove={explorer.sideToMove}
                      canUndo={true}
                      onUndo={explorer.undoLastMove}
                      onExit={explorer.exitExploration}
                    />
                  ) : (
                    <MoveDetail move={currentMove} />
                  )}
```

- [ ] **Step 4: Typecheck, lint-check for the unused import flagged in Step 1, run the full suite, build**

```bash
npm run verify
```

If `whiteWinPercent` in `ExploringBanner.tsx` is flagged as unused (it is, per Step 1's own note — that import shouldn't have been added at all), remove it:

```ts
import { formatScore } from '../lib/displayEval'
```

Re-run `npm run verify` until clean. Expected: typecheck clean, all tests pass (220 from Task 1/2, no new tests added in this task — see Testing below).

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 5: Verify via `run-desktop`**

Build first if not already done in Step 4, then drive the app:

```bash
cat > /tmp/verify-exploration.txt <<'EOF'
launch
fill textarea 1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0
click-text Load Game
wait .game-summary 150000
sleep 500
press Home
sleep 200
eval document.querySelector('.exploring-banner')
click [data-square="e2"]
sleep 200
click [data-square="e4"]
sleep 800
eval document.querySelector('.exploring-banner-label')?.textContent
eval document.querySelector('.exploring-banner-eval')?.textContent
ss exploring-state
click-text Back to game
sleep 300
eval document.querySelector('.exploring-banner')
ss after-back-to-game
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-exploration.txt
```

Expected: the first `eval document.querySelector('.exploring-banner')` prints `null` (not exploring yet, still on the real game's start position after `Home`). After the two clicks (e2 then e4 - a click-to-move sequence, not drag, since the driver has no drag primitive), the banner's label reads `"Exploring a variation"` and the eval text is non-empty (either `…` or a real score, depending on timing - if it still reads `…` after 800ms, increase the sleep and re-check rather than treating it as a failure, since the fake exploration engine needs to actually start up on first use). After clicking "Back to game", the banner selector is `null` again.

If `[data-square="e2"]` isn't the right selector for react-chessboard's actual rendered squares, inspect the real DOM first (`eval document.querySelector('[class*="square"]').outerHTML` after `wait .game-summary` to see the actual attribute/class react-chessboard renders) and adjust the two `click` lines accordingly - don't guess a second time, look at the real markup.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-exploration.txt
git add src/renderer/src/components/ExploringBanner.tsx src/renderer/src/App.tsx src/renderer/src/app.css
git commit -m "Wire variation exploration into the Analyze tab"
```

## Testing

Tasks 1 and 2 have real unit tests (`explorationEngine.test.ts`,
`tryMove.test.ts`) per this codebase's established pattern of testing
pure/mockable logic, not React rendering. Tasks 3 and 4 are verified via
`run-desktop` against the actual built app, matching sub-projects 1-3 of
this same initiative — this codebase deliberately has no
`@testing-library/react`/jsdom setup, and introducing one for this
single feature would be a bigger, separate decision, not a natural
extension of the existing test suite.

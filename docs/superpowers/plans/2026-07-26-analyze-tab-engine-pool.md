# Analyze Tab Engine Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parallelize full-game analysis across multiple Stockfish processes instead of evaluating one position at a time, cutting wall-clock analysis time several-fold with zero change to accuracy or results.

**Architecture:** A new `EnginePool` (`src/main/engine/enginePool.ts`) spawns several `StockfishManager` processes and internally routes each `evaluatePosition` call to whichever is idle, queuing excess calls — callers never see the concurrency limit. `gameAnalyzer.ts`'s `analyzeGame` dispatches every position's evaluation to the pool immediately instead of awaiting them one at a time, then flushes results through the existing classification pipeline strictly in game order as they arrive (possibly out of order), preserving identical per-move results and the current progressive "moves fill in as computed" UI. `handlers.ts` swaps a single `StockfishManager` for a sized `EnginePool` in the `analyzeGame` IPC handler.

## Global Constraints

- Analysis depth stays at 18 (unchanged from today) — this is a parallelism-only change, not an accuracy tradeoff. No new settings UI.
- Pool size is `Math.max(1, Math.min(6, cpuCount - 2))` — computed automatically from `os.cpus().length`, not user-configurable.
- Each move's classification must remain byte-identical to today's sequential result — only the wall-clock time to obtain it changes. Never change `computeMoveEvalDelta`, `classifyMove`, `moveAccuracy`, or `gameAccuracy` themselves.
- A single `StockfishManager` instance must never receive two concurrent `evaluatePosition` calls (corrupts results — see `explorationEngine.ts`'s existing comment on this exact hazard).
- Any single pooled engine's evaluation failure aborts the whole analysis with an error, matching today's all-or-nothing failure behavior — no partial-recovery/respawn logic.
- This repo's git workflow: commit straight to `main` (no branches/worktrees/PRs).

---

### Task 1: `EnginePool`

**Files:**
- Create: `src/main/engine/enginePool.ts`
- Create: `src/main/engine/enginePool.test.ts`

**Interfaces:**
- Consumes: `PositionEvaluation` (`src/shared/types.ts`, unchanged).
- Produces: `PooledEngine`, `EnginePool` interfaces, `poolSize(cpuCount: number): number`, `createEnginePool(size: number, createEngine: () => PooledEngine): Promise<EnginePool>` (all in `src/main/engine/enginePool.ts`) — Task 3's IPC handler calls `poolSize` and `createEnginePool` directly; Task 2's `analyzeGame` consumes anything satisfying `EnginePool`'s shape (it never imports this file directly — `EnginePool`'s `evaluatePosition` signature matches `gameAnalyzer.ts`'s existing `EvaluationEngine` interface exactly, so no import coupling is needed between them).

- [ ] **Step 1: Write `src/main/engine/enginePool.ts`**

```ts
import type { PositionEvaluation } from '../../shared/types'

export interface PooledEngine {
  start(): Promise<void>
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

export interface EnginePool {
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

export function poolSize(cpuCount: number): number {
  return Math.max(1, Math.min(6, cpuCount - 2))
}

export async function createEnginePool(
  size: number,
  createEngine: () => PooledEngine
): Promise<EnginePool> {
  const engines = Array.from({ length: size }, () => createEngine())
  await Promise.all(engines.map((engine) => engine.start()))

  const idle: PooledEngine[] = [...engines]
  const waiters: Array<(engine: PooledEngine) => void> = []

  function acquire(): Promise<PooledEngine> {
    const engine = idle.pop()
    if (engine) return Promise.resolve(engine)
    return new Promise((resolve) => {
      waiters.push(resolve)
    })
  }

  // Hands the released engine directly to the oldest waiter if one exists,
  // rather than returning it to `idle` first - keeps a FIFO ordering on
  // queued callers instead of first-come-first-served-by-luck.
  function release(engine: PooledEngine): void {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(engine)
      return
    }
    idle.push(engine)
  }

  return {
    async evaluatePosition(fen, options) {
      const engine = await acquire()
      try {
        return await engine.evaluatePosition(fen, options)
      } finally {
        release(engine)
      }
    },
    stop() {
      for (const engine of engines) engine.stop()
    }
  }
}
```

- [ ] **Step 2: Write `src/main/engine/enginePool.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createEnginePool, poolSize } from './enginePool'
import type { PooledEngine } from './enginePool'
import type { PositionEvaluation } from '../../shared/types'

function evalFor(cp: number): PositionEvaluation {
  return { lines: [{ depth: 1, scoreCp: cp, scoreMate: null, moveUci: 'a1a1', pv: ['a1a1'] }] }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('poolSize', () => {
  it('floors at 1 for low cpu counts', () => {
    expect(poolSize(1)).toBe(1)
    expect(poolSize(2)).toBe(1)
  })

  it('scales as cpuCount - 2', () => {
    expect(poolSize(4)).toBe(2)
    expect(poolSize(8)).toBe(6)
  })

  it('caps at 6 regardless of cpu count', () => {
    expect(poolSize(16)).toBe(6)
    expect(poolSize(32)).toBe(6)
  })
})

describe('createEnginePool', () => {
  function fakeEngine(): PooledEngine {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      evaluatePosition: vi.fn(async (fen: string) => evalFor(fen.length)),
      stop: vi.fn()
    }
  }

  it('starts every engine before resolving', async () => {
    const engines = [fakeEngine(), fakeEngine()]
    let created = 0
    await createEnginePool(2, () => engines[created++])

    expect(engines[0].start).toHaveBeenCalledTimes(1)
    expect(engines[1].start).toHaveBeenCalledTimes(1)
  })

  it('never sends more than `size` concurrent calls to the underlying engines', async () => {
    const callDeferreds: Array<{ resolve: (value: PositionEvaluation) => void }> = []

    const pool = await createEnginePool(2, () => ({
      start: async () => {},
      evaluatePosition: async () => {
        const d = deferred<PositionEvaluation>()
        callDeferreds.push(d)
        return d.promise
      },
      stop: () => {}
    }))

    const results = [
      pool.evaluatePosition('a', { depth: 1 }),
      pool.evaluatePosition('b', { depth: 1 }),
      pool.evaluatePosition('c', { depth: 1 })
    ]

    await Promise.resolve()
    await Promise.resolve()

    // Only 2 engines exist, so only 2 of the 3 calls should have reached one.
    expect(callDeferreds).toHaveLength(2)

    callDeferreds[0].resolve(evalFor(1))
    await Promise.resolve()
    await Promise.resolve()

    // Releasing an engine lets it pick up the queued third call.
    expect(callDeferreds).toHaveLength(3)

    callDeferreds[1].resolve(evalFor(2))
    callDeferreds[2].resolve(evalFor(3))

    await Promise.all(results)
  })

  it('stop() reaches every pooled engine', async () => {
    const engines = [fakeEngine(), fakeEngine(), fakeEngine()]
    let created = 0
    const pool = await createEnginePool(3, () => engines[created++])

    pool.stop()

    for (const engine of engines) expect(engine.stop).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/main/engine/enginePool.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/engine/enginePool.ts src/main/engine/enginePool.test.ts
git commit -m "Add EnginePool for parallel Stockfish evaluation"
```

---

### Task 2: `gameAnalyzer.ts` — parallel dispatch, order-preserving flush

**Files:**
- Modify: `src/main/analysis/gameAnalyzer.ts`
- Modify: `src/main/analysis/gameAnalyzer.test.ts`

**Interfaces:**
- Consumes: nothing new (still takes anything satisfying the existing `EvaluationEngine` interface — `EnginePool` from Task 1 satisfies it, but this file doesn't need to know that or import Task 1's module at all).
- Produces: `analyzeGame`'s external signature and return shape (`GameAnalysisResult | { cancelled: true }`) are unchanged — Task 3's IPC handler calls it exactly as before, just passing an `EnginePool` instead of a single `StockfishManager`.

- [ ] **Step 1: Replace `src/main/analysis/gameAnalyzer.ts` in full**

```ts
import type { AnalyzedPosition, AnalyzedMove, GameAnalysisResult, PositionEvaluation } from '../../shared/types'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import { classifyMove } from './classification'
import { isBookMove } from './openingBook'
import { moveAccuracy, gameAccuracy } from './accuracy'

export interface EvaluationEngine {
  evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number }
  ): Promise<PositionEvaluation>
}

export interface AnalyzeGameOptions {
  depth: number
  onMove?: (move: AnalyzedMove) => void
  isCancelled?: () => boolean
}

export async function analyzeGame(
  positions: AnalyzedPosition[],
  engine: EvaluationEngine,
  options: AnalyzeGameOptions
): Promise<GameAnalysisResult | { cancelled: true }> {
  if (positions.length === 0) {
    return { moves: [], whiteAccuracy: 100, blackAccuracy: 100 }
  }

  if (options.isCancelled?.()) return { cancelled: true }

  const sanHistory = positions.map((p) => p.san)
  // Every position needs its fenBefore evaluated once (as the previous
  // move's fenAfter) except the very first, which has no preceding move -
  // this list is exactly those distinct positions, in game order.
  const fens = [positions[0].fenBefore, ...positions.map((p) => p.fenAfter)]

  return new Promise<GameAnalysisResult | { cancelled: true }>((resolve, reject) => {
    const results: Array<PositionEvaluation | undefined> = new Array(fens.length)
    const moves: AnalyzedMove[] = []
    let nextToFlush = 0
    let previousEval: PositionEvaluation | undefined
    let settled = false

    // Guards against acting twice on whichever of cancellation / an error /
    // full completion happens first - later-settling evaluations for
    // positions beyond that point still resolve/reject normally (every
    // dispatched call keeps both handlers attached, so none is ever left
    // unhandled), they just have nothing left to do once this fires.
    function finishOnce(action: () => void): void {
      if (settled) return
      settled = true
      action()
    }

    function tryFlush(): void {
      if (settled) return

      while (results[nextToFlush] !== undefined) {
        if (options.isCancelled?.()) {
          finishOnce(() => resolve({ cancelled: true }))
          return
        }

        const currentEval = results[nextToFlush]!

        if (nextToFlush === 0) {
          // Index 0 is positions[0].fenBefore - the game's starting
          // position, with no move to classify yet. It only seeds
          // previousEval for the first real move's delta below.
          previousEval = currentEval
          nextToFlush++
          continue
        }

        const position = positions[nextToFlush - 1]
        const delta = computeMoveEvalDelta(previousEval!, currentEval, position.moveUci)
        const classification = classifyMove({
          cpLoss: delta.cpLoss,
          isBestMove: delta.isBestMove,
          isBookMove: isBookMove(sanHistory, position.ply),
          isPotentialSacrifice: position.isPotentialSacrifice,
          evalBeforeMoverCp: delta.evalBeforeMoverCp,
          secondBestMoverCp: delta.secondBestMoverCp
        })

        const move: AnalyzedMove = {
          ...position,
          evalBefore: previousEval!,
          evalAfter: currentEval,
          classification,
          accuracy: moveAccuracy(delta)
        }
        moves.push(move)
        options.onMove?.(move)

        previousEval = currentEval
        nextToFlush++
      }

      if (nextToFlush === fens.length) {
        const whiteAccuracy = gameAccuracy(moves.filter((m) => m.color === 'w').map((m) => m.accuracy))
        const blackAccuracy = gameAccuracy(moves.filter((m) => m.color === 'b').map((m) => m.accuracy))
        finishOnce(() => resolve({ moves, whiteAccuracy, blackAccuracy }))
      }
    }

    fens.forEach((fen, i) => {
      engine.evaluatePosition(fen, { depth: options.depth }).then(
        (evaluation) => {
          results[i] = evaluation
          tryFlush()
        },
        (err: unknown) => {
          finishOnce(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      )
    })
  })
}
```

- [ ] **Step 2: Replace `src/main/analysis/gameAnalyzer.test.ts` in full**

```ts
import { describe, it, expect } from 'vitest'
import { analyzeGame } from './gameAnalyzer'
import type { AnalyzedPosition, PositionEvaluation } from '../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E5_FEN = 'rnbqkbnr/ppp1pppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

const positions: AnalyzedPosition[] = [
  {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'e4',
    moveUci: 'e2e4',
    fenBefore: START_FEN,
    fenAfter: AFTER_E4_FEN,
    isPotentialSacrifice: false
  },
  {
    ply: 2,
    moveNumber: 1,
    color: 'b',
    san: 'e5',
    moveUci: 'e7e5',
    fenBefore: AFTER_E4_FEN,
    fenAfter: AFTER_E5_FEN,
    isPotentialSacrifice: false
  }
]

function evalFor(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

const evalsByFen: Record<string, PositionEvaluation> = {
  [START_FEN]: evalFor(30, 'e2e4'),
  [AFTER_E4_FEN]: evalFor(-25, 'e7e5'),
  [AFTER_E5_FEN]: evalFor(20, 'g1f3')
}

const fakeEngine = {
  evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
    const evaluation = evalsByFen[fen]
    if (!evaluation) throw new Error(`No fixture eval for fen: ${fen}`)
    return evaluation
  }
}

describe('analyzeGame', () => {
  it('evaluates each unique position exactly once and produces one AnalyzedMove per position', async () => {
    const seenFens: string[] = []
    const engine = {
      evaluatePosition: async (fen: string) => {
        seenFens.push(fen)
        return fakeEngine.evaluatePosition(fen)
      }
    }

    const result = await analyzeGame(positions, engine, { depth: 18 })

    expect(seenFens).toEqual([START_FEN, AFTER_E4_FEN, AFTER_E5_FEN])
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.moves).toHaveLength(2)
    expect(result.moves[0].san).toBe('e4')
    expect(result.moves[0].classification).toBe('book')
  })

  it('reports progress via onMove as each move is analyzed', async () => {
    const seenMoves: string[] = []
    await analyzeGame(positions, fakeEngine, {
      depth: 18,
      onMove: (move) => seenMoves.push(move.san)
    })
    expect(seenMoves).toEqual(['e4', 'e5'])
  })

  it('delivers moves to onMove in game order even when the engine resolves a later position before an earlier one', async () => {
    const resolvers: Record<string, (value: PositionEvaluation) => void> = {}
    const engine = {
      evaluatePosition: (fen: string) =>
        new Promise<PositionEvaluation>((resolve) => {
          resolvers[fen] = resolve
        })
    }

    const seenMoves: string[] = []
    const resultPromise = analyzeGame(positions, engine, {
      depth: 18,
      onMove: (move) => seenMoves.push(move.san)
    })

    // Let all three evaluatePosition calls get dispatched before resolving any.
    await Promise.resolve()
    await Promise.resolve()

    // Resolve out of game order: the last position first.
    resolvers[AFTER_E5_FEN](evalsByFen[AFTER_E5_FEN])
    await Promise.resolve()
    expect(seenMoves).toEqual([]) // nothing flushed yet - fen0/fen1 still pending

    resolvers[START_FEN](evalsByFen[START_FEN])
    resolvers[AFTER_E4_FEN](evalsByFen[AFTER_E4_FEN])

    const result = await resultPromise
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(seenMoves).toEqual(['e4', 'e5'])
    expect(result.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
  })

  it('rejects the whole analysis if any single position fails to evaluate', async () => {
    const failingEngine = {
      evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
        if (fen === AFTER_E4_FEN) throw new Error('engine crashed')
        return fakeEngine.evaluatePosition(fen)
      }
    }

    await expect(analyzeGame(positions, failingEngine, { depth: 18 })).rejects.toThrow('engine crashed')
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    const result = await analyzeGame(positions, fakeEngine, {
      depth: 18,
      isCancelled: () => true
    })
    expect(result).toEqual({ cancelled: true })
  })

  it('returns 100% accuracy for an empty game', async () => {
    const result = await analyzeGame([], fakeEngine, { depth: 18 })
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.whiteAccuracy).toBe(100)
    expect(result.blackAccuracy).toBe(100)
  })

  it('does not throw when a terminal position (checkmate/stalemate) yields an empty lines array', async () => {
    // Regression test for the crash on games ending in checkmate/stalemate:
    // a buggy or degenerate engine implementation could still hand back
    // `{ lines: [] }` for a terminal position (e.g. a future regression, or
    // a fixture standing in for one). analyzeGame must not throw -- it
    // should produce a sensible, non-throwing result instead of crashing
    // the whole analysis on the last move of a decisive game.
    const emptyLinesEngine = {
      evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
        if (fen === AFTER_E5_FEN) return { lines: [] }
        return fakeEngine.evaluatePosition(fen)
      }
    }

    const result = await analyzeGame(positions, emptyLinesEngine, { depth: 18 })

    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.moves).toHaveLength(2)
    expect(result.moves[1].san).toBe('e5')
    // No throw, and the move still produced a finite, well-formed evaluation.
    expect(Number.isFinite(result.moves[1].accuracy)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the tests**

```bash
npx vitest run src/main/analysis/gameAnalyzer.test.ts
```

Expected: all 8 tests pass (the original 6 plus the 2 new ones).

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/analysis/gameAnalyzer.ts src/main/analysis/gameAnalyzer.test.ts
git commit -m "Parallelize game analysis dispatch with order-preserving flush"
```

---

### Task 3: Wire `EnginePool` into the `analyzeGame` IPC handler

**Files:**
- Modify: `src/main/ipc/handlers.ts`

**Interfaces:**
- Consumes: `createEnginePool`, `poolSize`, `EnginePool` (Task 1, `src/main/engine/enginePool.ts`); `analyzeGame` (Task 2, unchanged signature).
- Produces: nothing further consumes this — it's the top of the stack for this sub-project.

- [ ] **Step 1: Add imports to `src/main/ipc/handlers.ts`**

Add near the top, alongside the existing `node:fs/promises` import:

```ts
import { cpus } from 'node:os'
```

Add alongside the existing engine imports:

```ts
import { createEnginePool, poolSize } from '../engine/enginePool'
import type { EnginePool } from '../engine/enginePool'
```

- [ ] **Step 2: Replace the `analyzeGame` handler body**

Replace the existing handler (the `ipcMain.handle(IPC_CHANNELS.analyzeGame, ...)` block) with:

```ts
  ipcMain.handle(
    IPC_CHANNELS.analyzeGame,
    async (_event, positions: AnalyzedPosition[], depth: number) => {
      const runId = analysisRuns.start()

      // The whole handler body runs under a single top-level try/finally so
      // that analysisRuns.finish(runId) always runs once the run has
      // settled -- including when pool startup itself throws (e.g. the
      // Stockfish binary is missing) -- otherwise the run's entry lingers
      // forever in AnalysisRunTracker's internal map.
      try {
        let pool: EnginePool
        try {
          pool = await createEnginePool(poolSize(cpus().length), () => new StockfishManager(getStockfishBinaryPath()))
        } catch (err) {
          return { error: `Could not start Stockfish: ${(err as Error).message}` }
        }

        try {
          return await analyzeGame(positions, pool, {
            depth: depth || ANALYSIS_DEPTH_DEFAULT,
            isCancelled: () => analysisRuns.isCancelled(runId),
            onMove: (move) => {
              getWindow()?.webContents.send(IPC_CHANNELS.analysisProgress, move)
            }
          })
        } catch (err) {
          return { error: `Analysis failed: ${(err as Error).message}` }
        } finally {
          pool.stop()
        }
      } finally {
        analysisRuns.finish(runId)
      }
    }
  )
```

This is a direct swap: `new StockfishManager(...)` + `await engine.start()` (two steps, today) becomes `await createEnginePool(...)` (one step, since `createEnginePool` starts every engine internally before resolving) — the same nested try/catch shape is preserved so a startup failure still produces the identical `{ error: 'Could not start Stockfish: ...' }` message, and `engine.stop()` becomes `pool.stop()` in the same `finally` position.

- [ ] **Step 3: Typecheck and run the full suite**

```bash
npm run verify
```

Expected: typecheck clean, all tests pass (this task adds no new test files — same total as Task 2 left it, since this repo doesn't unit-test `handlers.ts` directly; see `src/main/ipc/analysisRunTracker.test.ts` for the one exception, which is unaffected by this change).

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 5: Verify via `run-desktop`**

Real Stockfish processes and real timing can only be confirmed against the built app, not fakes. Drive a full game analysis and confirm it completes correctly with multiple engine processes actually running concurrently.

```bash
cat > /tmp/verify-engine-pool.txt <<'EOF'
launch
click-text Analyze
sleep 500
ss engine-pool-import-screen
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-engine-pool.txt
```

Load a real game via whichever import path the `import-screen` screenshot shows available (PGN paste, file, or a linked chess.com account's game list — use what's actually on screen rather than assuming one path). Once analysis starts, in a separate terminal, confirm multiple Stockfish processes are actually running concurrently:

```bash
watch -n 0.5 'pgrep -af stockfish | wc -l'
```

Expected: while analysis is in progress, the process count briefly rises above 1 (bounded by `poolSize(cpus().length)` for this machine — 6 on a 16-core machine, per the Global Constraints formula) rather than staying at a constant 1 throughout, confirming real parallel dispatch rather than just faster sequential calls. Then drive the rest of the flow:

```bash
cat > /tmp/verify-engine-pool-2.txt <<'EOF'
launch
click-text Analyze
sleep 500
ss engine-pool-after-load
sleep 15000
ss engine-pool-after-analysis
eval document.querySelector('.analysis-progress')
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-engine-pool-2.txt
```

Adjust the middle `sleep` duration based on how long the loaded game actually takes to finish (check `engine-pool-after-load`'s progress text, and re-run with a longer sleep if analysis is still running in `engine-pool-after-analysis`). Expected: the analysis completes without error, the eval board/move list/eval graph render with real classifications (spot-check a couple of moves' classifications look sane, e.g. not everything showing as the same classification), and `document.querySelector('.analysis-progress')` is `null` once done (the progress bar is gone, replaced by the completed board view). Also verify cancellation still works: reload a fresh game, click Cancel partway through, and confirm the UI shows the cancelled state promptly (comparable responsiveness to before this change — no new multi-second delay).

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-engine-pool.txt /tmp/verify-engine-pool-2.txt
git add src/main/ipc/handlers.ts
git commit -m "Use a parallel engine pool for full-game analysis"
```

## Testing

Tasks 1 and 2 have real unit tests for every pure/mockable unit (`enginePool.ts`'s pool mechanics and `poolSize` sizing, `gameAnalyzer.ts`'s order-preserving flush under both in-order and out-of-order resolution, cancellation, and error propagation) — 12 new/changed tests total. Task 3's IPC wiring is verified via `run-desktop` against the real built app with real Stockfish processes, matching this codebase's existing convention of not unit-testing `handlers.ts` directly.

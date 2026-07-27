# Analyze tab engine pool — design

## Problem

Full-game analysis (`analyzeGame` in `src/main/analysis/gameAnalyzer.ts`) evaluates one position at a time against a single `StockfishManager` process, awaiting each `evaluatePosition` call before starting the next. For a typical 40-80 ply game at depth 18, that's 40-80+ sequential engine calls run back-to-back — the entire wall-clock cost is additive with no parallelism at all, even on machines with many idle cores.

## Scope

This spec covers full-game analysis only (the Analyze tab's `analyzeGame` IPC call and the code path underneath it). It does not touch single-position evaluation (`evaluateExplorationPosition`, used by variation exploration) — that's already a one-at-a-time, on-demand use case with nothing to parallelize. It does not change analysis depth (kept at 18, unchanged accuracy) or add any new settings UI — pool size is computed automatically from CPU count, not user-configurable.

## 1. Correctness precondition

Each move's classification depends only on that move's own `evalBefore`/`evalAfter` (confirmed in `src/shared/engineMath.ts`'s `computeMoveEvalDelta`) plus book-move history (pure, `chess.js`-only, no engine dependency). No move's result depends on any other move's evaluation. This means the M+1 distinct positions in a game (`positions[0].fenBefore` plus every position's `fenAfter`) can be evaluated in any order, including concurrently, with zero change to the resulting classifications, accuracy, or move data — only the wall-clock time to obtain them changes.

A single `StockfishManager` instance cannot safely serve two concurrent `evaluatePosition` calls (its `pendingLineHandlers` array has no per-call request identity — a `bestmove` line from one call could resolve a handler still waiting on a different call, silently cross-contaminating results; this exact hazard is already documented in `src/main/engine/explorationEngine.ts`'s comments for the single shared exploration engine). Parallelism therefore requires multiple engine *processes*, not concurrent calls into one.

## 2. `EnginePool` (`src/main/engine/enginePool.ts`)

```ts
export interface PooledEngine {
  start(): Promise<void>
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

export interface EnginePool {
  evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>
  stop(): void
}

export function poolSize(cpuCount: number): number

export async function createEnginePool(size: number, createEngine: () => PooledEngine): Promise<EnginePool>
```

- `poolSize(cpuCount)` = `Math.max(1, Math.min(6, cpuCount - 2))` — scales with available cores, leaves 2 free for the OS/renderer, caps at 6 regardless of core count (diminishing returns beyond that for typical game lengths, and bounded memory/process overhead).
- `createEnginePool` spawns `size` engines via the injected `createEngine` factory (decoupled from `StockfishManager` directly, so it's testable with fake engines — mirrors `gameAnalyzer.test.ts`'s existing `fakeEngine` pattern), starts them all in parallel (`Promise.all`), and returns a pool that internally tracks idle engines and a FIFO wait queue: `evaluatePosition` assigns an idle engine immediately if one exists, or queues the call until one is released. This guarantees no engine ever serves two calls at once, without any caller needing to know the pool has a concurrency limit at all.
- `stop()` calls `stop()` on every pooled engine, immediately killing all processes.
- `handlers.ts`'s `analyzeGame` handler constructs the pool via `createEnginePool(poolSize(cpus().length), () => new StockfishManager(getStockfishBinaryPath()))` in place of today's single `new StockfishManager(...)`, and its existing `finally { engine.stop() }` becomes `finally { pool.stop() }`. If any pooled engine's `start()` rejects (e.g. missing binary), `Promise.all` rejects and the handler's existing `catch` around engine startup returns the same `{ error: 'Could not start Stockfish: ...' }` shape as today — no new error handling needed there.

## 3. `gameAnalyzer.ts`: parallel dispatch, order-preserving flush

Replace the sequential `for` loop with:

1. Build `fens = [positions[0].fenBefore, ...positions.map(p => p.fenAfter)]` (length `positions.length + 1`; the existing empty-game fast path — `positions.length === 0` returns `{ moves: [], whiteAccuracy: 100, blackAccuracy: 100 }` immediately without touching the engine — is unchanged).
2. Dispatch `engine.evaluatePosition(fen, { depth })` for every entry in `fens` immediately (the pool internally throttles actual concurrency to its size).
3. Every dispatched call gets both a fulfillment and rejection handler attached at dispatch time (never left unhandled, regardless of whether the run later cancels or errors before that particular call settles) that store the result (or record an error) at that index and attempt to flush.
4. A flush walk holds a `nextToFlush` cursor. Whenever the result at that index is available, and `isCancelled()` is false, it computes that move's delta/classification exactly as today (same `computeMoveEvalDelta`/`classifyMove`/`moveAccuracy` calls, same `onMove` callback, same accumulation into `moves`) and advances the cursor — repeating for as many consecutive indices as are already available. This is what preserves the current progressive "moves fill in as computed" UI and identical per-move results, even though the underlying evaluations may complete out of order.
5. The overall call resolves to `{ cancelled: true }` the first time the flush walk finds `isCancelled()` true (checked at the same per-move granularity as today), resolves to the final `GameAnalysisResult` (with `whiteAccuracy`/`blackAccuracy` computed the same way as today) once the cursor reaches the end, or rejects with the first evaluation error encountered — whichever happens first. A small `finishOnce` guard ensures only the first of these three outcomes is ever acted on; later-settling promises for positions beyond that point become no-ops (their handlers still ran, so nothing is left unhandled — they just have nothing left to do).

**Accepted tradeoff:** since all positions are dispatched up front for maximum parallelism, cancellation can no longer prevent already-in-flight engine work from *starting* the way today's per-iteration check does — it only stops the run from *using* further results. In practice this is bounded by the pool size (at most a handful of positions' worth of already-dispatched search), and `pool.stop()` (called in the IPC handler's `finally`, which runs immediately after `analyzeGame` returns) kills those processes right away regardless. User-visible cancellation latency is expected to be at least as fast as today, not slower.

## 4. Testing

- `enginePool.test.ts`: fake `PooledEngine` objects (simple objects with `start`/`evaluatePosition`/`stop`, no real process spawning) verify: never more than `size` concurrent calls reach the underlying engines (a call issued while all are busy waits until one is released), a released engine immediately picks up the next queued call, and `stop()` reaches every pooled engine exactly once. `poolSize` gets direct unit tests across a range of CPU counts (1, 2, 4, 8, 16, 32) confirming the floor of 1, the `cpuCount - 2` scaling, and the cap at 6.
- `gameAnalyzer.test.ts`: existing cases (evaluates each unique position once, reports progress via `onMove`, cancellation, empty game, terminal-position empty-lines handling) must all still pass unchanged — same assertions, same expected results, now exercised against the new dispatch path. New cases: results are delivered to `onMove` in game order even when a fake engine's `evaluatePosition` intentionally resolves a *later* position before an *earlier* one (using explicit deferred promises to control resolution order in the test); an evaluation error on any one position causes the whole call to reject/error, matching today's all-or-nothing failure behavior, even when other positions' evaluations already succeeded.

## Out of scope

- Any change to analysis depth, MultiPV, or accuracy (unchanged from today).
- A settings UI for engine concurrency (auto-computed, not user-facing).
- Parallelizing single-position exploration evaluation (`evaluateExplorationPosition`) — already a fast, on-demand single-call path.
- Recovering from a single pooled engine crashing mid-run — still aborts the whole analysis with an error, matching today's behavior for any engine failure.

# Variation Exploration — Design Spec

Date: 2026-07-25

## Purpose

Sub-project 4 (final) of the performance/polish initiative. The
Analyze board is currently pure read-only replay (`allowDragging: false`
in `Board.tsx`, no move-input handling at all) — it can only show the
positions from the one recorded, already-analyzed game. This spec adds
the ability to move pieces off that recorded line to explore "what if"
positions, with a live (but shallow/fast) engine evaluation of wherever
the user has moved to.

Scope decisions already made with the user before this spec: live eval
yes (not just silent piece-moving), both drag-and-drop and click-to-move
(not drag only — this is a desktop app with no touch input, so both are
mouse-driven), and the `F` key to flip board orientation folds in here
since it touches the same file.

## Non-goals

- No branching move-list UI, no PGN tree, no persisting explored lines.
  Exploration is ephemeral scratch state: leave it (by navigating the
  real game in any way) and it's gone. The recorded game's move list,
  eval graph, accuracy scores, and classifications are never modified by
  exploration and never show anything about it.
- No move classification (brilliant/blunder/etc.) of explored moves —
  that requires the same expensive before/after engine comparison the
  real game's analysis already does; a live eval number of the resulting
  position is the actual ask, not full classification.
- No pawn-promotion piece picker — promotion auto-queens. The
  overwhelming majority of promotions are to queen anyway, and a
  picker UI is real added scope for a rare case in a scratch-exploration
  feature.
- No legal-move-dot highlighting on candidate destination squares. A
  real, reasonable future addition, but not necessary for the feature to
  be usable — illegal attempts are simply rejected (piece snaps back).
- `Space` to hide engine assistance (from the original brainstorm) was
  explicitly not selected for this pass — only `F` (flip board).

## Architecture

```
User drags/clicks a piece
  -> Board.tsx validates + attempts the move via useVariationExplorer's makeMove()
  -> makeMove() validates legality with chess.js against the current
     scratch (or, before the first scratch move, real-game) position
  -> on success: pushes the new FEN onto an in-memory scratch stack
     (isExploring becomes true the moment this stack is non-empty)
  -> a useEffect fires an evaluatePosition IPC call for the new FEN
  -> main process reuses a persistent Stockfish instance (spawned once,
     lazily, on first use - NOT a fresh process per move, which would
     add real per-move latency) to evaluate at a shallow depth (12, vs.
     the recorded game's 18 - live feedback favors speed over precision)
  -> result flows back, EvalBar shows it in place of the recorded eval
Any real-game navigation (arrow keys, clicking a move-list row, clicking
the eval graph) resets the scratch stack back to empty - exploration
never survives a real navigation action.
```

### Main process

New `src/main/engine/explorationEngine.ts`: a lazily-started, persistent
`StockfishManager` instance, reused across every `evaluatePosition` call
in a session rather than spawned fresh each time:

```ts
import { StockfishManager } from './stockfishManager'
import { getStockfishBinaryPath } from './stockfishPath'
import type { PositionEvaluation } from '../../shared/types'

let engine: StockfishManager | null = null
let starting: Promise<StockfishManager> | null = null

async function getEngine(): Promise<StockfishManager> {
  if (engine) return engine
  if (!starting) {
    starting = (async () => {
      const instance = new StockfishManager(getStockfishBinaryPath())
      await instance.start()
      engine = instance
      return instance
    })()
  }
  return starting
}

export async function evaluateExplorationPosition(
  fen: string,
  depth: number
): Promise<PositionEvaluation | { error: string }> {
  try {
    const instance = await getEngine()
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
```

`src/main/index.ts`'s existing `window-all-closed` handler gets a
`stopExplorationEngine()` call so the persistent process doesn't outlive
the app.

**Revision (caught during Task 1's own review, before Task 2 was built
on top of this interface):** `evaluateExplorationPosition` also
serializes calls against the shared engine via an internal promise
queue. `StockfishManager`'s `pendingLineHandlers` has no per-call
request identity — two genuinely concurrent `evaluatePosition` calls
against the same instance could resolve off a single incoming
`bestmove` line with cross-contaminated `info`-line data, not merely
race on which result is newer. The hook's request-id guard (below)
prevents a stale result from overwriting a newer one in the UI, but
does not prevent two calls from executing at once in the first place —
that has to be prevented at the layer that owns the shared engine.

New IPC channel `evaluatePosition: 'engine:evaluate-position'`
(`src/shared/ipc.ts`), handler in `src/main/ipc/handlers.ts`:
```ts
ipcMain.handle(IPC_CHANNELS.evaluatePosition, async (_event, fen: string, depth: number) => {
  return evaluateExplorationPosition(fen, depth)
})
```
`src/preload/index.ts`: `evaluatePosition: (fen, depth) =>
ipcRenderer.invoke(IPC_CHANNELS.evaluatePosition, fen, depth)`.
`ChessAPI.evaluatePosition(fen: string, depth: number): Promise<PositionEvaluation | { error: string }>`
added to `src/shared/types.ts`, matching the existing `T | { error:
string }` union convention used by `fetchChessComStats` etc.

### Renderer — pure logic

New `src/renderer/src/lib/tryMove.ts`, pure and unit-testable (chess.js
is already a renderer-side dependency, used today in
`lib/moveDetail.ts`):
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
chess.js v1's `.move()` throws on an illegal move rather than returning
`null` (confirmed against the version pinned in this repo,
`"chess.js": "^1.4.0"`) - the `try/catch` is required, not defensive
decoration.

### Renderer — `useVariationExplorer` hook

New `src/renderer/src/hooks/useVariationExplorer.ts`, given the
real-game's FEN at the currently-viewed ply (`baseFen`) as input:

```ts
export function useVariationExplorer(baseFen: string): {
  isExploring: boolean
  currentFen: string
  sideToMove: 'w' | 'b'
  evaluation: PositionEvaluation | null
  isEvaluating: boolean
  makeMove: (from: string, to: string) => boolean
  undoLastMove: () => void
  exitExploration: () => void
}
```

Internals: a `scratchHistory: string[]` (FEN stack, empty = not
exploring). `currentFen` is the stack's top, or `baseFen` if empty.
`sideToMove` is derived by splitting `currentFen`'s second field (no new
dependency for something chess.js's own FEN output already encodes
positionally). A `useEffect` keyed on `baseFen` clears the stack
whenever it changes - this is what makes "any real navigation exits
exploration" work, since `baseFen` only ever changes via real
navigation, never as a side effect of the hook's own scratch moves. A
second `useEffect` keyed on `[currentFen, isExploring]` fires the
`evaluatePosition` IPC call whenever exploring, guarded by a request-id
ref so a stale response from an earlier position (superseded by a
newer move before the engine replied) is discarded rather than
overwriting a newer result - a real race given the engine calls aren't
instant and a user can move again before one resolves.

`makeMove(from, to)` calls `tryMove(currentFen, from, to)`; on success
pushes the resulting FEN and returns `true`, on failure (illegal move)
returns `false` and the board snaps back (Board.tsx's `onPieceDrop`
returns this same boolean straight through, which is exactly what
react-chessboard's own drop-rejection mechanism expects).

### Board.tsx — move input

`allowDragging: true` (from `false`). New prop: `onMove: (from: string,
to: string) => boolean`. No separate "is this interactive" flag needed -
`Board` is already only ever rendered by `App` once a game is loaded
(gated on `state.status === 'analyzing' || 'done'` with moves present),
so there's no state where it's on-screen but shouldn't accept input.

- **Drag**: react-chessboard's real `onPieceDrop({ sourceSquare,
  targetSquare })` (confirmed against the installed v5 type
  definitions - this project was not previously using this prop at
  all). Returns `onMove(sourceSquare, targetSquare)`'s boolean directly
  (a `null` `targetSquare`, e.g. dropped off-board, short-circuits to
  `false` without calling `onMove`).
- **Click-to-move**: react-chessboard v5 has no built-in click-to-move -
  confirmed by reading its actual type definitions, not assumed. Built
  by hand with `onSquareClick({ piece, square })` and one new piece of
  local state, `selectedSquare: string | null`: clicking a square with a
  piece and no prior selection selects it; clicking a second square
  attempts `onMove(selectedSquare, square)` and clears the selection
  regardless of success/failure; clicking the same piece again or an
  empty square with nothing selected does nothing.
- `canDragPiece` restricts lifting to pieces whose color matches whose
  turn it actually is in the current (possibly scratch) position -
  derived the same way `sideToMove` is in the hook, so the opponent's
  pieces don't respond to drag attempts at all (matching ordinary chess
  UI behavior), rather than allowing the lift and rejecting on drop.
- Selected-square highlight via react-chessboard's existing
  `squareStyles` prop (already typed and available - no new mechanism).
- `F` key: a new `boardOrientation` state lifted to `App.tsx` (was a
  hardcoded literal `'white'` in `Board.tsx`), flipped by a keydown
  handler alongside the existing arrow/Home/End handler already in
  `App.tsx`.

### App.tsx / UI

`Board` receives `fen={explorer.currentFen}` (not the real game's
`position.fen` directly - this is what makes the displayed board follow
scratch moves) and, while exploring,
`bestMoveUci={null}`/`currentMove={null}` instead of the real game's
values (the best-move arrow and move-classification badge describe the
*recorded* move at this ply, which is actively misleading once the
user has deviated from it - computed in `App.tsx`, not inside `Board`,
consistent with `Board` staying a presentational component).

`EvalBar` shows `explorer.evaluation` (via the same existing
`whiteWinPercent`/`formatScore` functions from `lib/displayEval.ts` -
no new formatting logic, they already take a `PositionEvaluation` +
`sideToMove` and this is exactly that shape) instead of the recorded
position's eval while `isExploring` is true.

New `src/renderer/src/components/ExploringBanner.tsx`, replacing
`MoveDetail` in `App.tsx`'s JSX (not merged into `MoveDetail` itself -
different concern, `MoveDetail` stays focused on describing a real
recorded move) whenever `explorer.isExploring` is true:
```
Exploring a variation                    [eval, live] [Undo] [Back to game]
```
`Undo` calls `undoLastMove()`; `Back to game` calls `exitExploration()`.

## Error handling

- An illegal drag/click attempt: `makeMove` returns `false`, the piece
  visually snaps back (react-chessboard's own behavior when
  `onPieceDrop` returns `false`), no error surfaced - this is normal,
  expected interaction, not a failure state.
- `evaluatePosition` IPC failure (engine crashed, binary missing):
  the hook's effect receives `{ error: string }`, leaves `evaluation`
  as its previous value rather than clearing it (a stale-but-real eval
  is more useful than blanking the bar), and `isEvaluating` still
  resolves to `false` so the UI doesn't spin forever. Not separately
  surfaced as a visible error banner - matches this app's existing
  precedent of swallowing this exact class of failure quietly (the
  wishlist welcome-email function's Resend-call failure handling, and
  this same codebase's own `evaluatePosition` callers already treating
  engine hiccups as logged-not-surfaced).

## Testing

- `src/renderer/src/lib/tryMove.test.ts` (new): pure function, real
  chess.js, no mocking needed - legal move returns the new FEN, illegal
  move returns `null`, promotion auto-queens, moving from an empty
  square or as the wrong side to move both return `null`.
- `src/main/engine/explorationEngine.test.ts` (new): using the exact
  same fake-child-process pattern already established in
  `stockfishManager.test.ts` (`StockfishManager`'s injectable `spawnFn`
  constructor argument) - asserts that two `evaluateExplorationPosition`
  calls reuse one engine instance (spawn happens once, not twice), and
  that a thrown error resets the cached instance so the next call
  starts a fresh process rather than retrying a dead one forever.
- No new renderer-component-render tests (same reasoning as
  sub-projects 1-3: this codebase deliberately has no
  `@testing-library/react`/jsdom setup, and this spec doesn't change
  that calculus). `Board.tsx`'s drag/click wiring and the full
  App-level integration (banner appearing, EvalBar switching, F-key
  flip, exit-on-navigation) are verified via `run-desktop`, driving the
  actual built app.

## Future ideas (explicitly deferred)

- Legal-move-dot highlighting on candidate destinations.
- A promotion-piece picker instead of auto-queen.
- Persisting/branching explored lines into a real PGN variation tree.
- `Space` to hide engine assistance (from the original brainstorm,
  explicitly not selected for this pass).

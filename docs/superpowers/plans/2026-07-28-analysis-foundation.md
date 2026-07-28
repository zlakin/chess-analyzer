# Analysis Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make move classification and accuracy agree on a single unit (win probability), replace the broken sacrifice heuristic with real static exchange evaluation, and size every Stockfish process to the hardware it runs on — without destroying any cached user data.

**Architecture:** Classification moves from raw centipawn loss to win-percent loss, calibrated so behaviour at an evaluation of 0 is unchanged. A new pure `see.ts` module supplies the material judgement that `brilliant` needs. Accuracy aggregation adopts Lichess's published volatility-weighted method. On the engine side, `StockfishManager` gains `Threads`/`Hash` configuration, the Insights scan moves onto the existing `EnginePool`, and the download script picks a CPU-matched build with a `uci` smoke test as its safety net.

**Tech Stack:** TypeScript, Electron 43, React 19, `chess.js@1.4.0`, Vitest 4, Stockfish 18 (UCI over stdio).

Spec: `docs/superpowers/specs/2026-07-28-analysis-foundation-design.md`

## Global Constraints

- Base commit: `81267b8`. Working tree was clean at plan time.
- The suite is **350 tests across 48 files, all passing**, and `npm run typecheck` (`tsc -b`) is clean. Every task must end in that state or better.
- `npm run verify` runs typecheck + tests. Use it before every commit.
- Do not add dependencies. `chess.js@1.4.0`, already present, has everything needed.
- Never use `npm install` without `--legacy-peer-deps` (enforced by the committed `.npmrc`).
- Match the surrounding comment style: this codebase explains *why* a non-obvious guard exists, in full sentences, and those comments are load-bearing. Do not strip them.
- Piece values in centipawns, used consistently in new code: `p 100, n 320, b 330, r 500, q 900, k 20000`.
- Verified chess.js behaviour this plan relies on (probed directly, do not re-litigate):
  - `attackers(square, color)` is geometric and ignores whose turn it is.
  - It reports defenders of a square that is *occupied*, including by the enemy.
  - It returns `[]` for a piece attacking the square it stands on — this is what makes the illegal-king-recapture check work.
  - X-rays resolve correctly when you `remove()` the front piece and re-query.
  - `remove()` / `put()` work on positions that are not legally reachable.
  - `new Chess(fen)` **throws** if a king is missing. Never `remove()` a king.

---

### Task 1: Win probability in `engineMath`

**Files:**
- Modify: `src/shared/engineMath.ts`
- Test: `src/shared/engineMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `winPercent(line: EngineLine): number`; `MoveEvalDelta` gains `winPercentLoss: number`; `BEST_MOVE_WIN_PERCENT_TOLERANCE = 0.2`.

**Why the ordering matters:** `isBestMove` must be computed *after* the raw win-percent loss, because Task 1 widens `isBestMove` to accept a move that ties the top line. Computing `winPercentLoss` as `isBestMove ? 0 : raw` before deciding `isBestMove` would be circular.

**The empty-`lines` trap:** `engineMath.test.ts` has a defence-in-depth test where `evalBefore.lines` is `[]` and asserts `isBestMove === false`. With an empty `lines`, `evalBeforeMoverCp` falls back to `0`, which is meaningless — and the raw loss would compute as `0`, flipping `isBestMove` to `true` and breaking that test. Gate the tolerance path on `evalBefore.lines.length > 0`.

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/engineMath.test.ts` (and add `winPercent` to the import on line 2):

```ts
describe('winPercent', () => {
  it('matches cpToWinPercent for a normal centipawn score', () => {
    expect(winPercent(line({ scoreCp: 150, scoreMate: null }))).toBeCloseTo(cpToWinPercent(150), 5)
  })

  it('saturates to 100 for any mate for the side to move', () => {
    expect(winPercent(line({ scoreCp: null, scoreMate: 1 }))).toBe(100)
    expect(winPercent(line({ scoreCp: null, scoreMate: 12 }))).toBe(100)
  })

  it('saturates to 0 for any mate against the side to move', () => {
    expect(winPercent(line({ scoreCp: null, scoreMate: -1 }))).toBe(0)
    expect(winPercent(line({ scoreCp: null, scoreMate: 0 }))).toBe(0)
  })
})

describe('computeMoveEvalDelta win percent loss', () => {
  it('reports a tiny win-percent loss for a big centipawn drop in a decided position', () => {
    // The defect this whole change exists to fix: +2000 -> +1500 is a
    // cpLoss of 500 but barely moves the win probability at all.
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 2000, moveUci: 'a1a2' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -1500, moveUci: 'h8h7' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'b1b2')

    expect(delta.cpLoss).toBe(500)
    expect(delta.winPercentLoss).toBeLessThan(1)
  })

  it('reports no win-percent loss for trading one forced mate for a longer one', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: null, scoreMate: 3, moveUci: 'a1a2' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: null, scoreMate: -8, moveUci: 'h8h7' })] }

    expect(computeMoveEvalDelta(evalBefore, evalAfter, 'b1b2').winPercentLoss).toBe(0)
  })

  it('treats a move that ties the top line as best', () => {
    const evalBefore: PositionEvaluation = {
      lines: [line({ scoreCp: 30, moveUci: 'e2e4' }), line({ scoreCp: 30, moveUci: 'd2d4' })]
    }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -30, moveUci: 'e7e5' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'd2d4')

    expect(delta.isBestMove).toBe(true)
    expect(delta.cpLoss).toBe(0)
  })

  it('does not treat a clearly inferior move as best', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 40, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: 60, moveUci: 'a7a6' })] }

    expect(computeMoveEvalDelta(evalBefore, evalAfter, 'a2a3').isBestMove).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/engineMath.test.ts`
Expected: FAIL — `winPercent is not a function`, and `winPercentLoss` is `undefined`.

- [ ] **Step 3: Implement**

In `src/shared/engineMath.ts`, add after `cpToWinPercent`:

```ts
// A mate score is a certainty, not an amount of material. Running it through
// cpToWinPercent's logistic curve via effectiveCp's +/-100000 ramp makes
// "mate in 3" and "mate in 8" look 500 centipawns apart, which then reads as
// a blunder. Saturating instead makes any two mating lines identical, which
// is what they are: both won.
export function winPercent(line: EngineLine): number {
  if (line.scoreMate !== null) return line.scoreMate > 0 ? 100 : 0
  return cpToWinPercent(line.scoreCp ?? 0)
}

// A move whose win probability is indistinguishable from the engine's top
// choice is best, even when Stockfish happened to name a different move --
// exact UCI equality demotes a genuine tie to "excellent".
export const BEST_MOVE_WIN_PERCENT_TOLERANCE = 0.2
```

Add `winPercentLoss: number` to the `MoveEvalDelta` interface, then replace the body of `computeMoveEvalDelta` below the three `effectiveCp` assignments:

```ts
  const winPercentBefore = winPercent(bestLineBefore)
  const winPercentAfter = 100 - winPercent(bestLineAfter)
  const rawWinPercentLoss = Math.max(0, winPercentBefore - winPercentAfter)

  // The tolerance is only meaningful when evalBefore actually produced a
  // line. With an empty `lines` array the fallback puts both sides at 0,
  // making the raw loss 0 and every move look best -- so require a real
  // line before letting the tolerance widen isBestMove.
  const hasBeforeLine = evalBefore.lines.length > 0
  const isBestMove =
    bestLineBefore.moveUci === playedMoveUci ||
    (hasBeforeLine && rawWinPercentLoss <= BEST_MOVE_WIN_PERCENT_TOLERANCE)

  return {
    cpLoss: isBestMove ? 0 : Math.max(0, evalBeforeMoverCp - evalAfterMoverCp),
    winPercentLoss: isBestMove ? 0 : rawWinPercentLoss,
    evalBeforeMoverCp,
    evalAfterMoverCp,
    secondBestMoverCp,
    isBestMove
  }
```

Note `winPercentAfter` is `100 - winPercent(bestLineAfter)`: `evalAfter` is scored from the *opponent's* perspective, mirroring the existing `evalAfterMoverCp = -effectiveCp(bestLineAfter)`.

- [ ] **Step 4: Run the full suite**

Run: `npm run verify`
Expected: PASS. If `engineMath.test.ts`'s existing empty-`lines` test fails, the `hasBeforeLine` guard is missing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/engineMath.ts src/shared/engineMath.test.ts
git commit -m "Add win-probability loss to the move eval delta"
```

---

### Task 2: Static exchange evaluation

**Files:**
- Create: `src/shared/analysis/see.ts`
- Test: `src/shared/analysis/see.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `staticExchangeEval(fen: string, from: Square, to: Square): number` — centipawns won (positive) or lost (negative) by the side making the move, assuming both sides continue capturing on `to` with their least valuable attacker. Also exports `SEE_PIECE_VALUES: Record<PieceSymbol, number>`.

This is the most intricate task in the plan and the one most worth testing hard. It is a pure function with no I/O.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/analysis/see.test.ts`:

Every expected value below was verified against a working prototype of the
exact implementation in Step 3. They are exact, not approximate — if one
fails, the implementation is wrong, not the fixture.

```ts
import { describe, it, expect } from 'vitest'
import { staticExchangeEval } from './see'

describe('staticExchangeEval', () => {
  it('is zero for a quiet move to an unattacked square', () => {
    expect(staticExchangeEval('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2', 'e3')).toBe(0)
  })

  it('wins a full pawn when capturing an undefended pawn', () => {
    // White pawn d4 takes the undefended black pawn on e5.
    expect(staticExchangeEval('4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1', 'd4', 'e5')).toBe(100)
  })

  it('is zero for an even pawn trade', () => {
    // dxe5 is met by fxe5 (the f6 pawn defends e5): a pawn for a pawn.
    expect(staticExchangeEval('4k3/8/5p2/4p3/3P4/8/8/4K3 w - - 0 1', 'd4', 'e5')).toBe(0)
  })

  it('is sharply negative when a queen takes a pawn defended by a pawn', () => {
    // Qxe5 fxe5: wins 100, loses 900.
    expect(staticExchangeEval('4k3/8/5p2/4p3/8/8/3Q4/4K3 w - - 0 1', 'd2', 'e5')).toBe(-800)
  })

  it('does NOT treat a pawn push to a defended square as a sacrifice (the core bug)', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 -- a6's destination is attacked by the
    // bishop on b5, which the old heuristic called a potential sacrifice
    // because `capturedValue < movedValue` is `0 < 1` for every pawn move.
    // Nothing is captured and nothing hangs, so SEE is 0.
    const beforeA6 = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
    expect(staticExchangeEval(beforeA6, 'a7', 'a6')).toBe(0)
  })

  it('finds the x-ray attacker behind the front rook', () => {
    // Doubled white rooks d1+d2 vs a black pawn d7 defended by a rook on d8.
    // Rxd7 Rxd7 Rxd7 -- the second white rook is only reachable once the
    // first has left d2, which is what re-querying attackers() buys.
    expect(staticExchangeEval('3r3k/3p4/8/8/8/8/3R4/3R1K2 w - - 0 1', 'd2', 'd7')).toBe(100)
  })

  it('loses material in the same position without the x-ray rook', () => {
    // Identical, minus the rook on d1: now Rxd7 Rxd7 just drops the exchange.
    // The contrast with the previous case is what proves the x-ray is found.
    expect(staticExchangeEval('3r3k/3p4/8/8/8/8/3R4/5K2 w - - 0 1', 'd2', 'd7')).toBe(-400)
  })

  it('refuses a king recapture that would be illegal', () => {
    // Doubled white rooks e1+e2 take the pawn on e7. The black king cannot
    // recapture, because the second rook still covers e7.
    expect(staticExchangeEval('4k3/4p3/8/8/8/8/4R3/4RK2 w - - 0 1', 'e2', 'e7')).toBe(100)
  })

  it('allows a king recapture when the square is genuinely undefended', () => {
    // A single rook takes on e7 and the king simply takes it back.
    expect(staticExchangeEval('4k3/4p3/8/8/8/8/8/4RK2 w - - 0 1', 'e1', 'e7')).toBe(-400)
  })

  it('values a promoting capture as the promoted piece', () => {
    // bxa8=Q takes an undefended rook and promotes: 500 + (900 - 100).
    expect(staticExchangeEval('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7', 'a8')).toBe(1300)
  })

  it('handles an en passant capture', () => {
    // The captured pawn stands on d5, not on the destination d6.
    expect(staticExchangeEval('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6')).toBe(100)
  })

  it('reports a real knight sacrifice as clearly negative', () => {
    // Nxe5 in the Italian: wins a pawn, loses a knight to Nxe5.
    const italian = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1'
    expect(staticExchangeEval(italian, 'f3', 'e5')).toBe(-220)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/analysis/see.test.ts`
Expected: FAIL — cannot resolve `./see`.

- [ ] **Step 3: Implement**

Create `src/shared/analysis/see.ts`:

```ts
import { Chess } from 'chess.js'
import type { Color, PieceSymbol, Square } from 'chess.js'

export const SEE_PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

// chess.js's attackers() is geometric: it ignores whose turn it is and
// reports attackers of a square even when that square is occupied. Re-
// querying it after each simulated capture is what makes x-ray attackers
// (a rook behind a rook) resolve correctly without tracking them by hand.
function leastValuableAttacker(
  board: Chess,
  target: Square,
  color: Color
): { square: Square; type: PieceSymbol } | null {
  let best: { square: Square; type: PieceSymbol } | null = null
  for (const square of board.attackers(target, color)) {
    const piece = board.get(square)
    if (!piece) continue
    if (best === null || SEE_PIECE_VALUES[piece.type] < SEE_PIECE_VALUES[best.type]) {
      best = { square, type: piece.type }
    }
  }
  return best
}

/**
 * Static exchange evaluation: the centipawn balance for the side making
 * `from`->`to`, assuming both sides keep recapturing on `to` with their
 * least valuable attacker and either may stop when continuing would lose
 * material.
 *
 * Returns 0 for a quiet move to a square nobody contests, a positive number
 * for a favourable exchange, and a negative number for a real sacrifice.
 */
export function staticExchangeEval(fen: string, from: Square, to: Square): number {
  const board = new Chess(fen)
  const mover = board.get(from)
  if (!mover) return 0

  const side = mover.color
  const target = board.get(to)

  // An en passant capture takes a pawn that is NOT standing on the
  // destination square -- it is on the mover's own rank, in the
  // destination's file.
  const isEnPassant = mover.type === 'p' && target === undefined && from[0] !== to[0]
  const capturedValue = target
    ? SEE_PIECE_VALUES[target.type]
    : isEnPassant
      ? SEE_PIECE_VALUES.p
      : 0

  const promotes = mover.type === 'p' && (to[1] === '8' || to[1] === '1')
  const promotionGain = promotes ? SEE_PIECE_VALUES.q - SEE_PIECE_VALUES.p : 0

  const gains: number[] = [capturedValue + promotionGain]

  if (isEnPassant) board.remove(`${to[0]}${from[1]}` as Square)
  board.remove(from)
  board.remove(to)
  const arrivingType: PieceSymbol = promotes ? 'q' : mover.type
  board.put({ type: arrivingType, color: side }, to)

  // Value of whatever currently stands on `to` -- i.e. what the next
  // capturer would win.
  let onSquare = SEE_PIECE_VALUES[arrivingType]
  let turn = opposite(side)
  let depth = 0

  for (;;) {
    const attacker = leastValuableAttacker(board, to, turn)
    if (attacker === null) break

    // A king may only capture on `to` when the other side has nothing left
    // defending it -- otherwise the recapture is illegal and must not count
    // as a defence. A piece never attacks the square it stands on, so the
    // piece currently occupying `to` does not defend itself here.
    if (attacker.type === 'k' && leastValuableAttacker(board, to, opposite(turn)) !== null) break

    depth += 1
    gains[depth] = onSquare - gains[depth - 1]

    board.remove(attacker.square)
    board.remove(to)
    board.put({ type: attacker.type, color: turn }, to)
    onSquare = SEE_PIECE_VALUES[attacker.type]
    turn = opposite(turn)
  }

  // Walk the swap list backwards: at each point the side to move can decline
  // the recapture, so it takes the better of "stop here" and "capture".
  for (let d = depth; d > 0; d--) {
    gains[d - 1] = -Math.max(-gains[d - 1], gains[d])
  }

  return gains[0]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/analysis/see.test.ts`
Expected: PASS, all 12.

Every expected value was verified against a prototype of this exact code, so
a failure means the implementation diverged. Debug with a scratch script;
never weaken a fixture to make it pass. The x-ray pair and the two king cases
are the reason this module exists.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run verify
git add src/shared/analysis/see.ts src/shared/analysis/see.test.ts
git commit -m "Add static exchange evaluation"
```

---

### Task 3: Use SEE for the sacrifice signal

**Files:**
- Modify: `src/shared/pgn.ts`
- Modify: `src/shared/types.ts` (`AnalyzedPosition`)
- Modify: `src/main/analysis/gameAnalyzer.ts:77-84`
- Test: `src/shared/pgn.test.ts`

**Interfaces:**
- Consumes: `staticExchangeEval` (Task 2).
- Produces: `AnalyzedPosition` loses `isPotentialSacrifice: boolean` and gains `seeCp: number`, `isCapture: boolean`, `legalMoveCount: number`. `ClassifyMoveInput` is **unchanged** in this task — `gameAnalyzer` keeps supplying `isPotentialSacrifice`, now derived as `seeCp <= SACRIFICE_SEE_THRESHOLD`.

Keeping `ClassifyMoveInput` stable here is deliberate: this task fixes the *definition* of a sacrifice and can be reviewed on its own, while Tasks 4 and 5 change the classifier.

`isCapture` and `legalMoveCount` are unused until Task 5. They are added here because this is the one place that has chess.js loaded with each move's `before` FEN in hand.

- [ ] **Step 1: Update the type**

In `src/shared/types.ts`, in `AnalyzedPosition`, replace `isPotentialSacrifice: boolean` with:

```ts
  /** Static exchange evaluation of this move, in centipawns. Negative means
   *  the move gives up material on its destination square. */
  seeCp: number
  isCapture: boolean
  /** Legal moves available to the mover in `fenBefore`. 1 means forced. */
  legalMoveCount: number
```

- [ ] **Step 2: Write the failing tests**

In `src/shared/pgn.test.ts`, replace the three `isPotentialSacrifice` assertions:

All values below were verified against the real `parsePgn` inputs.

```ts
  it('reports a clearly negative SEE for a real piece sacrifice', () => {
    const positions = parsePgn(sacrificePgn)
    const knightSac = positions[positions.length - 1]
    expect(knightSac.san).toBe('Nxf7')
    // Wins a pawn, loses a knight.
    expect(knightSac.seeCp).toBe(-220)
  })

  it('does not treat a minor-piece trade as a sacrifice', () => {
    const evenTradePgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6'
    const positions = parsePgn(evenTradePgn)
    const trade = positions[positions.length - 1]
    expect(trade.san).toBe('Bxc6')
    // A bishop (330) for a knight (320) is -10 -- slightly negative, but
    // nowhere near the -150 threshold that makes a move a sacrifice. This
    // is why the threshold is not simply "SEE < 0".
    expect(trade.seeCp).toBe(-10)
    expect(trade.seeCp).toBeGreaterThan(-150)
  })

  it('does not treat 3...a6 in the Ruy Lopez as a sacrifice (regression)', () => {
    // The old heuristic was `capturedValue < movedValue && isAttacked(to)`,
    // which for any non-capturing pawn move reduces to `0 < 1 && attacked` --
    // so every pawn push to a covered square looked like a sacrifice, and a
    // best-move pawn push outside the opening book got classified
    // "Brilliant". The book was padded with extra theory to paper over this;
    // SEE fixes it at the source. a6 captures nothing and hangs nothing.
    const positions = parsePgn(SAMPLE_PGN)
    const a6 = positions.find((p) => p.san === 'a6')
    expect(a6?.seeCp).toBe(0)
  })

  it('reports capture and legal-move-count metadata', () => {
    const positions = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6')
    const capture = positions[positions.length - 1]
    expect(capture.isCapture).toBe(true)
    expect(capture.legalMoveCount).toBe(32)

    const opening = positions[0]
    expect(opening.isCapture).toBe(false)
    expect(opening.legalMoveCount).toBe(20)
  })
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/shared/pgn.test.ts`
Expected: FAIL — `seeCp` is `undefined`.

- [ ] **Step 4: Implement `parsePgn`**

In `src/shared/pgn.ts`, add the imports and replace the body of the `.map()`:

```ts
import { staticExchangeEval } from './analysis/see'
```

```ts
  return moves.map((move, index) => {
    const beforePosition = new Chess(move.before)

    return {
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      color: move.color,
      san: move.san,
      moveUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore: move.before,
      fenAfter: move.after,
      seeCp: staticExchangeEval(move.before, move.from, move.to),
      isCapture: move.captured !== undefined,
      legalMoveCount: beforePosition.moves().length
    }
  })
```

`PIECE_VALUES` is now unused by this module. Check for other importers with `grep -rn "PIECE_VALUES" src/` before deciding whether to delete it; if nothing else imports it, remove it and its test.

- [ ] **Step 5: Keep the classifier fed**

In `src/main/analysis/gameAnalyzer.ts`, the `classifyMove` call currently passes `isPotentialSacrifice: position.isPotentialSacrifice`. Replace with:

```ts
          isPotentialSacrifice: position.seeCp <= SACRIFICE_SEE_THRESHOLD,
```

and add near the top of the file:

```ts
// A sacrifice is giving up material, not merely moving somewhere defended.
// One and a half pawns is enough to exclude the exchange sac's small change
// while still catching a genuine piece offer.
const SACRIFICE_SEE_THRESHOLD = -150
```

- [ ] **Step 6: Fix the remaining compile errors**

Run: `npm run typecheck`

`AnalyzedPosition` crosses the IPC boundary, so several files construct or fixture it. Fix each — the compiler lists them. Expect `src/main/analysis/gameAnalyzer.test.ts` and any fixture builder to need `seeCp: 0, isCapture: false, legalMoveCount: 20` in place of `isPotentialSacrifice`.

- [ ] **Step 7: Run the full suite**

Run: `npm run verify`
Expected: PASS.

`classification.test.ts`'s 3...a6 regression test still passes unchanged — it asserts the *book* short-circuit, which is untouched.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Derive the sacrifice signal from static exchange evaluation

The old heuristic was capturedValue < movedValue && isAttacked(to), which
for any non-capturing pawn move reduces to 0 < 1 && attacked -- so every
pawn push to a covered square counted as a potential sacrifice and could
be classified Brilliant."
```

---

### Task 4: Classify on win-percent loss

**Files:**
- Modify: `src/main/analysis/classification.ts`
- Modify: `src/main/analysis/gameAnalyzer.ts`
- Test: `src/main/analysis/classification.test.ts`

**Interfaces:**
- Consumes: `MoveEvalDelta.winPercentLoss` (Task 1).
- Produces: `ClassifyMoveInput.cpLoss` is replaced by `winPercentLoss: number`. All other fields unchanged.

**Calibration property.** These thresholds are the existing centipawn tiers re-expressed in win percent, not a re-tuning. At an evaluation of 0: 20cp = 1.84, 50cp = 4.59, 100cp = 9.10, 200cp = 17.62, 300cp = 25.11. Near-equal positions therefore classify exactly as they do today. Task 4 must include a test asserting this.

- [ ] **Step 1: Write the failing tests**

In `src/main/analysis/classification.test.ts`, change the `input()` helper's `cpLoss: 0` to `winPercentLoss: 0`, replace the tier table, and add the calibration and regression tests:

```ts
  it.each([
    [1, 'excellent'],
    [3.5, 'good'],
    [8, 'inaccuracy'],
    [15, 'mistake'],
    [40, 'blunder']
  ])('classifies a non-best move losing %s win percent as %s', (winPercentLoss, expected) => {
    expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe(expected)
  })

  it('reproduces the old centipawn tiers at an even evaluation (calibration)', () => {
    // The new thresholds are the old ones in the correct unit, so a move in a
    // balanced position must land in the same bucket it always has. Only
    // decided positions change -- which is exactly where the old tiers lied.
    const cases: Array<[number, string]> = [
      [20, 'excellent'],
      [50, 'good'],
      [100, 'inaccuracy'],
      [200, 'mistake'],
      [300, 'blunder']
    ]
    for (const [cpLoss, expected] of cases) {
      const winPercentLoss = cpToWinPercent(0) - cpToWinPercent(-cpLoss)
      expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe(expected)
    }
  })

  it('does not call a big centipawn drop in a won position a blunder (regression)', () => {
    // +2000 -> +1500 is cpLoss 500 but only 0.334 win percent.
    const winPercentLoss = cpToWinPercent(2000) - cpToWinPercent(1500)
    expect(classifyMove(input({ isBestMove: false, winPercentLoss }))).toBe('excellent')
  })
```

**Verified calibration** (computed, not estimated — all five match the old
tiers exactly): 20cp -> 1.84, 50cp -> 4.59, 100cp -> 9.10, 200cp -> 17.62,
300cp -> 25.11.

**A coupling to be aware of:** the +2000 -> +1500 case is a 0.334 win-percent
loss, against Task 1's `BEST_MOVE_WIN_PERCENT_TOLERANCE` of 0.2. The margin is
only 0.13. Raising that tolerance past 0.334 would reclassify this move as
`best` and break this test. If the tolerance ever needs to grow, change this
fixture to a larger evaluation gap rather than loosening the assertion.

Add `import { cpToWinPercent } from '../../shared/engineMath'` to the test file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/analysis/classification.test.ts`
Expected: FAIL — the tier table still reads `cpLoss`.

- [ ] **Step 3: Implement**

In `src/main/analysis/classification.ts`, replace `cpLoss: number` in `ClassifyMoveInput` with `winPercentLoss: number`, and replace the tier table:

```ts
// Tiers are in win percent lost, not centipawns. These are the previous
// centipawn boundaries (20/50/100/200) converted at an evaluation of 0, so
// balanced positions classify exactly as before -- what changes is decided
// positions and mate sequences, where a centipawn delta stopped meaning
// anything. A +2000 -> +1500 move used to be a "blunder" that scored 98.5%
// accurate at the same time.
const WIN_PERCENT_LOSS_TIERS: Array<{ max: number; label: MoveClassification }> = [
  { max: 2, label: 'excellent' },
  { max: 5, label: 'good' },
  { max: 10, label: 'inaccuracy' },
  { max: 20, label: 'mistake' },
  { max: Infinity, label: 'blunder' }
]
```

and the lookup at the bottom of `classifyMove`:

```ts
  const tier = WIN_PERCENT_LOSS_TIERS.find((t) => input.winPercentLoss <= t.max)
  return tier ? tier.label : 'blunder'
```

In `src/main/analysis/gameAnalyzer.ts`, change the `classifyMove` call from `cpLoss: delta.cpLoss` to `winPercentLoss: delta.winPercentLoss`.

- [ ] **Step 4: Run the full suite**

Run: `npm run verify`
Expected: PASS. `gameAnalyzer.test.ts` may need fixture evals adjusted if it asserts a specific classification — update the fixture, not the threshold.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Classify moves on win-probability loss instead of centipawns

Classification tiered on raw centipawn loss while accuracy scored on win
percentage, so a +2000 -> +1500 move was simultaneously a Blunder and
98.5% accurate. The new thresholds are the old ones converted at an
evaluation of 0, so balanced positions are unaffected."
```

---

### Task 5: Gate `brilliant` and `great`

**Files:**
- Modify: `src/main/analysis/classification.ts`
- Modify: `src/main/analysis/gameAnalyzer.ts`
- Test: `src/main/analysis/classification.test.ts`

**Interfaces:**
- Consumes: `AnalyzedPosition.seeCp` / `.isCapture` / `.legalMoveCount` (Task 3).
- Produces: `ClassifyMoveInput` replaces `isPotentialSacrifice: boolean` with `seeCp: number`, and gains `isRecapture: boolean` and `legalMoveCount: number`.

- [ ] **Step 1: Write the failing tests**

Update the `input()` helper — drop `isPotentialSacrifice`, add `seeCp: 0, isRecapture: false, legalMoveCount: 30` — then update the two brilliant tests and add the gates:

```ts
  it('classifies a necessary, working sacrifice in a balanced position as brilliant', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: 40,
          secondBestMoverCp: -200
        })
      )
    ).toBe('brilliant')
  })

  it('does not call an obviously winning sacrifice brilliant', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 900,
          evalAfterMoverCp: 880,
          secondBestMoverCp: 700
        })
      )
    ).toBe('best')
  })

  it('does not call a sacrifice brilliant when a quiet move was just as good', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: 40,
          secondBestMoverCp: 20
        })
      )
    ).toBe('best')
  })

  it('does not call a sacrifice brilliant when the position collapses after it', () => {
    expect(
      classifyMove(
        input({
          isBestMove: true,
          seeCp: -300,
          evalBeforeMoverCp: 50,
          evalAfterMoverCp: -400,
          secondBestMoverCp: -200
        })
      )
    ).toBe('best')
  })

  it('does not call a defended pawn push brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, seeCp: 0, evalBeforeMoverCp: 30 }))
    ).toBe('best')
  })

  it('does not call a recapture great', () => {
    // After losing a queen, recapturing clears the 150cp gap to second-best
    // trivially -- every recapture in every game used to qualify.
    expect(
      classifyMove(
        input({ isBestMove: true, isRecapture: true, evalBeforeMoverCp: -300, secondBestMoverCp: -1100 })
      )
    ).toBe('best')
  })

  it('does not call a forced move great', () => {
    expect(
      classifyMove(
        input({ isBestMove: true, legalMoveCount: 1, evalBeforeMoverCp: 50, secondBestMoverCp: -150 })
      )
    ).toBe('best')
  })
```

The existing "classifies the only good move in a critical position as great" test stays as-is and must still pass.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/analysis/classification.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/main/analysis/classification.ts`, update `ClassifyMoveInput` and the best-move branch:

```ts
export interface ClassifyMoveInput {
  winPercentLoss: number
  isBestMove: boolean
  isBookMove: boolean
  seeCp: number
  isRecapture: boolean
  legalMoveCount: number
  evalBeforeMoverCp: number
  evalAfterMoverCp: number
  secondBestMoverCp: number | null
}

const CRITICAL_POSITION_CP_CEILING = 600
const GREAT_MOVE_GAP_CP = 150
const SACRIFICE_SEE_THRESHOLD = -150
// A sacrifice is only brilliant if declining it was meaningfully worse. If a
// quiet move holds the position just as well, the sacrifice is a good move,
// not a brilliant one.
const BRILLIANT_NECESSITY_GAP_CP = 100
// ...and only if it actually works: the position must not collapse after it.
const BRILLIANT_MIN_EVAL_AFTER_CP = -50
```

```ts
  if (input.isBestMove) {
    const isCriticalPosition = Math.abs(input.evalBeforeMoverCp) < CRITICAL_POSITION_CP_CEILING

    if (
      input.seeCp <= SACRIFICE_SEE_THRESHOLD &&
      isCriticalPosition &&
      input.evalAfterMoverCp >= BRILLIANT_MIN_EVAL_AFTER_CP &&
      input.secondBestMoverCp !== null &&
      input.evalBeforeMoverCp - input.secondBestMoverCp >= BRILLIANT_NECESSITY_GAP_CP
    ) {
      return 'brilliant'
    }

    // A recapture clears the second-best gap trivially, and a forced move has
    // no alternative to be better than -- neither is a feat of calculation.
    if (input.secondBestMoverCp !== null && !input.isRecapture && input.legalMoveCount > 1) {
      const gapToSecondBest = input.evalBeforeMoverCp - input.secondBestMoverCp
      if (gapToSecondBest >= GREAT_MOVE_GAP_CP && isCriticalPosition) return 'great'
    }

    return 'best'
  }
```

In `src/main/analysis/gameAnalyzer.ts`, delete the local `SACRIFICE_SEE_THRESHOLD` added in Task 3 and pass the new fields. The previous ply is `positions[nextToFlush - 2]`, which is `undefined` on ply 1:

```ts
        const previousPosition = positions[nextToFlush - 2]
        const isRecapture =
          position.isCapture &&
          previousPosition !== undefined &&
          previousPosition.moveUci.slice(2, 4) === position.moveUci.slice(2, 4)

        const classification = classifyMove({
          winPercentLoss: delta.winPercentLoss,
          isBestMove: delta.isBestMove,
          isBookMove: isBookMove(sanHistory, position.ply),
          seeCp: position.seeCp,
          isRecapture,
          legalMoveCount: position.legalMoveCount,
          evalBeforeMoverCp: delta.evalBeforeMoverCp,
          evalAfterMoverCp: delta.evalAfterMoverCp,
          secondBestMoverCp: delta.secondBestMoverCp
        })
```

- [ ] **Step 4: Run the full suite**

Run: `npm run verify`
Expected: PASS.

The 3...a6 regression test in `classification.test.ts` still asserts the book short-circuit; update its `input({...})` call to the new field names but keep the assertion.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Gate Brilliant on a real sacrifice and Great on non-forcedness

Brilliant now requires negative SEE, a position that survives the
sacrifice, and a meaningfully worse alternative. Great no longer fires on
recaptures, which cleared the 150cp second-best gap trivially, or on
forced moves."
```

---

### Task 6: Volatility-weighted game accuracy

**Files:**
- Modify: `src/main/analysis/accuracy.ts`
- Modify: `src/main/analysis/gameAnalyzer.ts`
- Test: `src/main/analysis/accuracy.test.ts`

**Interfaces:**
- Consumes: `winPercent` (Task 1).
- Produces: `gameAccuracy(input: AccuracyInput): { white: number; black: number }`, replacing `gameAccuracy(accuracies: number[]): number`. `moveAccuracy` is unchanged.

```ts
export interface AccuracyInput {
  /** White-perspective win percent for every position in the game, starting
   *  position first. Length is moves.length + 1. */
  winPercents: number[]
  /** Per-move accuracy and mover colour, in ply order. */
  moves: Array<{ accuracy: number; color: 'w' | 'b' }>
}
```

- [ ] **Step 1: Write the failing tests**

Replace the `gameAccuracy` describe block in `src/main/analysis/accuracy.test.ts`:

```ts
describe('gameAccuracy', () => {
  function steady(n: number, accuracy: number): AccuracyInput {
    return {
      winPercents: Array.from({ length: n + 1 }, () => 50),
      moves: Array.from({ length: n }, (_, i) => ({
        accuracy,
        color: i % 2 === 0 ? ('w' as const) : ('b' as const)
      }))
    }
  }

  it('returns 100 for a game with no moves', () => {
    expect(gameAccuracy({ winPercents: [50], moves: [] })).toEqual({ white: 100, black: 100 })
  })

  it('reproduces a constant accuracy exactly', () => {
    const result = gameAccuracy(steady(20, 90))
    expect(result.white).toBeCloseTo(90, 4)
    expect(result.black).toBeCloseTo(90, 4)
  })

  it('scores each colour independently', () => {
    const input: AccuracyInput = {
      winPercents: Array.from({ length: 5 }, () => 50),
      moves: [
        { accuracy: 100, color: 'w' },
        { accuracy: 50, color: 'b' },
        { accuracy: 100, color: 'w' },
        { accuracy: 50, color: 'b' }
      ]
    }
    const result = gameAccuracy(input)
    expect(result.white).toBeGreaterThan(result.black)
  })

  it('scores below the arithmetic mean when one move is catastrophic', () => {
    // This is the whole point: the harmonic component punishes a game that
    // was fine except for one disaster, which a plain mean smooths away.
    const accuracies = [100, 100, 100, 100, 100, 100, 100, 100, 100, 5]
    const arithmetic = accuracies.reduce((a, b) => a + b, 0) / accuracies.length

    const input: AccuracyInput = {
      winPercents: [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 5],
      moves: accuracies.map((accuracy) => ({ accuracy, color: 'w' as const }))
    }

    expect(gameAccuracy(input).white).toBeLessThan(arithmetic)
  })

  it('stays within 0 and 100', () => {
    const result = gameAccuracy(steady(30, 0))
    expect(result.white).toBeGreaterThanOrEqual(0)
    expect(result.white).toBeLessThanOrEqual(100)
  })
})
```

Import `AccuracyInput` in the test file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/analysis/accuracy.test.ts`
Expected: FAIL — `gameAccuracy` takes an array.

- [ ] **Step 3: Implement**

Replace `gameAccuracy` in `src/main/analysis/accuracy.ts`:

```ts
export interface AccuracyInput {
  winPercents: number[]
  moves: Array<{ accuracy: number; color: 'w' | 'b' }>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

// Lichess's published game-accuracy method. A plain arithmetic mean -- what
// this used to be -- treats a quiet game with one catastrophe the same as a
// uniformly mediocre one, and reads systematically higher than the number
// chess.com shows for the same game. Two corrections are combined: moves
// made in volatile stretches of the game count for more (the weights), and
// the harmonic mean drags the result toward the worst moves.
export function gameAccuracy(input: AccuracyInput): { white: number; black: number } {
  const { winPercents, moves } = input
  if (moves.length === 0) return { white: 100, black: 100 }

  const windowSize = clamp(Math.floor(winPercents.length / 10), 2, 8)
  const firstWindow = winPercents.slice(0, windowSize)

  const windows: number[][] = []
  for (let i = 0; i < windowSize - 2; i++) windows.push(firstWindow)
  for (let i = 0; i + windowSize <= winPercents.length; i++) {
    windows.push(winPercents.slice(i, i + windowSize))
  }

  const weights = moves.map((_, i) => {
    const window = windows[Math.min(i, windows.length - 1)] ?? firstWindow
    return clamp(standardDeviation(window), 0.5, 12)
  })

  function forColor(color: 'w' | 'b'): number {
    const entries = moves
      .map((move, i) => ({ accuracy: move.accuracy, weight: weights[i], color: move.color }))
      .filter((entry) => entry.color === color)
    if (entries.length === 0) return 100

    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0)
    const weightedMean =
      totalWeight > 0
        ? entries.reduce((sum, e) => sum + e.accuracy * e.weight, 0) / totalWeight
        : entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length

    // Guard the reciprocal: a 0-accuracy move would otherwise divide by zero.
    const harmonicMean =
      entries.length / entries.reduce((sum, e) => sum + 1 / Math.max(e.accuracy, 0.01), 0)

    return clamp((weightedMean + harmonicMean) / 2, 0, 100)
  }

  return { white: forColor('w'), black: forColor('b') }
}
```

- [ ] **Step 4: Wire it into `gameAnalyzer`**

`analyzeGame` currently computes the two accuracies by filtering `moves` by colour. Replace that with the new call. `fens` and `results` are both in scope at that point; the side to move comes straight from the FEN so custom start positions work:

```ts
      if (nextToFlush === fens.length) {
        const winPercents = fens.map((fen, i) => {
          const evaluation = results[i]
          if (!evaluation || evaluation.lines.length === 0) return 50
          const moverWinPercent = winPercent(evaluation.lines[0])
          // Every evaluation is from the side to move's perspective; the
          // accuracy model needs one consistent (White) perspective.
          return fen.split(' ')[1] === 'w' ? moverWinPercent : 100 - moverWinPercent
        })

        const { white: whiteAccuracy, black: blackAccuracy } = gameAccuracy({
          winPercents,
          moves: moves.map((m) => ({ accuracy: m.accuracy, color: m.color }))
        })
        finishOnce(() => resolve({ moves, whiteAccuracy, blackAccuracy }))
      }
```

Import `winPercent` from `../../shared/engineMath`.

- [ ] **Step 5: Run the full suite**

Run: `npm run verify`
Expected: PASS. `gameAnalyzer.test.ts` asserts accuracies; expect to relax exact-value assertions to ranges, since a 2-move fixture now goes through weighting. Do not change the algorithm to satisfy a fixture.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Compute game accuracy with volatility weighting and a harmonic mean

Replaces the plain arithmetic mean with Lichess's published method. Every
reported accuracy will read somewhat lower than before; that is the
correction -- a plain mean smooths away the single catastrophic move that
decided the game."
```

---

### Task 7: Non-destructive schema migration

**Files:**
- Modify: `src/main/insights/insightsStore.ts`
- Modify: `src/main/insights/extractInsightRecord.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/components/InsightsTab.tsx`
- Test: `src/main/insights/insightsStore.test.ts`

**Interfaces:**
- Consumes: `MoveEvalDelta.winPercentLoss` (Task 1).
- Produces: `CURRENT_SCHEMA_VERSION = 2`; `ensureSchemaVersion(): void` no longer deletes; new `isSchemaStale(): boolean`; `isGameScanned` treats an older-version record as unscanned. `GameInsightRecord` gains `schemaVersion: number`; `GameInsightMistake` gains `evalBeforeMoverCp: number` and `winPercentLoss: number`. `InsightsReport` gains `staleSchema: boolean`.

**Why this task exists.** Tasks 4–6 change what a "mistake" is, so cached records are stale. The obvious move — bump `CURRENT_SCHEMA_VERSION` — is a trap: `ensureSchemaVersion()` unlinks every file in `games/` and is called from four **read** paths (`handlers.ts:174,184,204,212`). Merely opening the Insights or Puzzles tab would destroy hours of engine work and orphan every SRS card in `srs-state.json`, which is keyed by `${gameUrl}#${ply}`.

- [ ] **Step 1: Write the failing tests**

Add to `src/main/insights/insightsStore.test.ts`, following the file's existing temp-dir setup:

```ts
  it('does not delete cached records when the schema version is stale', () => {
    saveGameRecord(recordFor('https://example.com/1'))
    saveScanMeta({ schemaVersion: 1 })

    ensureSchemaVersion()

    expect(loadAllGameRecords()).toHaveLength(1)
  })

  it('reports a stale schema without changing the stored version', () => {
    saveScanMeta({ schemaVersion: 1 })
    expect(isSchemaStale()).toBe(true)
  })

  it('treats a record written under an older schema as unscanned so a rescan rebuilds it', () => {
    const url = 'https://example.com/2'
    saveGameRecord({ ...recordFor(url), schemaVersion: 1 })
    expect(isGameScanned(url)).toBe(false)
  })

  it('treats a record written under the current schema as scanned', () => {
    const url = 'https://example.com/3'
    saveGameRecord(recordFor(url))
    expect(isGameScanned(url)).toBe(true)
  })

  it('treats a record with no schemaVersion field as version 1', () => {
    const url = 'https://example.com/4'
    const { schemaVersion: _omitted, ...legacy } = recordFor(url)
    writeRecordJsonDirectly(url, legacy)
    expect(isGameScanned(url)).toBe(false)
    expect(loadAllGameRecords()).toHaveLength(1)
  })
```

`recordFor(url)` and `writeRecordJsonDirectly(url, json)` are local helpers — build them from the file's existing record fixture, adding `schemaVersion: CURRENT_SCHEMA_VERSION`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/insights/insightsStore.test.ts`
Expected: FAIL — `isSchemaStale` is not exported, and `ensureSchemaVersion` deletes.

- [ ] **Step 3: Implement the store**

In `src/main/insights/insightsStore.ts`:

```ts
// Version 2: move classification moved from raw centipawn loss to
// win-probability loss, and the sacrifice signal moved to static exchange
// evaluation, so version-1 mistakes were selected by different rules.
export const CURRENT_SCHEMA_VERSION = 2
```

Replace `ensureSchemaVersion` entirely:

```ts
// Deliberately does NOT delete anything. This runs from four read paths
// (getInsightsReport, getMistakeDetail, getMasteryTree, getNodeQueue), so
// the previous "unlink every file in games/" behaviour meant that merely
// opening a tab after a version bump destroyed hours of engine work with no
// warning -- and orphaned every card in srs-state.json, which is keyed by
// `${gameUrl}#${ply}`. Instead, stale records stay readable and keep
// rendering; isGameScanned() reports them as unscanned so the next rescan
// rebuilds them one game at a time, and the UI asks for that rescan.
export function ensureSchemaVersion(): void {
  const meta = loadScanMeta()
  if (meta.schemaVersion === CURRENT_SCHEMA_VERSION) return
  saveScanMeta({ schemaVersion: CURRENT_SCHEMA_VERSION })
}

export function isSchemaStale(): boolean {
  return loadAllGameRecords().some(
    (record) => (record.schemaVersion ?? 1) < CURRENT_SCHEMA_VERSION
  )
}
```

Make `isGameScanned` version-aware:

```ts
export function isGameScanned(gameUrl: string): boolean {
  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return false
  try {
    const record = JSON.parse(readFileSync(path, 'utf-8')) as Partial<GameInsightRecord>
    // A record written before the current analysis rules is real data worth
    // keeping and rendering, but it must not suppress a re-analysis -- the
    // rescan is exactly how it gets rebuilt.
    return (record.schemaVersion ?? 1) >= CURRENT_SCHEMA_VERSION
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Stamp and enrich new records**

In `src/shared/types.ts`, add `schemaVersion: number` to `GameInsightRecord`, and to `GameInsightMistake`:

```ts
  /** Mover-perspective evaluation before the mistake, in centipawns. Stored
   *  so a future classifier change can be applied without a rescan. */
  evalBeforeMoverCp: number
  winPercentLoss: number
```

Add `staleSchema: boolean` to `InsightsReport`.

In `src/main/insights/extractInsightRecord.ts`, the mistake `.map()` already discards the delta after reading `cpLoss`. Keep it:

```ts
      const delta = computeMoveEvalDelta(move.evalBefore, move.evalAfter, move.moveUci)
```

then use `cpLoss: delta.cpLoss` and add `evalBeforeMoverCp: delta.evalBeforeMoverCp` and `winPercentLoss: delta.winPercentLoss`. Add `schemaVersion: CURRENT_SCHEMA_VERSION` to the returned record, importing it from `./insightsStore`.

- [ ] **Step 5: Surface it**

In `src/main/ipc/handlers.ts`, the `getInsightsReport` handler adds the flag:

```ts
    return { ...partialReport, topFindings: synthesizeTopFindings(partialReport), staleSchema: isSchemaStale() }
```

Import `isSchemaStale`. In `src/renderer/src/components/InsightsTab.tsx`, the header already renders a stale-scan line with an `.insights-last-scan.stale` class. Reuse it — a stale schema takes priority over a stale timestamp because it is the more actionable message:

```tsx
  const staleSchema = state.report?.staleSchema ?? false
  const isStale = staleSchema || (lastScanTime !== null && Date.now() - lastScanTime > STALE_SCAN_MS)
```

and in the text expression, when `staleSchema` is true render
`` `Scanned ${formatRelativeTime(lastScanTime)} · ${state.report?.gamesScanned} games — analysis improved, rescan to update` ``
in place of the existing `— rescan to catch up` suffix.

- [ ] **Step 6: Fix compile errors and run the suite**

Run: `npm run typecheck` then `npm run verify`

`reportAggregator.test.ts`, `topFindings.test.ts`, `masteryQueue.test.ts` and `extractInsightRecord.test.ts` build `GameInsightRecord` / `GameInsightMistake` fixtures and will need the new fields. Add them to the shared fixture helper in each file rather than to every literal.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Migrate the insights cache without deleting it

Bumping CURRENT_SCHEMA_VERSION used to unlink every file in games/ from
four read paths, so opening a tab after an update destroyed the scan
history and orphaned every SRS card. Stale records now stay readable and
are reported as unscanned, so a rescan rebuilds them incrementally."
```

---

### Task 8: Configure Threads and Hash

**Files:**
- Modify: `src/main/engine/stockfishManager.ts`
- Modify: `src/main/engine/enginePool.ts`
- Modify: `src/main/engine/explorationEngine.ts`
- Modify: `src/main/ipc/handlers.ts`
- Test: `src/main/engine/stockfishManager.test.ts`, `src/main/engine/enginePool.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `new StockfishManager(binaryPath, spawnFn?, options?: EngineOptions)` where `EngineOptions = { threads?: number; hash?: number }`. `poolSize(cpuCount)` upper bound rises from 6 to 12. New `poolHashMb(size: number): number`.

Measured on a Ryzen 7700X: 16MB/1-thread is 1.85 Mnps, 256MB/1-thread is 1.78 Mnps, 256MB/8-threads is 14.0 Mnps. Threads are the lever; hash barely matters for short searches. So pool engines stay at one thread each (parallelism already comes from running many), and the single-position exploration engine gets the threads.

- [ ] **Step 1: Write the failing tests**

In `src/main/engine/stockfishManager.test.ts`, following the file's existing fake-spawn harness:

```ts
  it('sends Threads and Hash options during startup', async () => {
    const { manager, sent } = harnessWithOptions({ threads: 4, hash: 256 })
    await manager.start()
    expect(sent).toContain('setoption name Threads value 4')
    expect(sent).toContain('setoption name Hash value 256')
  })

  it('sends the options after uciok and before isready', async () => {
    const { manager, sent } = harnessWithOptions({ threads: 4, hash: 256 })
    await manager.start()
    expect(sent.indexOf('setoption name Threads value 4')).toBeGreaterThan(sent.indexOf('uci'))
    expect(sent.indexOf('setoption name Threads value 4')).toBeLessThan(sent.indexOf('isready'))
  })

  it('sends no options when none are configured', async () => {
    const { manager, sent } = harnessWithOptions(undefined)
    await manager.start()
    expect(sent.some((line) => line.startsWith('setoption name Threads'))).toBe(false)
  })
```

`harnessWithOptions` mirrors the file's existing manager-construction helper, recording every `send`. In `src/main/engine/enginePool.test.ts`, extend the `poolSize` describe:

```ts
  it('caps at 12 on high core counts', () => {
    expect(poolSize(16)).toBe(12)
    expect(poolSize(64)).toBe(12)
  })

  it('still scales as cpuCount - 2 below the cap', () => {
    expect(poolSize(8)).toBe(6)
    expect(poolSize(14)).toBe(12)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/engine/`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/main/engine/stockfishManager.ts`:

```ts
export interface EngineOptions {
  threads?: number
  hash?: number
}
```

Add a third constructor parameter `private readonly options: EngineOptions = {}` and insert into `start()`, between the `uciok` and `isready` waits (the correct UCI ordering — options are set after the engine has declared its option list, and `isready` then confirms it applied them):

```ts
    await this.sendAndWaitForLine('uci', (line) => line === 'uciok')
    // Stockfish defaults to 1 thread and 16 MB of hash. Nothing in this
    // codebase used to send any setoption but MultiPV, so every engine ran
    // at those defaults -- on a single position that measures ~7.6x slower
    // than the same engine given half the machine's threads.
    if (this.options.threads !== undefined) {
      this.send(`setoption name Threads value ${this.options.threads}`)
    }
    if (this.options.hash !== undefined) {
      this.send(`setoption name Hash value ${this.options.hash}`)
    }
    await this.sendAndWaitForLine('isready', (line) => line === 'readyok')
```

In `src/main/engine/enginePool.ts`:

```ts
// Each pooled engine runs single-threaded on purpose: parallelism comes from
// running `size` of them across different positions, which scales better than
// one engine searching one position on many threads.
const MAX_POOL_SIZE = 12
const POOL_HASH_BUDGET_MB = 1024

export function poolSize(cpuCount: number): number {
  return Math.max(1, Math.min(MAX_POOL_SIZE, cpuCount - 2))
}

export function poolHashMb(size: number): number {
  return Math.max(16, Math.min(256, Math.floor(POOL_HASH_BUDGET_MB / Math.max(1, size))))
}
```

In `src/main/ipc/handlers.ts`, the `analyzeGame` handler:

```ts
          const size = poolSize(cpus().length)
          pool = await createEnginePool(
            size,
            () => new StockfishManager(getStockfishBinaryPath(), undefined, { threads: 1, hash: poolHashMb(size) })
          )
```

In `src/main/engine/explorationEngine.ts`, inside `getEngine`:

```ts
      // The exploration engine serves one position at a time for the
      // interactive board and for puzzle grading, so unlike the pool it
      // should use real thread parallelism. Half the machine leaves room for
      // the UI and for an analysis pool running alongside it.
      const instance = new StockfishManager(getStockfishBinaryPath(), spawnFn, {
        threads: Math.max(1, Math.floor(cpus().length / 2)),
        hash: 256
      })
```

with `import { cpus } from 'node:os'`.

- [ ] **Step 4: Run the full suite**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Verify against the real engine**

Run: `npm run dev`, load a game, and confirm analysis completes and the board's exploration eval still returns. A wrong `setoption` name makes Stockfish print `No such option:` to stderr, which `onStderr` surfaces — check the console.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Give every Stockfish process a thread and hash budget

setoption appeared exactly once in the codebase (MultiPV), so every engine
ran Stockfish's defaults of 1 thread and 16MB. Measured on a Ryzen 7700X,
the single-position exploration engine is ~7.6x faster with half the
machine's threads. Pool engines stay single-threaded by design."
```

---

### Task 9: Run the Insights scan on the engine pool

**Files:**
- Modify: `src/main/insights/scanRunner.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/shared/types.ts` (`ScanProgress`)
- Modify: `src/renderer/src/components/InsightsTab.tsx`
- Test: `src/main/insights/scanRunner.test.ts`

**Interfaces:**
- Consumes: `poolSize` / `poolHashMb` (Task 8).
- Produces: `ScanRunnerOptions.createEngine` becomes `createPool: () => Promise<EnginePool>`. `ScanProgress` gains `etaMs: number | null`.

The scan wraps a single engine in `serialized()` so exactly one position is ever in flight, while `analyzeGame` already dispatches every position of a game concurrently and `EnginePool` already guarantees one call per engine. This task is mostly deletion.

- [ ] **Step 1: Write the failing tests**

In `src/main/insights/scanRunner.test.ts`, change `fakeEngine()` to `fakePool()` (an object with `evaluatePosition` and `stop`, no `start`), update every `createEngine:` call site to `createPool:`, and add:

```ts
  it('stops the pool when the scan finishes', async () => {
    const stop = vi.fn()
    fetchRecentGamesMock.mockResolvedValue([game('https://example.com/1')])
    isGameScannedMock.mockReturnValue(false)

    await runScan('testuser', { createPool: async () => ({ ...fakePool(), stop }) })

    expect(stop).toHaveBeenCalledOnce()
  })

  it('reports an eta once at least one game has completed', async () => {
    fetchRecentGamesMock.mockResolvedValue([
      game('https://example.com/1'),
      game('https://example.com/2')
    ])
    isGameScannedMock.mockReturnValue(false)
    const progress: ScanProgress[] = []

    await runScan('testuser', {
      createPool: async () => fakePool(),
      onProgress: (p) => progress.push(p)
    })

    expect(progress[0].etaMs).toBeNull()
    expect(progress[progress.length - 1].etaMs).not.toBeUndefined()
  })

  it('returns an error when the pool cannot start', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('https://example.com/1')])
    isGameScannedMock.mockReturnValue(false)

    const result = await runScan('testuser', {
      createPool: async () => {
        throw new Error('no binary')
      }
    })

    expect(result).toEqual({ error: 'Could not start Stockfish: no binary' })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/insights/scanRunner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`:

```ts
export interface ScanProgress {
  scanned: number
  total: number
  /** Estimated milliseconds remaining, or null before the first game
   *  completes and there is nothing to extrapolate from. */
  etaMs: number | null
}
```

In `src/main/insights/scanRunner.ts`: delete the entire `serialized()` function and its comment block, and change the options and the run body:

```ts
export interface ScanRunnerOptions {
  isCancelled?: () => boolean
  onProgress?: (progress: ScanProgress) => void
  createPool: () => Promise<EnginePool>
}
```

```ts
  options.onProgress?.({ scanned: 0, total: newGames.length, etaMs: null })

  if (newGames.length === 0) {
    saveScanMeta({ username, lastScanTime: Date.now() })
    return { scanned: 0 }
  }

  let pool: EnginePool
  try {
    pool = await options.createPool()
  } catch (err) {
    return { error: `Could not start Stockfish: ${(err as Error).message}` }
  }

  const startedAt = Date.now()
  let scanned = 0
  try {
    for (const game of newGames) {
      // ... unchanged parse/analyze body, but passing `pool` to analyzeGame
      // instead of `analysisEngine`, and every onProgress call becomes:
      scanned += 1
      const elapsed = Date.now() - startedAt
      options.onProgress?.({
        scanned,
        total: newGames.length,
        etaMs: scanned > 0 ? Math.round((elapsed / scanned) * (newGames.length - scanned)) : null
      })
    }
  } finally {
    pool.stop()
  }
```

Note `createPool` is awaited *after* the `newGames.length === 0` early return, so a no-op rescan no longer spawns engines at all. Import `EnginePool` from `../engine/enginePool`.

In `src/main/ipc/handlers.ts`, the scan handler:

```ts
        createPool: () => {
          const size = poolSize(cpus().length)
          return createEnginePool(
            size,
            () => new StockfishManager(getStockfishBinaryPath(), undefined, { threads: 1, hash: poolHashMb(size) })
          )
        },
```

- [ ] **Step 4: Render the ETA**

In `src/renderer/src/components/InsightsTab.tsx`, extend the scanning branch:

```tsx
            <span>
              Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
              {state.progress?.etaMs != null && ` · ${formatEta(state.progress.etaMs)} remaining`}
            </span>
```

Add a small local helper above the component:

```tsx
function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes >= 1) return `~${minutes} min`
  return `~${Math.max(1, Math.round(ms / 1000))} sec`
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm run verify`
Expected: PASS. Any other `ScanProgress` literal (in `useInsightsScan.ts` or its tests) needs `etaMs`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Run the Insights scan on the engine pool with an ETA

The scan wrapped a single Stockfish in serialized() so one position was
ever in flight, while analyzeGame already dispatches a game's positions
concurrently and EnginePool already enforces one call per engine. Also
reports an estimated time remaining instead of a bare counter."
```

---

### Task 10: CPU-matched Stockfish download

**Files:**
- Modify: `scripts/downloadStockfish.mjs`
- Modify: `package.json`
- Modify: `src/main/engine/stockfishPath.ts`
- Test: `src/main/engine/stockfishPath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run setup:stockfish` installs a CPU-matched build to `vendor/stockfish/` with a `version.json` stamp; `npm run setup:stockfish:dist` installs the generic build to `vendor/stockfish-dist/` for packaging.

Asset names below were read from the live `sf_18` release — do not invent others. Measured on a Ryzen 7700X: generic 1.11 Mnps, avx2/bmi2 1.75 Mnps, avx512 1.84 Mnps, vnni512 1.86 Mnps.

**The safety net is the smoke test, not the detection.** Each candidate is downloaded, extracted, and run with `uci` / `quit`; if it does not print `uciok` — because it hit an unsupported instruction, or for any other reason — the script falls to the next candidate. This means Windows needs no CPUID parsing and a wrong guess is self-correcting.

**The packaging trap.** `electron-builder` ships `vendor/stockfish` as `extraResources`, so a CPU-matched binary would mean the build machine's CPU decides what users get, and a released package could die with an illegal instruction on older hardware. The optimised binary therefore stays at `vendor/stockfish/` for local use, and packaging points at a separate `vendor/stockfish-dist/` holding the generic build.

- [ ] **Step 1: Rewrite the candidate table**

In `scripts/downloadStockfish.mjs`, replace `PLATFORM_ASSETS` with ordered lists, best first:

```js
const PLATFORM_ASSETS = {
  'linux-x64': ['vnni512', 'avx512', 'bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToLinux),
  'darwin-x64': ['bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToMacos),
  'darwin-arm64': [
    { asset: 'stockfish-macos-m1-apple-silicon.tar', binaryInArchive: 'stockfish/stockfish-macos-m1-apple-silicon' }
  ],
  'win32-x64': ['vnni512', 'avx512', 'bmi2', 'avx2', 'sse41-popcnt', null].map(suffixToWindows)
}

// A null suffix is the generic baseline build, which every x86-64 CPU runs.
function suffixToLinux(suffix) {
  const base = suffix ? `stockfish-ubuntu-x86-64-${suffix}` : 'stockfish-ubuntu-x86-64'
  return { asset: `${base}.tar`, binaryInArchive: `stockfish/${base}` }
}
function suffixToMacos(suffix) {
  const base = suffix ? `stockfish-macos-x86-64-${suffix}` : 'stockfish-macos-x86-64'
  return { asset: `${base}.tar`, binaryInArchive: `stockfish/${base}` }
}
function suffixToWindows(suffix) {
  const base = suffix ? `stockfish-windows-x86-64-${suffix}` : 'stockfish-windows-x86-64'
  return { asset: `${base}.zip`, binaryInArchive: `stockfish/${base}.exe` }
}
```

- [ ] **Step 2: Add detection, the smoke test, and the stamp**

```js
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

// Detection only picks where to START in the candidate list. It is an
// optimisation, not the guarantee -- runSmokeTest below is what actually
// keeps us from installing a binary this CPU cannot execute.
function detectCpuFeatures() {
  try {
    if (process.platform === 'linux') {
      const flags = readFileSync('/proc/cpuinfo', 'utf-8').match(/^flags\s*:(.*)$/m)
      return new Set((flags?.[1] ?? '').trim().split(/\s+/))
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('sysctl', ['-n', 'machdep.cpu.features', 'machdep.cpu.leaf7_features'], {
        encoding: 'utf-8'
      })
      return new Set(out.toLowerCase().split(/\s+/))
    }
  } catch {
    // Fall through: with no detection we simply start at the top of the
    // list and let the smoke test walk down it.
  }
  return null
}

const REQUIRED_FEATURES = {
  vnni512: ['avx512_vnni', 'avx512vnni'],
  avx512: ['avx512f'],
  bmi2: ['bmi2'],
  avx2: ['avx2'],
  'sse41-popcnt': ['sse4_1', 'sse4.1']
}

function candidateIsPlausible(asset, features) {
  if (features === null) return true
  const suffix = Object.keys(REQUIRED_FEATURES).find((key) => asset.includes(`-${key}.`))
  if (!suffix) return true // the generic build always runs
  return REQUIRED_FEATURES[suffix].some((flag) => features.has(flag))
}

// The real guarantee: run the thing and see whether it answers. A build that
// uses instructions this CPU lacks dies with SIGILL here rather than in the
// middle of a user's game analysis.
function runSmokeTest(binaryPath) {
  try {
    const out = execFileSync(binaryPath, [], {
      input: 'uci\nquit\n',
      encoding: 'utf-8',
      timeout: 30000
    })
    return out.includes('uciok')
  } catch {
    return false
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
```

- [ ] **Step 3: Rewrite `main()`**

Replace the `existsSync` early-return — today, bumping `STOCKFISH_RELEASE_TAG` silently does nothing because the old binary is still present — with a stamp comparison, and loop over the candidates:

```js
async function main() {
  const targetDir = process.env.STOCKFISH_TARGET_DIR
    ? join(process.cwd(), process.env.STOCKFISH_TARGET_DIR)
    : VENDOR_DIR
  const forceGeneric = process.env.STOCKFISH_GENERIC === '1'

  const platformKey = resolvePlatformKey()
  const finalBinaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const finalBinaryPath = join(targetDir, finalBinaryName)
  const stampPath = join(targetDir, 'version.json')

  let candidates = PLATFORM_ASSETS[platformKey]
  if (forceGeneric) candidates = [candidates[candidates.length - 1]]
  else {
    const features = detectCpuFeatures()
    const plausible = candidates.filter((c) => candidateIsPlausible(c.asset, features))
    // Always keep the generic build as the final fallback.
    candidates = plausible.length > 0 ? plausible : [candidates[candidates.length - 1]]
  }

  if (existsSync(stampPath) && existsSync(finalBinaryPath)) {
    try {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf-8'))
      if (
        stamp.releaseTag === STOCKFISH_RELEASE_TAG &&
        stamp.asset === candidates[0].asset &&
        stamp.sha256 === sha256(finalBinaryPath)
      ) {
        console.log(`Stockfish ${stamp.asset} already installed at ${finalBinaryPath}`)
        return
      }
      console.log('Stockfish stamp does not match; reinstalling.')
    } catch {
      console.log('Stockfish stamp unreadable; reinstalling.')
    }
  }

  mkdirSync(targetDir, { recursive: true })

  for (const { asset, binaryInArchive } of candidates) {
    console.log(`Trying ${asset} ...`)
    const archivePath = join(targetDir, asset)
    const downloadUrl = `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_RELEASE_TAG}/${asset}`

    try {
      await downloadFile(downloadUrl, archivePath)
      extractArchive(archivePath, targetDir, binaryInArchive)

      const extractedPath = join(targetDir, binaryInArchive)
      const stockfishDirPath = join(targetDir, 'stockfish')
      const tempBinaryPath = join(targetDir, '.stockfish-temp')
      copyFileSync(extractedPath, tempBinaryPath)
      rmSync(stockfishDirPath, { recursive: true, force: true })
      if (process.platform !== 'win32') chmodSync(tempBinaryPath, 0o755)

      if (!runSmokeTest(tempBinaryPath)) {
        console.log(`  ${asset} does not run on this CPU; trying the next build.`)
        rmSync(tempBinaryPath, { force: true })
        rmSync(archivePath, { force: true })
        continue
      }

      renameSync(tempBinaryPath, finalBinaryPath)
      rmSync(archivePath, { force: true })
      writeFileSync(
        stampPath,
        JSON.stringify(
          { releaseTag: STOCKFISH_RELEASE_TAG, asset, sha256: sha256(finalBinaryPath) },
          null,
          2
        )
      )
      console.log(`Stockfish ${asset} installed at ${finalBinaryPath}`)
      return
    } catch (err) {
      console.log(`  ${asset} failed: ${err.message}`)
      rmSync(archivePath, { force: true })
    }
  }

  throw new Error('No Stockfish build could be installed for this platform.')
}
```

- [ ] **Step 4: Split dev and distribution binaries**

In `package.json`:

```json
    "setup:stockfish": "node scripts/downloadStockfish.mjs",
    "setup:stockfish:dist": "STOCKFISH_GENERIC=1 STOCKFISH_TARGET_DIR=vendor/stockfish-dist node scripts/downloadStockfish.mjs",
    "build:linux": "npm run setup:stockfish:dist && electron-vite build && electron-builder --linux pacman",
```

and point `extraResources` at the distribution directory:

```json
    "extraResources": [
      {
        "from": "vendor/stockfish-dist",
        "to": "vendor/stockfish"
      }
    ],
```

The `to` stays `vendor/stockfish` so `stockfishPath.ts`'s packaged path is unchanged. Add `vendor/stockfish-dist/` to `.gitignore` alongside the existing `vendor/stockfish` entry — check what `.gitignore` currently says and match it.

- [ ] **Step 5: Give a missing binary a real message**

In `src/main/engine/stockfishPath.ts`, add an existence check. Read the file first to match its current shape, then export:

```ts
export function getStockfishBinaryPath(): string {
  const path = resolveBinaryPath()
  if (!existsSync(path)) {
    throw new Error(
      `Stockfish is not installed at ${path}. Run "npm run setup:stockfish" to download it.`
    )
  }
  return path
}
```

Add a test in `src/main/engine/stockfishPath.test.ts` asserting the thrown message mentions `setup:stockfish`, following the file's existing mocking approach for `app.getPath` / `process.resourcesPath`.

- [ ] **Step 6: Verify end to end**

```bash
rm -rf vendor/stockfish
npm run setup:stockfish
./vendor/stockfish/stockfish compiler | grep "Compilation settings"
cat vendor/stockfish/version.json
./vendor/stockfish/stockfish bench 2>&1 | grep "Nodes/second"
```

Expected: a settings line naming AVX2/BMI2/AVX512 rather than `64bit SSE2`, a stamp naming the same asset, and nodes/second meaningfully above the 1,106,154 baseline.

Then confirm the stamp short-circuits: run `npm run setup:stockfish` again and expect `already installed`.

Then confirm the distribution path: `npm run setup:stockfish:dist` and check `vendor/stockfish-dist/stockfish compiler` reports `64bit SSE2`.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm run verify
git add -A
git commit -m "Install a CPU-matched Stockfish build, with a smoke test as the guard

The vendored binary was the generic SSE2 build; on a Ryzen 7700X a matched
build measures 1.86 Mnps against 1.11. Candidates are tried best-first and
each is run with uci/quit before being kept, so a wrong guess falls back
instead of dying mid-analysis. Packaging keeps using the generic build, so
a release never depends on the build machine's CPU."
```

---

### Task 11: Update the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the changes**

Add to the Getting Started section that `npm run setup:stockfish` now picks a CPU-matched build and records `vendor/stockfish/version.json`, and that packaging uses `vendor/stockfish-dist/` via `setup:stockfish:dist`.

Add a short note under Status that move classification and accuracy are computed on win probability, that accuracy follows Lichess's published aggregation and will read lower than a plain mean, and that an app update which changes the analysis rules asks for a rescan rather than discarding the cache.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document the analysis foundation changes in the README"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| 1.1 win probability unit | 1 |
| 1.2 retier classifyMove | 4 |
| 1.3 static exchange evaluation | 2, 3 |
| 1.4 gate brilliant / great | 5 |
| 1.5 isBestMove tolerance | 1 |
| 1.6 accuracy aggregation | 6 |
| 2.1 CPU-matched binary | 10 |
| 2.2 Threads and Hash | 8 |
| 2.3 scan on the pool | 9 |
| Migration | 7 |
| Testing | every task |

**Type consistency check:** `winPercentLoss` is introduced on `MoveEvalDelta` in Task 1 and consumed by `ClassifyMoveInput` in Task 4 and by `GameInsightMistake` in Task 7. `seeCp` is introduced on `AnalyzedPosition` in Task 3 and reaches `ClassifyMoveInput` in Task 5. `poolHashMb` is defined in Task 8 and used in Tasks 8 and 9. `createPool` replaces `createEngine` in Task 9 only. `isSchemaStale` is defined and consumed in Task 7.

**Deliberate ordering:** Task 3 keeps `ClassifyMoveInput.isPotentialSacrifice` alive so it can be reviewed independently of the classifier rewrite; Task 5 removes it. Task 7 comes after Tasks 4–6 so the schema bump reflects every rule change at once, and after Task 1 so `winPercentLoss` exists to persist.

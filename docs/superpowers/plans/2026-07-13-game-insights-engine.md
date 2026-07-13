# Game History Insights Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan a user's chess.com game history in the background, cache compact per-game "insight records," and surface recurring mistake patterns (game phase, hung-piece vs. positional, time pressure, weak openings, trend over time) as a synthesized report on the Insights tab.

**Architecture:** A chain of small, independently-tested pure functions in `src/main/insights/` turn a `GameAnalysisResult` (from the existing engine pipeline) into a compact `GameInsightRecord`, cache it to disk, and later aggregate every cached record into an `InsightsReport`. A `scanRunner` orchestrates fetch → filter-already-scanned → analyze (depth 14, reusing the existing Stockfish/`analyzeGame` pipeline) → extract → cache, with progress and cancellation. Two new IPC calls expose "run a scan" and "get the current report" to the renderer, which renders it on the Insights tab built in the UI-redesign plan.

**Tech Stack:** Electron, TypeScript, Vitest, chess.js, recharts (already a dependency).

## Global Constraints

- Depends on the desktop-packaging/settings plan (persisted `chessComUsername`) and the UI-redesign plan (the `InsightsTab` component and nav shell it extends) — implement those first.
- Scan up to the last 100 games; incremental afterward (never re-analyze an already-cached game).
- Analysis during a scan runs at depth 14 (vs. 18 for a single-game deep-dive) to keep scan time reasonable.
- No LLM/network call for generating findings — deterministic, rule-based templating only (per spec, keeps the app fully local).
- No named tactical-motif detection beyond the hung-piece check, no lichess import, no user-configurable scan range in the UI — all explicitly out of scope for v1.
- Cache storage is plain JSON files under `userData` (no database dependency), consistent with `settingsStore.ts`'s existing pattern.

---

### Task 1: Move `parsePgn` to shared code

**Files:**
- Create: `src/shared/pgn.ts` (moved from `src/renderer/src/lib/pgn.ts`)
- Create: `src/shared/pgn.test.ts` (moved from `src/renderer/src/lib/pgn.test.ts`)
- Delete: `src/renderer/src/lib/pgn.ts`, `src/renderer/src/lib/pgn.test.ts`
- Modify: `src/renderer/src/App.tsx` (update the import path)
- Modify: `src/main/analysis/classification.test.ts` (update stale path references in comments)

**Interfaces:**
- Produces: `parsePgn(pgn: string): AnalyzedPosition[]`, `PgnParseError` (same signatures as before, just relocated so `src/main/insights/scanRunner.ts`, added in Task 12, can use them from the main process too).

This is a pure relocation — no behavior changes, so the existing tests (moved as-is) are the verification.

- [ ] **Step 1: Move the implementation file**

Create `src/shared/pgn.ts` with the same content as the current `src/renderer/src/lib/pgn.ts`, with only the type import path updated (one directory level shallower):

```ts
import { Chess } from 'chess.js'
import type { AnalyzedPosition } from './types'

export class PgnParseError extends Error {}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function parsePgn(pgn: string): AnalyzedPosition[] {
  const chess = new Chess()

  try {
    chess.loadPgn(pgn)
  } catch (err) {
    throw new PgnParseError(err instanceof Error ? err.message : 'Invalid PGN')
  }

  const moves = chess.history({ verbose: true })
  if (moves.length === 0) {
    throw new PgnParseError('PGN contains no moves')
  }

  return moves.map((move, index) => {
    const ply = index + 1
    const moveNumber = Math.floor(index / 2) + 1
    const opponentColor = move.color === 'w' ? 'b' : 'w'
    const capturedValue = move.captured ? PIECE_VALUES[move.captured] : 0
    const movedValue = PIECE_VALUES[move.piece]
    const afterPosition = new Chess(move.after)
    const isPotentialSacrifice =
      capturedValue < movedValue && afterPosition.isAttacked(move.to, opponentColor)

    return {
      ply,
      moveNumber,
      color: move.color,
      san: move.san,
      moveUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore: move.before,
      fenAfter: move.after,
      isPotentialSacrifice
    }
  })
}
```

Delete `src/renderer/src/lib/pgn.ts`.

- [ ] **Step 2: Move the test file**

Create `src/shared/pgn.test.ts` with the exact same content as `src/renderer/src/lib/pgn.test.ts` (only the `import` line's relative path changes from `'./pgn'` — which stays `'./pgn'` since the test moves to the same directory as the implementation, so no change needed there at all):

```ts
import { describe, it, expect } from 'vitest'
import { parsePgn, PgnParseError } from './pgn'

const SAMPLE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`

describe('parsePgn', () => {
  it('returns one position per ply, in order', () => {
    const positions = parsePgn(SAMPLE_PGN)
    expect(positions).toHaveLength(10)
    expect(positions[0]).toMatchObject({ ply: 1, moveNumber: 1, color: 'w', san: 'e4' })
    expect(positions[9]).toMatchObject({ ply: 10, moveNumber: 5, color: 'b', san: 'Be7' })
  })

  it('chains fenAfter of one move into fenBefore of the next', () => {
    const positions = parsePgn(SAMPLE_PGN)
    expect(positions[0].fenAfter).toBe(positions[1].fenBefore)
  })

  it('flags a piece sacrifice landing on an attacked square', () => {
    const sacrificePgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7'
    const positions = parsePgn(sacrificePgn)
    const knightSac = positions[positions.length - 1]
    expect(knightSac.san).toBe('Nxf7')
    expect(knightSac.isPotentialSacrifice).toBe(true)
  })

  it('does not flag an even trade as a sacrifice', () => {
    const evenTradePgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6'
    const positions = parsePgn(evenTradePgn)
    const trade = positions[positions.length - 1]
    expect(trade.san).toBe('Bxc6')
    expect(trade.isPotentialSacrifice).toBe(false)
  })

  it('flags 3...a6 in the Ruy Lopez as a "potential sacrifice" (coarse heuristic, by design)', () => {
    // This is the root cause behind the false-positive "brilliant"
    // classification the final review found: a6 is a completely standard
    // theoretical move, but its destination square is attacked by the
    // bishop on b5, and this heuristic treats "non-capturing move to an
    // attacked square" as a potential sacrifice regardless of piece value.
    // The fix lives in the opening book (src/main/analysis/openingBook.ts),
    // which now covers this line so classifyMove tags a6 "book" before it
    // ever reaches the sacrifice/brilliant path -- see
    // src/main/analysis/classification.test.ts and
    // src/main/analysis/openingBook.test.ts. This test just documents and
    // locks in the heuristic's actual (coarse, v1) behavior.
    const positions = parsePgn(SAMPLE_PGN)
    const a6 = positions.find((p) => p.san === 'a6')
    expect(a6?.isPotentialSacrifice).toBe(true)
  })

  it('throws PgnParseError for malformed PGN', () => {
    expect(() => parsePgn('1. e4 Zz9')).toThrow(PgnParseError)
  })

  it('throws PgnParseError for a PGN with no moves', () => {
    expect(() => parsePgn('[Event "Empty"]')).toThrow(PgnParseError)
  })
})
```

Delete `src/renderer/src/lib/pgn.test.ts`.

- [ ] **Step 3: Update the one real import site**

In `src/renderer/src/App.tsx`, change:

```ts
import { parsePgn, PgnParseError } from './lib/pgn'
```

to:

```ts
import { parsePgn, PgnParseError } from '../../shared/pgn'
```

- [ ] **Step 4: Update stale path references in a comment**

In `src/main/analysis/classification.test.ts`, find the comment inside `'does not classify 3...a6 in the Ruy Lopez as brilliant (regression)'` that reads:

```ts
    // src/renderer/src/lib/pgn.ts's isPotentialSacrifice flags it as a
    // potential sacrifice (verified directly by
    // src/renderer/src/lib/pgn.test.ts and by driving the real analyzeGame
```

and update the two paths to:

```ts
    // src/shared/pgn.ts's isPotentialSacrifice flags it as a
    // potential sacrifice (verified directly by
    // src/shared/pgn.test.ts and by driving the real analyzeGame
```

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npm test`
Expected: PASS, same total test count as before the move (the 7 `parsePgn` tests still run, just from `src/shared/pgn.test.ts` instead of `src/renderer/src/lib/pgn.test.ts`).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/pgn.ts src/shared/pgn.test.ts src/renderer/src/App.tsx src/main/analysis/classification.test.ts
git rm src/renderer/src/lib/pgn.ts src/renderer/src/lib/pgn.test.ts
git commit -m "Move parsePgn to shared code so the main process can use it for batch scans"
```

---

### Task 2: Name the opening book lines and add a full-game matcher

**Files:**
- Modify: `src/main/analysis/openingBook.ts`
- Modify: `src/main/analysis/openingBook.test.ts`

**Interfaces:**
- Produces: `matchOpeningName(sanHistory: string[]): string | null` — consumed by `extractInsightRecord.ts` (Task 8).
- `isBookMove(sanHistory: string[], ply: number): boolean` keeps its existing signature and behavior (internal representation changes, callers in `gameAnalyzer.ts` are unaffected).

- [ ] **Step 1: Replace openingBook.ts with a named-line structure**

Replace the entire contents of `src/main/analysis/openingBook.ts` with:

```ts
export interface OpeningBookLine {
  name: string
  moves: string[]
}

export const OPENING_BOOK_LINES: OpeningBookLine[] = [
  {
    name: 'Ruy Lopez, Morphy Defense',
    // Extended from a bare 3.Bb5 so that well-known developing/theory
    // moves like 3...a6 are tagged "book" instead of falling through to
    // the sacrifice/brilliant heuristic (a6's destination square is
    // "attacked" by the bishop on b5, which the coarse sacrifice heuristic
    // in shared/pgn.ts misreads as a potential sacrifice).
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']
  },
  {
    name: 'Italian Game, Giuoco Pianissimo',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3']
  },
  {
    name: "Petrov's Defense",
    moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3']
  },
  {
    name: 'Sicilian Defense, Najdorf',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5']
  },
  {
    name: 'Sicilian Defense, Open (2...Nc6)',
    moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3']
  },
  {
    name: 'Caro-Kann Defense, Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5']
  },
  {
    name: 'French Defense, Classical',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7']
  },
  {
    name: 'Scandinavian Defense',
    moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5']
  },
  {
    name: 'Modern Defense',
    moves: ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6']
  },
  {
    name: "Alekhine's Defense",
    moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6']
  },
  {
    name: "Queen's Gambit Declined",
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6']
  },
  {
    name: "King's Indian Defense, Classical",
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6']
  },
  {
    name: 'Nimzo-Indian Defense, Rubinstein',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O']
  },
  {
    name: 'Dutch Defense, Leningrad',
    moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2']
  },
  {
    name: 'English Opening, Reversed Sicilian',
    moves: ['c4', 'e5', 'Nc3', 'Nf6']
  },
  {
    name: 'Reti Opening',
    moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']
  }
]

export function isBookMove(sanHistory: string[], ply: number): boolean {
  const movesSoFar = sanHistory.slice(0, ply)
  return OPENING_BOOK_LINES.some(
    (line) => line.moves.length >= movesSoFar.length && movesSoFar.every((san, i) => line.moves[i] === san)
  )
}

// Identifies a whole game's opening as the longest book line that is a
// complete prefix of its move list. Deliberately coarse (same style as
// isBookMove): a game that deviates before completing any full book line
// returns null rather than guessing a "closest" match.
export function matchOpeningName(sanHistory: string[]): string | null {
  let bestMatch: OpeningBookLine | null = null

  for (const line of OPENING_BOOK_LINES) {
    if (line.moves.length > sanHistory.length) continue
    const matches = line.moves.every((san, i) => san === sanHistory[i])
    if (matches && (!bestMatch || line.moves.length > bestMatch.moves.length)) {
      bestMatch = line
    }
  }

  return bestMatch?.name ?? null
}
```

- [ ] **Step 2: Add tests for matchOpeningName**

In `src/main/analysis/openingBook.test.ts`, add (the existing `isBookMove` describe block needs no changes — its behavior is identical):

```ts
import { describe, it, expect } from 'vitest'
import { isBookMove, matchOpeningName } from './openingBook'
```

(only the import line changes, to add `matchOpeningName`), then append a new describe block at the end of the file:

```ts
describe('matchOpeningName', () => {
  it('identifies a game that fully completes a known book line', () => {
    const sanHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5']
    expect(matchOpeningName(sanHistory)).toBe('Ruy Lopez, Morphy Defense')
  })

  it('returns null for a game that deviates before completing any book line', () => {
    expect(matchOpeningName(['e4', 'e5', 'Nf3', 'd6'])).toBeNull()
  })

  it('returns null for a game shorter than every book line', () => {
    expect(matchOpeningName(['e4', 'e5'])).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/main/analysis/openingBook.test.ts`
Expected: PASS (existing `isBookMove` tests plus the 3 new `matchOpeningName` tests).

- [ ] **Step 4: Commit**

```bash
git add src/main/analysis/openingBook.ts src/main/analysis/openingBook.test.ts
git commit -m "Name opening book lines and add a full-game opening matcher"
```

---

### Task 3: Define insights data types

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `TimeControlCategory`, `GamePhase`, `GameInsightMistake`, `GameInsightRecord`, `ScanMeta`, `PhaseBreakdown`, `OpeningStat`, `TrendPoint`, `InsightsBucketKey`, `InsightsBucket`, `TopFinding`, `InsightsReport`, `ScanProgress`, `ScanOutcome` — consumed by every task in this plan from Task 4 onward.

No unit test for this task (pure type declarations) — verified by a clean typecheck, consistent with how this plan's other pure-wiring/type tasks are verified.

- [ ] **Step 1: Add the insights types**

In `src/shared/types.ts`, add at the end of the file:

```ts
export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'daily'

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

export interface GameInsightMistake {
  ply: number
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  isHungPiece: boolean
  clockSecondsRemaining: number | null
  isTimePressure: boolean
}

export interface GameInsightRecord {
  gameUrl: string
  endTime: number
  timeControlCategory: TimeControlCategory
  userColor: 'w' | 'b'
  result: 'win' | 'loss' | 'draw'
  openingName: string | null
  accuracy: number
  mistakes: GameInsightMistake[]
}

export interface ScanMeta {
  username: string | null
  lastScanTime: number | null
  scannedUrls: string[]
}

export interface PhaseBreakdown {
  opening: number
  middlegame: number
  endgame: number
}

export interface OpeningStat {
  name: string
  games: number
  accuracy: number
}

export interface TrendPoint {
  gameIndex: number
  endTime: number
  rollingAccuracy: number
}

export type InsightsBucketKey = 'overall' | TimeControlCategory

export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  hungPieceCount: number
  positionalCount: number
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
}

export interface TopFinding {
  text: string
  significance: number
}

export interface InsightsReport {
  gamesScanned: number
  lastScanTime: number | null
  topFindings: TopFinding[]
  buckets: InsightsBucket[]
}

export interface ScanProgress {
  scanned: number
  total: number
}

export type ScanOutcome = { scanned: number } | { cancelled: true } | { error: string }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add shared types for the game-insights engine"
```

---

### Task 4: Game phase heuristic

**Files:**
- Create: `src/main/insights/phaseHeuristic.ts`
- Test: `src/main/insights/phaseHeuristic.test.ts`

**Interfaces:**
- Consumes: `GamePhase` (Task 3).
- Produces: `gamePhaseAt(fenAfter: string, ply: number): GamePhase` — consumed by `extractInsightRecord.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/phaseHeuristic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gamePhaseAt } from './phaseHeuristic'

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const KR_VS_KR_ENDGAME_FEN = '8/8/4k3/8/8/4K3/8/R6r w - - 0 40'
const FULL_MATERIAL_MIDDLEGAME_FEN =
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

describe('gamePhaseAt', () => {
  it('is always "opening" before ply 20 regardless of material', () => {
    expect(gamePhaseAt(STARTING_FEN, 1)).toBe('opening')
    expect(gamePhaseAt(KR_VS_KR_ENDGAME_FEN, 19)).toBe('opening')
  })

  it('is "middlegame" past ply 20 with substantial material on the board', () => {
    expect(gamePhaseAt(FULL_MATERIAL_MIDDLEGAME_FEN, 20)).toBe('middlegame')
  })

  it('is "endgame" past ply 20 once both sides are down to a rook or less', () => {
    expect(gamePhaseAt(KR_VS_KR_ENDGAME_FEN, 45)).toBe('endgame')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/phaseHeuristic.test.ts`
Expected: FAIL — `Cannot find module './phaseHeuristic'`.

- [ ] **Step 3: Implement the heuristic**

Create `src/main/insights/phaseHeuristic.ts`:

```ts
import { Chess } from 'chess.js'
import type { GamePhase } from '../../shared/types'

const OPENING_PLY_CEILING = 20
// Roughly "a rook plus one minor piece" combined value, per side -- below
// this, a side has too little material left for the position to still be
// considered a middlegame.
const ENDGAME_MATERIAL_CEILING = 8

const PIECE_VALUES: Record<string, number> = { p: 0, n: 3, b: 3, r: 5, q: 9, k: 0 }

function nonPawnMaterial(fen: string, color: 'w' | 'b'): number {
  const board = new Chess(fen).board()
  let total = 0
  for (const row of board) {
    for (const square of row) {
      if (square && square.color === color) {
        total += PIECE_VALUES[square.type]
      }
    }
  }
  return total
}

export function gamePhaseAt(fenAfter: string, ply: number): GamePhase {
  if (ply < OPENING_PLY_CEILING) return 'opening'

  const whiteMaterial = nonPawnMaterial(fenAfter, 'w')
  const blackMaterial = nonPawnMaterial(fenAfter, 'b')
  const isEndgame =
    whiteMaterial <= ENDGAME_MATERIAL_CEILING && blackMaterial <= ENDGAME_MATERIAL_CEILING

  return isEndgame ? 'endgame' : 'middlegame'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/phaseHeuristic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/phaseHeuristic.ts src/main/insights/phaseHeuristic.test.ts
git commit -m "Add game-phase heuristic for insights (opening/middlegame/endgame)"
```

---

### Task 5: Hung-piece detector

**Files:**
- Create: `src/main/insights/hungPieceDetector.ts`
- Test: `src/main/insights/hungPieceDetector.test.ts`

**Interfaces:**
- Consumes: `EngineLine` (existing, `src/shared/types.ts`).
- Produces: `isHungPieceBlunder(fenAfterBlunder: string, opponentBestLine: EngineLine | undefined): boolean` — consumed by `extractInsightRecord.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/hungPieceDetector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isHungPieceBlunder } from './hungPieceDetector'
import type { EngineLine } from '../../shared/types'

function line(pv: string[]): EngineLine {
  return { depth: 14, scoreCp: -500, scoreMate: null, moveUci: pv[0], pv }
}

describe('isHungPieceBlunder', () => {
  it('is true when the opponent can capture a piece with no possible recapture', () => {
    // Black queen d8, white rook d1 (undefended -- king is on h1, out of
    // reach), black to move. Qxd1 wins the rook for free.
    const fenAfterBlunder = '3qk3/8/8/8/8/8/8/3R3K b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['d8d1']))).toBe(true)
  })

  it('is false when the blundering side can recapture on the same square', () => {
    // Same idea, but a second white rook on a1 defends d1 along the first
    // rank, so after Qxd1, Rxd1 recaptures.
    const fenAfterBlunder = '3qk3/8/8/8/8/8/8/R2R3K b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['d8d1']))).toBe(false)
  })

  it("is false when the opponent's best reply is not a capture", () => {
    const fenAfterBlunder = '4k3/8/8/8/8/8/4K3/7q b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['h1h4']))).toBe(false)
  })

  it('is false when there is no PV to inspect', () => {
    expect(isHungPieceBlunder('4k3/8/8/8/8/8/8/4K3 w - - 0 1', undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/hungPieceDetector.test.ts`
Expected: FAIL — `Cannot find module './hungPieceDetector'`.

- [ ] **Step 3: Implement the detector**

Create `src/main/insights/hungPieceDetector.ts`:

```ts
import { Chess } from 'chess.js'
import type { EngineLine } from '../../shared/types'

function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined
  }
}

// One-ply lookahead, not a full static-exchange evaluation: checks whether
// the opponent's top engine line is a capture that the blundering side has
// no legal recapture for. This deliberately doesn't account for deeper
// tactics (e.g. a recapture that itself loses more material) -- it's a
// coarse "did you just hang a piece for free" signal, not a full SEE.
export function isHungPieceBlunder(
  fenAfterBlunder: string,
  opponentBestLine: EngineLine | undefined
): boolean {
  if (!opponentBestLine || opponentBestLine.pv.length === 0) return false

  const chess = new Chess(fenAfterBlunder)
  const replyMove = uciToMove(opponentBestLine.pv[0])

  let moveResult
  try {
    moveResult = chess.move(replyMove)
  } catch {
    return false
  }
  if (!moveResult?.captured) return false

  const canRecapture = chess.moves({ verbose: true }).some((m) => m.to === replyMove.to && m.captured)

  return !canRecapture
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/hungPieceDetector.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/hungPieceDetector.ts src/main/insights/hungPieceDetector.test.ts
git commit -m "Add hung-piece vs. positional blunder detector"
```

---

### Task 6: Time-control categorization and clock parsing

**Files:**
- Create: `src/main/insights/timeControl.ts`
- Test: `src/main/insights/timeControl.test.ts`

**Interfaces:**
- Consumes: `TimeControlCategory` (Task 3).
- Produces: `categorizeTimeControl(timeControl: string): TimeControlCategory`, `parseClockSeconds(pgn: string): number[]`, `isTimePressureMove(clockSecondsRemaining: number, baseSeconds: number): boolean`, `baseSecondsFromTimeControl(timeControl: string): number | null` — all consumed by `extractInsightRecord.ts` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/timeControl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  categorizeTimeControl,
  parseClockSeconds,
  isTimePressureMove,
  baseSecondsFromTimeControl
} from './timeControl'

describe('categorizeTimeControl', () => {
  it('categorizes under 3 minutes as bullet', () => {
    expect(categorizeTimeControl('60')).toBe('bullet')
    expect(categorizeTimeControl('120+1')).toBe('bullet')
  })

  it('categorizes 3-10 minutes as blitz', () => {
    expect(categorizeTimeControl('180')).toBe('blitz')
    expect(categorizeTimeControl('300+5')).toBe('blitz')
  })

  it('categorizes 10 minutes or more as rapid', () => {
    expect(categorizeTimeControl('600')).toBe('rapid')
    expect(categorizeTimeControl('900+10')).toBe('rapid')
  })

  it('categorizes the day-based correspondence format as daily', () => {
    expect(categorizeTimeControl('1/86400')).toBe('daily')
  })
})

describe('parseClockSeconds', () => {
  it('parses %clk comments in order into total seconds', () => {
    const pgn = '1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:55]} 2. Nf3 {[%clk 0:09:50]}'
    expect(parseClockSeconds(pgn)).toEqual([598, 595, 590])
  })

  it('returns an empty array when the PGN has no clock annotations', () => {
    expect(parseClockSeconds('1. e4 e5 2. Nf3 Nc6')).toEqual([])
  })
})

describe('isTimePressureMove', () => {
  it('is true under 10% of the starting allotment', () => {
    expect(isTimePressureMove(25, 300)).toBe(true)
  })

  it('is false at or above 10% of the starting allotment', () => {
    expect(isTimePressureMove(30, 300)).toBe(false)
  })
})

describe('baseSecondsFromTimeControl', () => {
  it('parses the base seconds, ignoring increment', () => {
    expect(baseSecondsFromTimeControl('180+2')).toBe(180)
  })

  it('returns null for the daily/correspondence format', () => {
    expect(baseSecondsFromTimeControl('1/86400')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/timeControl.test.ts`
Expected: FAIL — `Cannot find module './timeControl'`.

- [ ] **Step 3: Implement the module**

Create `src/main/insights/timeControl.ts`:

```ts
import type { TimeControlCategory } from '../../shared/types'

export function categorizeTimeControl(timeControl: string): TimeControlCategory {
  if (timeControl.includes('/')) return 'daily'
  const baseSeconds = Number(timeControl.split('+')[0])
  if (baseSeconds < 180) return 'bullet'
  if (baseSeconds < 600) return 'blitz'
  return 'rapid'
}

const CLOCK_PATTERN = /\{\[%clk (\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]\}/g

// Returns one entry per %clk annotation found, in the order they appear in
// the PGN text -- chess.com's export places one after every ply, so this
// lines up 1:1 with plies for games that have clock data at all. Returns
// an empty array (not one null per ply) when the PGN has none, so callers
// can tell "no clock data for this game" apart from "clock data exists".
export function parseClockSeconds(pgn: string): number[] {
  return [...pgn.matchAll(CLOCK_PATTERN)].map((match) => {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    const seconds = Number(match[3])
    return hours * 3600 + minutes * 60 + seconds
  })
}

const TIME_PRESSURE_FRACTION = 0.1

export function isTimePressureMove(clockSecondsRemaining: number, baseSeconds: number): boolean {
  if (baseSeconds <= 0) return false
  return clockSecondsRemaining < baseSeconds * TIME_PRESSURE_FRACTION
}

export function baseSecondsFromTimeControl(timeControl: string): number | null {
  if (timeControl.includes('/')) return null
  const base = Number(timeControl.split('+')[0])
  return Number.isFinite(base) ? base : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/timeControl.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/timeControl.ts src/main/insights/timeControl.test.ts
git commit -m "Add time-control categorization and PGN clock-annotation parsing"
```

---

### Task 7: Trend bucketing

**Files:**
- Create: `src/main/insights/trendBucketing.ts`
- Test: `src/main/insights/trendBucketing.test.ts`

**Interfaces:**
- Consumes: `GameInsightRecord`, `TrendPoint` (Task 3).
- Produces: `buildTrend(records: GameInsightRecord[]): TrendPoint[]` — consumed by `reportAggregator.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/trendBucketing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTrend } from './trendBucketing'
import type { GameInsightRecord } from '../../shared/types'

function record(endTime: number, accuracy: number): GameInsightRecord {
  return {
    gameUrl: `https://www.chess.com/game/live/${endTime}`,
    endTime,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy,
    mistakes: []
  }
}

describe('buildTrend', () => {
  it('sorts by endTime and computes a rolling accuracy average', () => {
    const records = [record(300, 80), record(100, 90), record(200, 70)]
    const trend = buildTrend(records)

    expect(trend.map((t) => t.endTime)).toEqual([100, 200, 300])
    expect(trend[0].rollingAccuracy).toBe(90)
    expect(trend[1].rollingAccuracy).toBe(80)
    expect(trend[2].rollingAccuracy).toBeCloseTo(80)
  })

  it('caps the rolling window at 10 games', () => {
    const records = Array.from({ length: 12 }, (_, i) => record(i, i < 2 ? 0 : 100))
    const trend = buildTrend(records)

    // By index 11, the window covers indices 2-11 (10 games), all accuracy 100.
    expect(trend[11].rollingAccuracy).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/trendBucketing.test.ts`
Expected: FAIL — `Cannot find module './trendBucketing'`.

- [ ] **Step 3: Implement the module**

Create `src/main/insights/trendBucketing.ts`:

```ts
import type { GameInsightRecord, TrendPoint } from '../../shared/types'

const ROLLING_WINDOW_SIZE = 10

export function buildTrend(records: GameInsightRecord[]): TrendPoint[] {
  const sorted = [...records].sort((a, b) => a.endTime - b.endTime)

  return sorted.map((current, index) => {
    const windowStart = Math.max(0, index - ROLLING_WINDOW_SIZE + 1)
    const window = sorted.slice(windowStart, index + 1)
    const rollingAccuracy = window.reduce((sum, r) => sum + r.accuracy, 0) / window.length

    return { gameIndex: index, endTime: current.endTime, rollingAccuracy }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/trendBucketing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/trendBucketing.ts src/main/insights/trendBucketing.test.ts
git commit -m "Add rolling-window trend bucketing for insights"
```

---

### Task 8: extractInsightRecord orchestrator

**Files:**
- Create: `src/main/insights/extractInsightRecord.ts`
- Test: `src/main/insights/extractInsightRecord.test.ts`

**Interfaces:**
- Consumes: `gamePhaseAt` (Task 4), `isHungPieceBlunder` (Task 5), `categorizeTimeControl`/`parseClockSeconds`/`isTimePressureMove`/`baseSecondsFromTimeControl` (Task 6), `matchOpeningName` (Task 2), `ChessComGameSummary`/`GameAnalysisResult`/`GameInsightRecord` (existing/Task 3).
- Produces: `extractInsightRecord(game: ChessComGameSummary, analysis: GameAnalysisResult, username: string): GameInsightRecord` — consumed by `scanRunner.ts` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/extractInsightRecord.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractInsightRecord } from './extractInsightRecord'
import type { AnalyzedMove, ChessComGameSummary, GameAnalysisResult } from '../../shared/types'

const HUNG_ROOK_FEN = '3qk3/8/8/8/8/8/8/3R3K b - - 0 1'
const QUIET_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

function move(
  overrides: Partial<AnalyzedMove> &
    Pick<AnalyzedMove, 'ply' | 'color' | 'san' | 'classification' | 'fenAfter'>
): AnalyzedMove {
  return {
    moveNumber: Math.ceil(overrides.ply / 2),
    moveUci: 'e2e4',
    fenBefore: QUIET_FEN,
    isPotentialSacrifice: false,
    evalBefore: { lines: [] },
    evalAfter: { lines: [] },
    accuracy: 100,
    ...overrides
  }
}

function chessComGame(overrides: Partial<ChessComGameSummary> = {}): ChessComGameSummary {
  return {
    url: 'https://www.chess.com/game/live/1',
    pgn: '1. e4 e5 2. Nf3 Nc6',
    endTime: 1700000000,
    timeControl: '600',
    white: { username: 'testuser', rating: 1500, result: 'win' },
    black: { username: 'opponent', rating: 1490, result: 'checkmated' },
    ...overrides
  }
}

describe('extractInsightRecord', () => {
  it('identifies the user color by matching username against white/black (case-insensitively)', () => {
    const analysis: GameAnalysisResult = {
      moves: [move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN })],
      whiteAccuracy: 95,
      blackAccuracy: 80
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'TestUser')
    expect(record.userColor).toBe('w')
    expect(record.accuracy).toBe(95)
    expect(record.result).toBe('win')
  })

  it('only records mistakes/blunders made by the tracked user, tagging phase and hung-piece status', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN }),
        move({
          ply: 25,
          color: 'w',
          san: 'Rd1??',
          classification: 'blunder',
          fenAfter: HUNG_ROOK_FEN,
          evalAfter: {
            lines: [{ depth: 14, scoreCp: -900, scoreMate: null, moveUci: 'd8d1', pv: ['d8d1'] }]
          }
        }),
        move({ ply: 26, color: 'b', san: 'Qxd1', classification: 'best', fenAfter: QUIET_FEN })
      ],
      whiteAccuracy: 60,
      blackAccuracy: 95
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'testuser')

    expect(record.mistakes).toHaveLength(1)
    expect(record.mistakes[0]).toMatchObject({
      ply: 25,
      classification: 'blunder',
      phase: 'middlegame',
      isHungPiece: true
    })
  })

  it('categorizes the time control from the game', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN }),
        move({ ply: 2, color: 'b', san: 'e5', classification: 'book', fenAfter: QUIET_FEN })
      ],
      whiteAccuracy: 90,
      blackAccuracy: 90
    }

    const record = extractInsightRecord(chessComGame({ timeControl: '180+2' }), analysis, 'testuser')
    expect(record.timeControlCategory).toBe('bullet')
  })

  it('leaves clockSecondsRemaining null and isTimePressure false when the PGN has no clock data', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({
          ply: 25,
          color: 'w',
          san: 'Rd1??',
          classification: 'blunder',
          fenAfter: HUNG_ROOK_FEN
        })
      ],
      whiteAccuracy: 60,
      blackAccuracy: 95
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'testuser')
    expect(record.mistakes[0].clockSecondsRemaining).toBeNull()
    expect(record.mistakes[0].isTimePressure).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/extractInsightRecord.test.ts`
Expected: FAIL — `Cannot find module './extractInsightRecord'`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/main/insights/extractInsightRecord.ts`:

```ts
import type {
  ChessComGameSummary,
  GameAnalysisResult,
  GameInsightMistake,
  GameInsightRecord
} from '../../shared/types'
import { gamePhaseAt } from './phaseHeuristic'
import { isHungPieceBlunder } from './hungPieceDetector'
import {
  categorizeTimeControl,
  parseClockSeconds,
  isTimePressureMove,
  baseSecondsFromTimeControl
} from './timeControl'
import { matchOpeningName } from '../analysis/openingBook'

const LOSS_RESULTS = new Set(['checkmated', 'resigned', 'timeout', 'abandoned'])

function resultFor(color: 'w' | 'b', game: ChessComGameSummary): 'win' | 'loss' | 'draw' {
  const playerResult = color === 'w' ? game.white.result : game.black.result
  if (playerResult === 'win') return 'win'
  if (LOSS_RESULTS.has(playerResult)) return 'loss'
  return 'draw'
}

export function extractInsightRecord(
  game: ChessComGameSummary,
  analysis: GameAnalysisResult,
  username: string
): GameInsightRecord {
  const normalizedUsername = username.trim().toLowerCase()
  const userColor: 'w' | 'b' = game.black.username.toLowerCase() === normalizedUsername ? 'b' : 'w'

  const clockSeconds = parseClockSeconds(game.pgn)
  const hasClockData = clockSeconds.length === analysis.moves.length
  const baseSeconds = baseSecondsFromTimeControl(game.timeControl)

  const sanHistory = analysis.moves.map((m) => m.san)
  const openingName = matchOpeningName(sanHistory)

  const mistakes: GameInsightMistake[] = analysis.moves
    .filter(
      (move) =>
        move.color === userColor && (move.classification === 'mistake' || move.classification === 'blunder')
    )
    .map((move) => {
      const clockSecondsRemaining = hasClockData ? clockSeconds[move.ply - 1] : null
      return {
        ply: move.ply,
        classification: move.classification as 'mistake' | 'blunder',
        phase: gamePhaseAt(move.fenAfter, move.ply),
        isHungPiece: isHungPieceBlunder(move.fenAfter, move.evalAfter.lines[0]),
        clockSecondsRemaining,
        isTimePressure:
          clockSecondsRemaining !== null && baseSeconds !== null
            ? isTimePressureMove(clockSecondsRemaining, baseSeconds)
            : false
      }
    })

  return {
    gameUrl: game.url,
    endTime: game.endTime,
    timeControlCategory: categorizeTimeControl(game.timeControl),
    userColor,
    result: resultFor(userColor, game),
    openingName,
    accuracy: userColor === 'w' ? analysis.whiteAccuracy : analysis.blackAccuracy,
    mistakes
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/extractInsightRecord.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/extractInsightRecord.ts src/main/insights/extractInsightRecord.test.ts
git commit -m "Add extractInsightRecord to derive a compact insight record from an analyzed game"
```

---

### Task 9: Insights local cache store

**Files:**
- Create: `src/main/insights/insightsStore.ts`
- Test: `src/main/insights/insightsStore.test.ts`

**Interfaces:**
- Consumes: `GameInsightRecord`, `ScanMeta` (Task 3).
- Produces: `loadScanMeta(): ScanMeta`, `saveScanMeta(patch: Partial<ScanMeta>): ScanMeta`, `isGameScanned(gameUrl: string): boolean`, `saveGameRecord(record: GameInsightRecord): void`, `loadAllGameRecords(): GameInsightRecord[]` — consumed by `scanRunner.ts` (Task 12) and the IPC handler (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/insightsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
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

import { loadScanMeta, saveScanMeta, isGameScanned, saveGameRecord, loadAllGameRecords } from './insightsStore'
import type { GameInsightRecord } from '../../shared/types'

function record(gameUrl: string): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: []
  }
}

describe('insightsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-insights-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({ username: null, lastScanTime: null, scannedUrls: [] })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({ username: 'hikaru', lastScanTime: 12345, scannedUrls: [] })
  })

  it('a game is not scanned until its record is saved', () => {
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  it('treats a corrupted per-game cache file as not scanned, even if scan-meta lists it', () => {
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    const dir = join(userDataDir, 'games')
    const [fileName] = readdirSync(dir)
    writeFileSync(join(dir, fileName), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
  })

  it('loadAllGameRecords returns every saved record and skips corrupted files', () => {
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    saveGameRecord(record('https://www.chess.com/game/live/2'))
    mkdirSync(join(userDataDir, 'games'), { recursive: true })
    writeFileSync(join(userDataDir, 'games', 'garbage.json'), 'not json', 'utf-8')

    const records = loadAllGameRecords()
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.gameUrl).sort()).toEqual([
      'https://www.chess.com/game/live/1',
      'https://www.chess.com/game/live/2'
    ])
  })

  it('returns an empty array when no games directory exists yet', () => {
    expect(loadAllGameRecords()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/insightsStore.test.ts`
Expected: FAIL — `Cannot find module './insightsStore'`.

- [ ] **Step 3: Implement the store**

Create `src/main/insights/insightsStore.ts`:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { GameInsightRecord, ScanMeta } from '../../shared/types'

const DEFAULT_SCAN_META: ScanMeta = { username: null, lastScanTime: null, scannedUrls: [] }

function gamesDir(): string {
  return join(app.getPath('userData'), 'games')
}

function scanMetaPath(): string {
  return join(app.getPath('userData'), 'scan-meta.json')
}

function gameRecordPath(gameUrl: string): string {
  const hash = createHash('sha1').update(gameUrl).digest('hex')
  return join(gamesDir(), `${hash}.json`)
}

export function loadScanMeta(): ScanMeta {
  const path = scanMetaPath()
  if (!existsSync(path)) return { ...DEFAULT_SCAN_META }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScanMeta>
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      lastScanTime: typeof parsed.lastScanTime === 'number' ? parsed.lastScanTime : null,
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : []
    }
  } catch {
    return { ...DEFAULT_SCAN_META }
  }
}

export function saveScanMeta(patch: Partial<ScanMeta>): ScanMeta {
  const merged = { ...loadScanMeta(), ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(scanMetaPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

export function isGameScanned(gameUrl: string): boolean {
  if (!loadScanMeta().scannedUrls.includes(gameUrl)) return false

  const path = gameRecordPath(gameUrl)
  if (!existsSync(path)) return false
  try {
    JSON.parse(readFileSync(path, 'utf-8'))
    return true
  } catch {
    return false
  }
}

export function saveGameRecord(record: GameInsightRecord): void {
  mkdirSync(gamesDir(), { recursive: true })
  writeFileSync(gameRecordPath(record.gameUrl), JSON.stringify(record, null, 2), 'utf-8')

  const meta = loadScanMeta()
  if (!meta.scannedUrls.includes(record.gameUrl)) {
    saveScanMeta({ scannedUrls: [...meta.scannedUrls, record.gameUrl] })
  }
}

export function loadAllGameRecords(): GameInsightRecord[] {
  const dir = gamesDir()
  if (!existsSync(dir)) return []

  const records: GameInsightRecord[] = []
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith('.json')) continue
    try {
      records.push(JSON.parse(readFileSync(join(dir, fileName), 'utf-8')) as GameInsightRecord)
    } catch {
      // Skip a corrupted per-game cache file rather than failing the whole
      // report -- isGameScanned() also treats it as unscanned, so it will
      // be re-fetched and re-analyzed on the next scan.
    }
  }
  return records
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/insightsStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/insightsStore.ts src/main/insights/insightsStore.test.ts
git commit -m "Add local cache store for scanned game insight records"
```

---

### Task 10: Report aggregator

**Files:**
- Create: `src/main/insights/reportAggregator.ts`
- Test: `src/main/insights/reportAggregator.test.ts`

**Interfaces:**
- Consumes: `GameInsightRecord`, `InsightsBucket`, `InsightsBucketKey`, `InsightsReport`, `OpeningStat`, `PhaseBreakdown`, `TimeControlCategory` (Task 3), `buildTrend` (Task 7).
- Produces: `buildInsightsReport(records: GameInsightRecord[], lastScanTime: number | null): Omit<InsightsReport, 'topFindings'>` — consumed by `topFindings.ts` (Task 11) and the IPC handler (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/reportAggregator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildInsightsReport } from './reportAggregator'
import type { GameInsightRecord } from '../../shared/types'

function record(overrides: Partial<GameInsightRecord>): GameInsightRecord {
  return {
    gameUrl: 'https://www.chess.com/game/live/1',
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    ...overrides
  }
}

describe('buildInsightsReport', () => {
  it('always includes an overall bucket, plus one bucket per time control that has games', () => {
    const records = [
      record({ gameUrl: 'g1', timeControlCategory: 'bullet' }),
      record({ gameUrl: 'g2', timeControlCategory: 'rapid' })
    ]

    const report = buildInsightsReport(records, null)
    expect(report.buckets.map((b) => b.key).sort()).toEqual(['bullet', 'overall', 'rapid'])
  })

  it('flags a bucket with fewer than 5 games as not having enough data', () => {
    const records = [record({ gameUrl: 'g1' }), record({ gameUrl: 'g2' })]
    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.hasEnoughData).toBe(false)
  })

  it('tallies phase breakdown and the hung-piece/positional split across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [
          {
            ply: 5,
            classification: 'blunder',
            phase: 'opening',
            isHungPiece: true,
            clockSecondsRemaining: null,
            isTimePressure: false
          },
          {
            ply: 40,
            classification: 'mistake',
            phase: 'endgame',
            isHungPiece: false,
            clockSecondsRemaining: null,
            isTimePressure: false
          }
        ]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.totalMistakes).toBe(2)
    expect(overall.phaseBreakdown).toEqual({ opening: 1, middlegame: 0, endgame: 1 })
    expect(overall.hungPieceCount).toBe(1)
    expect(overall.positionalCount).toBe(1)
  })

  it('counts time-pressure mistakes across all games in the bucket', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [
          {
            ply: 30,
            classification: 'blunder',
            phase: 'middlegame',
            isHungPiece: false,
            clockSecondsRemaining: 5,
            isTimePressure: true
          }
        ]
      })
    ]

    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.timePressureCount).toBe(1)
  })

  it('only surfaces an opening once it has at least 3 games, sorted weakest-accuracy first', () => {
    const records = [
      record({ gameUrl: 'g1', openingName: 'Caro-Kann Defense, Classical', accuracy: 60 }),
      record({ gameUrl: 'g2', openingName: 'Caro-Kann Defense, Classical', accuracy: 70 }),
      record({ gameUrl: 'g3', openingName: 'Caro-Kann Defense, Classical', accuracy: 65 }),
      record({ gameUrl: 'g4', openingName: 'Ruy Lopez, Morphy Defense', accuracy: 95 }),
      record({ gameUrl: 'g5', openingName: 'Ruy Lopez, Morphy Defense', accuracy: 90 })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    // Ruy Lopez only has 2 games -- below the 3-game threshold -- so it's excluded.
    expect(overall.weakOpenings).toEqual([{ name: 'Caro-Kann Defense, Classical', games: 3, accuracy: 65 }])
  })

  it('builds a chronological trend from the records', () => {
    const records = [
      record({ gameUrl: 'g1', endTime: 200, accuracy: 80 }),
      record({ gameUrl: 'g2', endTime: 100, accuracy: 90 })
    ]
    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.trend.map((t) => t.endTime)).toEqual([100, 200])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/reportAggregator.test.ts`
Expected: FAIL — `Cannot find module './reportAggregator'`.

- [ ] **Step 3: Implement the aggregator**

Create `src/main/insights/reportAggregator.ts`:

```ts
import type {
  GameInsightRecord,
  InsightsBucket,
  InsightsBucketKey,
  InsightsReport,
  OpeningStat,
  PhaseBreakdown,
  TimeControlCategory
} from '../../shared/types'
import { buildTrend } from './trendBucketing'

const MIN_GAMES_FOR_BUCKET = 5
const MIN_GAMES_PER_OPENING = 3

function averageAccuracy(records: GameInsightRecord[]): number {
  if (records.length === 0) return 0
  return records.reduce((sum, r) => sum + r.accuracy, 0) / records.length
}

function phaseBreakdown(records: GameInsightRecord[]): PhaseBreakdown {
  const breakdown: PhaseBreakdown = { opening: 0, middlegame: 0, endgame: 0 }
  for (const record of records) {
    for (const mistake of record.mistakes) {
      breakdown[mistake.phase] += 1
    }
  }
  return breakdown
}

function hungPieceCounts(records: GameInsightRecord[]): { hungPieceCount: number; positionalCount: number } {
  let hungPieceCount = 0
  let positionalCount = 0
  for (const record of records) {
    for (const mistake of record.mistakes) {
      if (mistake.isHungPiece) hungPieceCount += 1
      else positionalCount += 1
    }
  }
  return { hungPieceCount, positionalCount }
}

function timePressureCount(records: GameInsightRecord[]): number {
  let count = 0
  for (const record of records) {
    for (const mistake of record.mistakes) {
      if (mistake.isTimePressure) count += 1
    }
  }
  return count
}

function weakOpenings(records: GameInsightRecord[]): OpeningStat[] {
  const byOpening = new Map<string, GameInsightRecord[]>()
  for (const record of records) {
    if (!record.openingName) continue
    const existing = byOpening.get(record.openingName) ?? []
    existing.push(record)
    byOpening.set(record.openingName, existing)
  }

  const stats: OpeningStat[] = []
  for (const [name, group] of byOpening) {
    if (group.length < MIN_GAMES_PER_OPENING) continue
    stats.push({ name, games: group.length, accuracy: averageAccuracy(group) })
  }

  return stats.sort((a, b) => a.accuracy - b.accuracy)
}

function buildBucket(key: InsightsBucketKey, records: GameInsightRecord[]): InsightsBucket {
  const totalMistakes = records.reduce((sum, r) => sum + r.mistakes.length, 0)
  const { hungPieceCount, positionalCount } = hungPieceCounts(records)

  return {
    key,
    gamesCount: records.length,
    hasEnoughData: records.length >= MIN_GAMES_FOR_BUCKET,
    totalMistakes,
    averageAccuracy: averageAccuracy(records),
    phaseBreakdown: phaseBreakdown(records),
    hungPieceCount,
    positionalCount,
    timePressureCount: timePressureCount(records),
    weakOpenings: weakOpenings(records),
    trend: buildTrend(records)
  }
}

const TIME_CONTROL_CATEGORIES: TimeControlCategory[] = ['bullet', 'blitz', 'rapid', 'daily']

export function buildInsightsReport(
  records: GameInsightRecord[],
  lastScanTime: number | null
): Omit<InsightsReport, 'topFindings'> {
  const buckets: InsightsBucket[] = [buildBucket('overall', records)]

  for (const category of TIME_CONTROL_CATEGORIES) {
    const recordsInCategory = records.filter((r) => r.timeControlCategory === category)
    if (recordsInCategory.length === 0) continue
    buckets.push(buildBucket(category, recordsInCategory))
  }

  return { gamesScanned: records.length, lastScanTime, buckets }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/reportAggregator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/reportAggregator.ts src/main/insights/reportAggregator.test.ts
git commit -m "Add per-time-control report aggregation across cached insight records"
```

---

### Task 11: Top-findings synthesizer

**Files:**
- Create: `src/main/insights/topFindings.ts`
- Test: `src/main/insights/topFindings.test.ts`

**Interfaces:**
- Consumes: `InsightsBucket`, `InsightsReport`, `PhaseBreakdown`, `TopFinding` (Task 3).
- Produces: `synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[]` — consumed by the IPC handler (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/topFindings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { synthesizeTopFindings } from './topFindings'
import type { InsightsBucket, InsightsReport } from '../../shared/types'

function bucket(overrides: Partial<InsightsBucket>): InsightsBucket {
  return {
    key: 'overall',
    gamesCount: 20,
    hasEnoughData: true,
    totalMistakes: 10,
    averageAccuracy: 80,
    phaseBreakdown: { opening: 1, middlegame: 2, endgame: 7 },
    hungPieceCount: 2,
    positionalCount: 8,
    timePressureCount: 0,
    weakOpenings: [],
    trend: [],
    ...overrides
  }
}

describe('synthesizeTopFindings', () => {
  it('surfaces the dominant mistake phase when it is over half of all mistakes', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({})]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings[0].text).toContain('endgame')
    expect(findings[0].text).toContain('7 of 10')
  })

  it('does not surface a phase finding when no phase dominates', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ phaseBreakdown: { opening: 3, middlegame: 4, endgame: 3 } })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.find((f) => f.text.includes('% of your blunders'))).toBeUndefined()
  })

  it('skips buckets that do not have enough data', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 2,
      lastScanTime: null,
      buckets: [bucket({ hasEnoughData: false })]
    }
    expect(synthesizeTopFindings(report)).toEqual([])
  })

  it('surfaces a weak-opening finding when accuracy is well below the bucket average', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({
          averageAccuracy: 85,
          weakOpenings: [{ name: 'Caro-Kann Defense, Classical', games: 5, accuracy: 70 }]
        })
      ]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('Caro-Kann'))).toBe(true)
  })

  it('ranks findings by significance, most significant first', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ timePressureCount: 20 }), bucket({ key: 'bullet', timePressureCount: 3 })]
    }
    const findings = synthesizeTopFindings(report)
    const timePressureFindings = findings.filter((f) => f.text.includes('little time'))
    expect(timePressureFindings[0].significance).toBeGreaterThan(timePressureFindings[1].significance)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/topFindings.test.ts`
Expected: FAIL — `Cannot find module './topFindings'`.

- [ ] **Step 3: Implement the synthesizer**

Create `src/main/insights/topFindings.ts`:

```ts
import type { InsightsBucket, InsightsReport, PhaseBreakdown, TopFinding } from '../../shared/types'

const MIN_MISTAKES_FOR_PHASE_FINDING = 5
const PHASE_SHARE_THRESHOLD = 0.5
const MIN_MISTAKES_FOR_HUNGPIECE_FINDING = 5
const HUNGPIECE_SHARE_THRESHOLD = 0.3
const MIN_TIME_PRESSURE_FOR_FINDING = 3
const ACCURACY_GAP_FOR_OPENING_FINDING = 5

function bucketLabel(bucket: InsightsBucket): string {
  return bucket.key === 'overall' ? '' : ` in ${bucket.key}`
}

function worstPhase(breakdown: PhaseBreakdown): { phase: keyof PhaseBreakdown; count: number } {
  const entries: Array<[keyof PhaseBreakdown, number]> = [
    ['opening', breakdown.opening],
    ['middlegame', breakdown.middlegame],
    ['endgame', breakdown.endgame]
  ]
  return entries.reduce(
    (best, [phase, count]) => (count > best.count ? { phase, count } : best),
    { phase: 'opening' as const, count: -1 }
  )
}

function phaseFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.totalMistakes < MIN_MISTAKES_FOR_PHASE_FINDING) return null

  const { phase, count } = worstPhase(bucket.phaseBreakdown)
  const share = count / bucket.totalMistakes
  if (share < PHASE_SHARE_THRESHOLD) return null

  return {
    text: `${Math.round(share * 100)}% of your blunders/mistakes happen in the ${phase} (${count} of ${bucket.totalMistakes})${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
  }
}

function hungPieceFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.totalMistakes < MIN_MISTAKES_FOR_HUNGPIECE_FINDING) return null
  const share = bucket.hungPieceCount / bucket.totalMistakes
  if (share < HUNGPIECE_SHARE_THRESHOLD) return null

  return {
    text: `${bucket.hungPieceCount} of your ${bucket.totalMistakes} mistakes simply hung a piece${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
  }
}

function timePressureFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.timePressureCount < MIN_TIME_PRESSURE_FOR_FINDING) return null

  return {
    text: `${bucket.timePressureCount} of your mistakes were made with very little time on the clock${bucketLabel(bucket)}`,
    significance: bucket.timePressureCount
  }
}

function openingFindings(bucket: InsightsBucket): TopFinding[] {
  return bucket.weakOpenings
    .filter((opening) => bucket.averageAccuracy - opening.accuracy >= ACCURACY_GAP_FOR_OPENING_FINDING)
    .map((opening) => ({
      text: `Your accuracy in the ${opening.name} is ${opening.accuracy.toFixed(0)}% vs ${bucket.averageAccuracy.toFixed(0)}% overall${bucketLabel(bucket)} (${opening.games} games)`,
      significance: (bucket.averageAccuracy - opening.accuracy) * opening.games
    }))
}

export function synthesizeTopFindings(report: Omit<InsightsReport, 'topFindings'>): TopFinding[] {
  const findings: TopFinding[] = []

  for (const bucket of report.buckets) {
    if (!bucket.hasEnoughData) continue

    for (const candidate of [phaseFinding(bucket), hungPieceFinding(bucket), timePressureFinding(bucket)]) {
      if (candidate) findings.push(candidate)
    }
    findings.push(...openingFindings(bucket))
  }

  return findings.sort((a, b) => b.significance - a.significance)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/topFindings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/topFindings.ts src/main/insights/topFindings.test.ts
git commit -m "Add rule-based top-findings synthesis for the insights report"
```

---

### Task 12: Scan runner

**Files:**
- Create: `src/main/insights/scanRunner.ts`
- Test: `src/main/insights/scanRunner.test.ts`

**Interfaces:**
- Consumes: `fetchRecentGames` (existing, `src/main/chesscom/chessComClient.ts`), `parsePgn` (Task 1), `analyzeGame`/`EvaluationEngine` (existing, `src/main/analysis/gameAnalyzer.ts`), `extractInsightRecord` (Task 8), `isGameScanned`/`saveGameRecord`/`saveScanMeta` (Task 9), `ScanProgress` (Task 3).
- Produces: `runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome>` — consumed by the IPC handler (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/main/insights/scanRunner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChessComGameSummary, PositionEvaluation } from '../../shared/types'

const fetchRecentGamesMock = vi.fn()
const isGameScannedMock = vi.fn()
const saveGameRecordMock = vi.fn()
const saveScanMetaMock = vi.fn()

vi.mock('../chesscom/chessComClient', () => ({
  fetchRecentGames: (username: string, limit?: number) => fetchRecentGamesMock(username, limit)
}))

vi.mock('./insightsStore', () => ({
  isGameScanned: (url: string) => isGameScannedMock(url),
  saveGameRecord: (record: unknown) => saveGameRecordMock(record),
  saveScanMeta: (patch: unknown) => saveScanMetaMock(patch)
}))

import { runScan } from './scanRunner'

function game(url: string, pgn = '1. e4 e5'): ChessComGameSummary {
  return {
    url,
    pgn,
    endTime: 1000,
    timeControl: '600',
    white: { username: 'testuser', rating: 1500, result: 'win' },
    black: { username: 'opponent', rating: 1490, result: 'checkmated' }
  }
}

function fakeEngine(): {
  evaluatePosition: () => Promise<PositionEvaluation>
  start: () => Promise<void>
  stop: () => void
} {
  return {
    evaluatePosition: async () => ({
      lines: [{ depth: 14, scoreCp: 20, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'] }]
    }),
    start: async () => {},
    stop: () => {}
  }
}

describe('runScan', () => {
  beforeEach(() => {
    fetchRecentGamesMock.mockReset()
    isGameScannedMock.mockReset()
    saveGameRecordMock.mockReset()
    saveScanMetaMock.mockReset()
    isGameScannedMock.mockReturnValue(false)
  })

  it('skips games that are already scanned', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    isGameScannedMock.mockImplementation((url: string) => url === 'g1')

    const result = await runScan('testuser', { createEngine: fakeEngine })

    expect(result).toEqual({ scanned: 1 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('reports progress as each game finishes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const progressUpdates: Array<{ scanned: number; total: number }> = []

    await runScan('testuser', { createEngine: fakeEngine, onProgress: (p) => progressUpdates.push(p) })

    expect(progressUpdates).toEqual([
      { scanned: 0, total: 2 },
      { scanned: 1, total: 2 },
      { scanned: 2, total: 2 }
    ])
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])

    const result = await runScan('testuser', { createEngine: fakeEngine, isCancelled: () => true })

    expect(result).toEqual({ cancelled: true })
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })

  it('skips a game that fails to parse instead of aborting the whole scan', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1', 'not a valid pgn'), game('g2')])

    const result = await runScan('testuser', { createEngine: fakeEngine })

    expect(result).toEqual({ scanned: 2 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('records lastScanTime and username in scan metadata when the scan completes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1')])

    await runScan('testuser', { createEngine: fakeEngine })

    expect(saveScanMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'testuser', lastScanTime: expect.any(Number) })
    )
  })

  it('propagates an analysis engine failure so the whole scan aborts rather than silently continuing', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const crashingEngine = (): {
      evaluatePosition: () => Promise<PositionEvaluation>
      start: () => Promise<void>
      stop: () => void
    } => ({
      evaluatePosition: async () => {
        throw new Error('engine crashed')
      },
      start: async () => {},
      stop: () => {}
    })

    await expect(runScan('testuser', { createEngine: crashingEngine })).rejects.toThrow('engine crashed')
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/insights/scanRunner.test.ts`
Expected: FAIL — `Cannot find module './scanRunner'`.

- [ ] **Step 3: Implement the scan runner**

Create `src/main/insights/scanRunner.ts`:

```ts
import type { ScanOutcome, ScanProgress } from '../../shared/types'
import { fetchRecentGames } from '../chesscom/chessComClient'
import { parsePgn } from '../../shared/pgn'
import { analyzeGame, type EvaluationEngine } from '../analysis/gameAnalyzer'
import { extractInsightRecord } from './extractInsightRecord'
import { isGameScanned, saveGameRecord, saveScanMeta } from './insightsStore'

const SCAN_GAME_LIMIT = 100
const SCAN_ANALYSIS_DEPTH = 14

export interface ScanRunnerOptions {
  isCancelled?: () => boolean
  onProgress?: (progress: ScanProgress) => void
  createEngine: () => EvaluationEngine & { start: () => Promise<void>; stop: () => void }
}

export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  const games = await fetchRecentGames(username, SCAN_GAME_LIMIT)
  const newGames = games.filter((game) => !isGameScanned(game.url))

  options.onProgress?.({ scanned: 0, total: newGames.length })

  if (newGames.length === 0) {
    saveScanMeta({ username, lastScanTime: Date.now() })
    return { scanned: 0 }
  }

  const engine = options.createEngine()
  try {
    await engine.start()
  } catch (err) {
    return { error: `Could not start Stockfish: ${(err as Error).message}` }
  }

  let scanned = 0
  try {
    for (const game of newGames) {
      if (options.isCancelled?.()) return { cancelled: true }

      // A malformed PGN is a per-game data problem -- skip just this game
      // and keep going. An analyzeGame failure below is NOT caught here on
      // purpose: it almost always means the shared Stockfish engine itself
      // died, in which case every remaining game would fail too, so it's
      // better to propagate and abort the scan (caught by the IPC handler
      // in Task 13, surfaced as a clear error) than to silently burn
      // through the rest of the list logging one failure per game.
      let positions
      try {
        positions = parsePgn(game.pgn)
      } catch (err) {
        console.error(`Skipping game ${game.url}: could not parse PGN`, err)
        scanned += 1
        options.onProgress?.({ scanned, total: newGames.length })
        continue
      }

      const result = await analyzeGame(positions, engine, {
        depth: SCAN_ANALYSIS_DEPTH,
        isCancelled: options.isCancelled
      })
      if ('cancelled' in result) return { cancelled: true }

      saveGameRecord(extractInsightRecord(game, result, username))
      scanned += 1
      options.onProgress?.({ scanned, total: newGames.length })
    }
  } finally {
    engine.stop()
  }

  saveScanMeta({ username, lastScanTime: Date.now() })
  return { scanned }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/insights/scanRunner.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/insights/scanRunner.ts src/main/insights/scanRunner.test.ts
git commit -m "Add scan runner orchestrating fetch, incremental filter, analysis, and caching"
```

---

### Task 13: Wire scan + report IPC end-to-end

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts` (extend `ChessAPI`)
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `runScan` (Task 12), `loadAllGameRecords`/`loadScanMeta` (Task 9), `buildInsightsReport` (Task 10), `synthesizeTopFindings` (Task 11), `loadSettings` (existing, from the packaging/settings plan), `StockfishManager`/`getStockfishBinaryPath` (existing), `AnalysisRunTracker` (existing).
- Produces: `window.chessAPI.scanChessComGames(): Promise<ScanOutcome>`, `window.chessAPI.onScanProgress(callback): () => void`, `window.chessAPI.cancelScan(): void`, `window.chessAPI.getInsightsReport(): Promise<InsightsReport>` — consumed by `useInsightsScan.ts` (Task 14).

No dedicated unit test (same rationale as the packaging/settings plan's IPC task: this repo doesn't unit-test `handlers.ts`/`preload/index.ts`, only a clean typecheck plus the manual verification in Task 15).

- [ ] **Step 1: Add the four IPC channel names**

In `src/shared/ipc.ts`, add to the `IPC_CHANNELS` object (after `setChessComUsername` from the packaging/settings plan):

```ts
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
```

So the full object reads:

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  setChessComUsername: 'settings:set-chesscom-username',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
} as const
```

- [ ] **Step 2: Extend the ChessAPI interface**

In `src/shared/types.ts`, add four members to the `ChessAPI` interface (after `setChessComUsername`):

```ts
  scanChessComGames(): Promise<ScanOutcome>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  cancelScan(): void
  getInsightsReport(): Promise<InsightsReport>
```

- [ ] **Step 3: Register the four IPC handlers**

In `src/main/ipc/handlers.ts`, add imports:

```ts
import { runScan } from '../insights/scanRunner'
import { loadAllGameRecords, loadScanMeta } from '../insights/insightsStore'
import { buildInsightsReport } from '../insights/reportAggregator'
import { synthesizeTopFindings } from '../insights/topFindings'
```

Add a second run tracker alongside the existing `analysisRuns`:

```ts
const scanRuns = new AnalysisRunTracker()
```

Add handlers (anywhere after the `setChessComUsername` handler added by the packaging/settings plan):

```ts
  ipcMain.handle(IPC_CHANNELS.scanChessComGames, async () => {
    const settings = loadSettings()
    if (!settings.chessComUsername) {
      return { error: 'Set a chess.com username first by searching for your games in the Analyze tab.' }
    }

    const runId = scanRuns.start()
    try {
      return await runScan(settings.chessComUsername, {
        isCancelled: () => scanRuns.isCancelled(runId),
        createEngine: () => new StockfishManager(getStockfishBinaryPath()),
        onProgress: (progress) => {
          getWindow()?.webContents.send(IPC_CHANNELS.scanProgress, progress)
        }
      })
    } catch (err) {
      return { error: `Scan failed: ${(err as Error).message}` }
    } finally {
      scanRuns.finish(runId)
    }
  })

  ipcMain.on(IPC_CHANNELS.cancelScan, () => {
    scanRuns.cancelCurrent()
  })

  ipcMain.handle(IPC_CHANNELS.getInsightsReport, async () => {
    const records = loadAllGameRecords()
    const meta = loadScanMeta()
    const partialReport = buildInsightsReport(records, meta.lastScanTime)
    return { ...partialReport, topFindings: synthesizeTopFindings(partialReport) }
  })
```

- [ ] **Step 4: Expose the four methods from preload**

In `src/preload/index.ts`, add to the `chessAPI` object (after `setChessComUsername`):

```ts
  scanChessComGames: () => ipcRenderer.invoke(IPC_CHANNELS.scanChessComGames),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.scanProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanProgress, handler)
  },
  cancelScan: () => ipcRenderer.send(IPC_CHANNELS.cancelScan),
  getInsightsReport: () => ipcRenderer.invoke(IPC_CHANNELS.getInsightsReport)
```

And update the type-only import line at the top to include `ScanProgress`:

```ts
import type { AnalyzedPosition, AnalyzedMove, ChessAPI, ScanProgress } from '../shared/types'
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Expose scan and insights-report IPC to the renderer"
```

---

### Task 14: useInsightsScan hook

**Files:**
- Create: `src/renderer/src/hooks/useInsightsScan.ts`

**Interfaces:**
- Consumes: `window.chessAPI.scanChessComGames/onScanProgress/cancelScan/getInsightsReport` (Task 13).
- Produces: `useInsightsScan(): { state, startScan, cancelScan }` — consumed by `InsightsTab.tsx` (Task 15).

No unit test — this repo has no tests for `useGameAnalysis.ts` either (the analogous existing hook); both are thin IPC-calling wrappers verified by driving the actual app.

- [ ] **Step 1: Implement the hook**

Create `src/renderer/src/hooks/useInsightsScan.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InsightsReport, ScanProgress } from '../../../shared/types'

export type InsightsScanStatus = 'idle' | 'scanning' | 'error' | 'cancelled'

interface InsightsScanState {
  status: InsightsScanStatus
  progress: ScanProgress | null
  error: string | null
  report: InsightsReport | null
}

const INITIAL_STATE: InsightsScanState = { status: 'idle', progress: null, error: null, report: null }

export function useInsightsScan(): {
  state: InsightsScanState
  startScan: () => Promise<void>
  cancelScan: () => void
} {
  const [state, setState] = useState<InsightsScanState>(INITIAL_STATE)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const loadReport = useCallback(async () => {
    const report = await window.chessAPI.getInsightsReport()
    setState((prev) => ({ ...prev, report }))
  }, [])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  useEffect(() => {
    unsubscribeRef.current = window.chessAPI.onScanProgress((progress) => {
      setState((prev) => ({ ...prev, progress }))
    })
    return () => unsubscribeRef.current?.()
  }, [])

  const startScan = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'scanning', error: null, progress: { scanned: 0, total: 0 } }))
    const result = await window.chessAPI.scanChessComGames()

    if ('error' in result) {
      setState((prev) => ({ ...prev, status: 'error', error: result.error }))
      return
    }
    if ('cancelled' in result) {
      setState((prev) => ({ ...prev, status: 'cancelled' }))
      return
    }

    await loadReport()
    setState((prev) => ({ ...prev, status: 'idle' }))
  }, [loadReport])

  const cancelScan = useCallback(() => {
    window.chessAPI.cancelScan()
  }, [])

  return { state, startScan, cancelScan }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useInsightsScan.ts
git commit -m "Add useInsightsScan hook for driving scans and loading the report"
```

---

### Task 15: Insights report UI

**Files:**
- Create: `src/renderer/src/components/insights/TopFindingsList.tsx`
- Create: `src/renderer/src/components/insights/TimeControlSection.tsx`
- Modify: `src/renderer/src/components/InsightsTab.tsx` (replaces the empty-state placeholder from the UI-redesign plan)
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `useInsightsScan` (Task 14), `TopFinding`/`InsightsBucket` (Task 3).

No unit test (same no-component-tests convention as the rest of this codebase's renderer layer) — verified visually with seeded cache data via the `run-desktop` skill, since a real 100-game scan takes real wall-clock time unsuitable for a plan-verification step.

- [ ] **Step 1: Create the top-findings list**

Create `src/renderer/src/components/insights/TopFindingsList.tsx`:

```tsx
import type { TopFinding } from '../../../../shared/types'

interface TopFindingsListProps {
  findings: TopFinding[]
}

export function TopFindingsList({ findings }: TopFindingsListProps): JSX.Element {
  if (findings.length === 0) {
    return <p className="top-findings-empty">Not enough data yet for a confident finding.</p>
  }

  return (
    <ul className="top-findings-list">
      {findings.slice(0, 8).map((finding) => (
        <li key={finding.text}>{finding.text}</li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Create the per-time-control section**

Create `src/renderer/src/components/insights/TimeControlSection.tsx`:

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { InsightsBucket } from '../../../../shared/types'

interface TimeControlSectionProps {
  bucket: InsightsBucket
}

const BUCKET_LABELS: Record<InsightsBucket['key'], string> = {
  overall: 'Overall',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Daily'
}

export function TimeControlSection({ bucket }: TimeControlSectionProps): JSX.Element {
  if (!bucket.hasEnoughData) {
    return (
      <div className="time-control-section">
        <h3>{BUCKET_LABELS[bucket.key]}</h3>
        <p className="not-enough-data">Not enough games yet ({bucket.gamesCount} scanned).</p>
      </div>
    )
  }

  const phaseData = [
    { phase: 'Opening', count: bucket.phaseBreakdown.opening },
    { phase: 'Middlegame', count: bucket.phaseBreakdown.middlegame },
    { phase: 'Endgame', count: bucket.phaseBreakdown.endgame }
  ]

  return (
    <div className="time-control-section">
      <h3>{BUCKET_LABELS[bucket.key]}</h3>
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.hungPieceCount} hung a piece &middot; {bucket.timePressureCount} under time pressure
      </p>

      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={phaseData}>
          <XAxis dataKey="phase" stroke="#9a9ea8" />
          <YAxis allowDecimals={false} stroke="#9a9ea8" />
          <Tooltip />
          <Bar dataKey="count" fill="#7fa650" />
        </BarChart>
      </ResponsiveContainer>

      {bucket.weakOpenings.length > 0 && (
        <table className="weak-openings-table">
          <thead>
            <tr>
              <th>Opening</th>
              <th>Games</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {bucket.weakOpenings.map((opening) => (
              <tr key={opening.name}>
                <td>{opening.name}</td>
                <td>{opening.games}</td>
                <td>{opening.accuracy.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {bucket.trend.length > 1 && (
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={bucket.trend}>
            <XAxis dataKey="gameIndex" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip formatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)}%` : '')} />
            <Area type="monotone" dataKey="rollingAccuracy" stroke="#7fa650" fill="#7fa650" fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Replace InsightsTab.tsx with the real report view**

Replace the entire contents of `src/renderer/src/components/InsightsTab.tsx` with:

```tsx
import { useInsightsScan } from '../hooks/useInsightsScan'
import { TopFindingsList } from './insights/TopFindingsList'
import { TimeControlSection } from './insights/TimeControlSection'

export function InsightsTab(): JSX.Element {
  const { state, startScan, cancelScan } = useInsightsScan()

  const hasReport = state.report !== null && state.report.gamesScanned > 0

  return (
    <div className="insights-tab">
      <div className="insights-header">
        <span className="insights-last-scan">
          {state.report?.lastScanTime
            ? `Last scanned ${new Date(state.report.lastScanTime).toLocaleString()} · ${state.report.gamesScanned} games`
            : 'No scan yet'}
        </span>

        {state.status === 'scanning' ? (
          <div className="insights-scan-progress">
            <span>
              Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
            </span>
            <button onClick={cancelScan}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => void startScan()}>{hasReport ? 'Rescan' : 'Scan my games'}</button>
        )}
      </div>

      {state.status === 'error' && <div className="import-error">{state.error}</div>}
      {state.status === 'cancelled' && <div className="import-error">Scan cancelled.</div>}

      {!hasReport && state.status !== 'scanning' && (
        <p className="insights-empty-message">Scan your games to see patterns in your play.</p>
      )}

      {hasReport && state.report && (
        <div className="insights-report">
          <TopFindingsList findings={state.report.topFindings} />
          <div className="insights-buckets">
            {state.report.buckets.map((bucket) => (
              <TimeControlSection key={bucket.key} bucket={bucket} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update app.css for the real Insights tab content**

In `src/renderer/src/app.css`, find the block added by the UI-redesign plan:

```css
.insights-tab {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.insights-empty {
  flex-direction: column;
  gap: 1rem;
}

.insights-empty-message {
  color: var(--text-muted);
  font-size: 1rem;
}
```

Replace it with:

```css
.insights-tab {
  flex: 1;
  min-height: 320px;
}

.insights-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.insights-last-scan {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.insights-scan-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.insights-empty-message {
  color: var(--text-muted);
  font-size: 1rem;
}

.insights-report {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.top-findings-list {
  margin: 0;
  padding-left: 1.25rem;
}

.top-findings-empty {
  color: var(--text-muted);
}

.insights-buckets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.time-control-section {
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
}

.bucket-summary {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0.25rem 0 0.75rem;
}

.not-enough-data {
  color: var(--text-muted);
}

.weak-openings-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: 0.85rem;
}

.weak-openings-table th,
.weak-openings-table td {
  border-bottom: 1px solid var(--border);
  padding: 0.3rem 0.4rem;
  text-align: left;
}
```

(`.insights-empty` is dropped entirely — it's no longer referenced by any component now that `InsightsTab` renders real, dynamic content instead of a single centered message.)

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both PASS with no errors.

- [ ] **Step 6: Seed sample cache data and verify visually**

A real scan takes real wall-clock time (up to ~100 games), which isn't practical for a plan-verification step — instead, seed a handful of realistic `GameInsightRecord` files directly into the app's real userData directory, then drive the built app to confirm the report actually renders from that cache.

Run this script to seed the cache. It targets `~/.config/chess-analyzer` — Electron's `app.getPath('userData')` resolves from package.json's top-level `name` field (`"chess-analyzer"`) when running the unpackaged dev/build output (as the driver does), not from the `productName` nested inside the `build` config block that electron-builder reads only for packaging metadata:

```bash
node -e '
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")

const userDataDir = path.join(os.homedir(), ".config", "chess-analyzer")
const gamesDir = path.join(userDataDir, "games")
fs.mkdirSync(gamesDir, { recursive: true })

function record(i) {
  const isMistakeGame = i % 2 === 0
  return {
    gameUrl: `https://www.chess.com/game/live/seed-${i}`,
    endTime: 1700000000 + i * 86400,
    timeControlCategory: "rapid",
    userColor: "w",
    result: isMistakeGame ? "loss" : "win",
    openingName: isMistakeGame ? "Caro-Kann Defense, Classical" : "Ruy Lopez, Morphy Defense",
    accuracy: isMistakeGame ? 65 : 95,
    mistakes: isMistakeGame
      ? [{ ply: 45, classification: "blunder", phase: "endgame", isHungPiece: true, clockSecondsRemaining: 8, isTimePressure: true }]
      : []
  }
}

for (let i = 0; i < 10; i++) {
  const rec = record(i)
  const hash = require("node:crypto").createHash("sha1").update(rec.gameUrl).digest("hex")
  fs.writeFileSync(path.join(gamesDir, `${hash}.json`), JSON.stringify(rec, null, 2))
}

fs.writeFileSync(
  path.join(userDataDir, "scan-meta.json"),
  JSON.stringify({ username: "testuser", lastScanTime: Date.now(), scannedUrls: Array.from({ length: 10 }, (_, i) => `https://www.chess.com/game/live/seed-${i}`) }, null, 2)
)
console.log("Seeded", gamesDir)
'
```

Expected: prints `Seeded /home/<user>/.config/chess-analyzer/games`.

This seeds 10 games, all "rapid": 5 with a blunder each (endgame, hung piece, time pressure, opening "Caro-Kann Defense, Classical", accuracy 65) and 5 clean (opening "Ruy Lopez, Morphy Defense", accuracy 95) — comfortably past every threshold in `reportAggregator.ts`/`topFindings.ts` (5-game bucket minimum, 5-mistake finding minimum, 3-game opening minimum), so the seeded report should deterministically produce all four finding categories at once.

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-insights.txt`:

```
launch
click-text Insights
wait .insights-report 10000
ss insights-report-seeded
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-insights.txt`
Expected: `insights-report-seeded.png` shows the Insights tab with "Last scanned ... 10 games", a top-findings list including an endgame-phase finding ("100% of your blunders/mistakes happen in the endgame (5 of 5)"), a hung-piece finding, a time-pressure finding, and a weak-opening finding for the Caro-Kann Defense — plus "Overall" and "Rapid" sections both showing real phase/opening/trend content (both have 10 games, past the 5-game minimum). A real 100-game scan against an actual chess.com account should be run afterward (outside this plan) to see the full experience with realistic data.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/insights/TopFindingsList.tsx src/renderer/src/components/insights/TimeControlSection.tsx src/renderer/src/components/InsightsTab.tsx src/renderer/src/app.css
git commit -m "Build the Insights report UI: top findings and per-time-control sections"
```

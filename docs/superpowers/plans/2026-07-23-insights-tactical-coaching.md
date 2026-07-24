# Insights Tactical Intelligence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Insights tab's generic phase/hung-piece statistics with a deterministic tactic detector (fork/pin/skewer/discovered-attack/back-rank-mate/hung-piece) that explains *why* each mistake was a mistake, and surface that as tactic-specific, trend-aware findings plus a browsable recent-mistakes list.

**Architecture:** A new pure function `detectTactics(fenBefore, moveUci)` in `src/main/analysis/tacticDetector.ts` uses `chess.js` (already a dependency) to classify what a move achieves tactically. It's called twice per recorded mistake during game-insight extraction — once against the engine's best move (what the player missed) and once against the opponent's actual best reply (what punished the player) — and the results flow through the existing scan → store → aggregate → synthesize-findings → render pipeline, each stage widened to carry and use the new per-mistake tags instead of the old single `isHungPiece` boolean.

**Tech Stack:** TypeScript, `chess.js` ^1.4.0 (existing dependency, no new packages), Vitest.

## Global Constraints

- Design spec of record: `docs/superpowers/specs/2026-07-23-insights-tactical-coaching-design.md` — every task implements a specific section of it.
- Deterministic and offline only — no LLM calls, no new network dependency, no API keys.
- The existing Vitest suite (193 tests as of this session) and `tsc -b` must keep passing after every task — run `npm run verify` before each commit.
- Old cached game-insight records lack the new fields entirely; any task that changes `GameInsightMistake`'s shape must ship together with the cache-schema-version bump that invalidates them (see Task 2) — never let a breaking type change land without it, or `loadAllGameRecords()` will hand old-shaped data to code that assumes the new shape and crash at runtime (a `JSON.parse` result is not type-checked against the TS interface).
- Follow this repo's git workflow: commit directly to `main`, no branches/PRs.

---

### Task 1: Tactic detector module

**Files:**
- Modify: `src/shared/pgn.ts:6` (export the existing `PIECE_VALUES` constant)
- Modify: `src/shared/types.ts` (add `TacticType` and `TACTIC_TYPES`)
- Create: `src/main/analysis/tacticDetector.ts`
- Test: `src/main/analysis/tacticDetector.test.ts`

**Interfaces:**
- Produces: `export type TacticType = 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'back_rank_mate' | 'hung_piece'`, `export const TACTIC_TYPES: TacticType[]`, `export function detectTactics(fenBefore: string, moveUci: string): TacticType[]`. Nothing in the codebase consumes these yet — this task is 100% additive and self-contained.

This task is standalone: no existing file's behavior changes, so `npm run verify` passes trivially by virtue of nothing else being touched.

- [ ] **Step 1: Export `PIECE_VALUES` from `shared/pgn.ts`**

In `src/shared/pgn.ts`, change:

```ts
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
```

to:

```ts
export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
```

(Only the `export` keyword is added — nothing else in this file changes. `phaseHeuristic.ts` has its own separate, intentionally-different `PIECE_VALUES` map with `p: 0`, used to compute *non-pawn* material for game-phase detection — leave that one alone, it is not the same concept.)

- [ ] **Step 2: Add `TacticType` to `shared/types.ts`**

In `src/shared/types.ts`, immediately before the `GameInsightMistake` interface, add:

```ts
export type TacticType = 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'back_rank_mate' | 'hung_piece'

export const TACTIC_TYPES: TacticType[] = [
  'fork',
  'pin',
  'skewer',
  'discovered_attack',
  'back_rank_mate',
  'hung_piece'
]
```

- [ ] **Step 3: Write the failing tests**

Create `src/main/analysis/tacticDetector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectTactics } from './tacticDetector'

describe('detectTactics', () => {
  it('detects a knight fork on a queen and a rook', () => {
    // White knight d3 -> e5 forks the queen on c6 and the rook on g6.
    const fen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'd3e5')).toEqual(['fork'])
  })

  it('detects a bishop pin of a knight against the king', () => {
    // White bishop a4 -> b5 pins the knight on c6 to the king on e8
    // (b5-c6-d7-e8 is one diagonal, d7 empty).
    const fen = '4k3/8/2n5/8/B7/8/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'a4b5')).toEqual(['pin'])
  })

  it('detects a rook skewer of a king in front of a rook', () => {
    // White rook a1 -> e1 checks the king on e5; the black rook on e8
    // is directly behind it on the e-file with nothing in between.
    const fen = '4r3/8/8/4k3/8/8/8/R6K w - - 0 1'
    expect(detectTactics(fen, 'a1e1')).toEqual(['skewer'])
  })

  it('detects a discovered check', () => {
    // White knight d4 -> f5 uncovers the queen on d1's attack on the
    // king on d8 along the previously-blocked d-file.
    const fen = '3k4/8/8/8/3N4/8/8/3Q1K2 w - - 0 1'
    expect(detectTactics(fen, 'd4f5')).toEqual(['discovered_attack'])
  })

  it('detects a back-rank checkmate', () => {
    // White rook e1 -> e8 mates the king on g8, boxed in by its own
    // pawns on f7/g7/h7.
    const fen = '6k1/5ppp/8/8/8/8/8/4RK2 w - - 0 1'
    expect(detectTactics(fen, 'e1e8')).toEqual(['back_rank_mate'])
  })

  it('detects a hung piece (capture with no legal recapture)', () => {
    // White knight g5 captures the pawn on f7; the black king on a8 is
    // much too far away to recapture, and it's the only other black piece.
    const fen = 'k7/5p2/8/6N1/8/8/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'g5f7')).toEqual(['hung_piece'])
  })

  it('returns an empty array for a quiet developing move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    expect(detectTactics(fen, 'g1f3')).toEqual([])
  })

  it('returns multiple tags when one move matches more than one pattern', () => {
    // Same fork position as above, but with an undefended black pawn on
    // e5 -- Nxe5 both captures a hung pawn AND still forks c6/g6.
    const fen = '4k3/8/2q3r1/4p3/8/3N4/8/4K3 w - - 0 1'
    const tags = detectTactics(fen, 'd3e5')
    expect(tags).toContain('fork')
    expect(tags).toContain('hung_piece')
    expect(tags).toHaveLength(2)
  })

  it('returns an empty array for an illegal move rather than throwing', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    expect(detectTactics(fen, 'a1a8')).toEqual([])
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/main/analysis/tacticDetector.test.ts`
Expected: FAIL — `Cannot find module './tacticDetector'` (the module doesn't exist yet).

- [ ] **Step 5: Implement `tacticDetector.ts`**

Create `src/main/analysis/tacticDetector.ts`:

```ts
import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { PIECE_VALUES } from '../../shared/pgn'
import type { TacticType } from '../../shared/types'

const SIGNIFICANT_VALUE = 3 // knight/bishop or greater

function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined
  }
}

function opponentOf(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function isSlider(type: PieceSymbol): boolean {
  return type === 'b' || type === 'r' || type === 'q'
}

function pieceValue(type: PieceSymbol): number {
  return PIECE_VALUES[type]
}

const ROOK_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]
const BISHOP_DIRECTIONS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
]

function directionsFor(type: PieceSymbol): Array<[number, number]> {
  if (type === 'r') return ROOK_DIRECTIONS
  if (type === 'b') return BISHOP_DIRECTIONS
  return [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS] // queen
}

function fileRank(square: Square): [number, number] {
  return ['abcdefgh'.indexOf(square[0]), Number(square[1]) - 1]
}

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
  return `${'abcdefgh'[file]}${rank + 1}` as Square
}

// Reuses the same "opponent's top reply is a capture the mover can't
// recapture" idea the old isHungPieceBlunder used, generalized to run on
// any move rather than only an engine PV's first move.
function detectHungPiece(chess: Chess, move: Move): boolean {
  if (!move.captured) return false
  const canRecapture = chess.moves({ verbose: true }).some((m) => m.to === move.to && m.captured)
  return !canRecapture
}

function detectFork(chess: Chess, moverColor: Color, toSquare: Square): boolean {
  const enemy = opponentOf(moverColor)
  const attackedTypes: PieceSymbol[] = []

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy) continue
      if (chess.attackers(cell.square, moverColor).includes(toSquare)) {
        attackedTypes.push(cell.type)
      }
    }
  }

  if (attackedTypes.length < 2) return false
  if (attackedTypes.includes('k')) return true
  return attackedTypes.filter((type) => pieceValue(type) >= SIGNIFICANT_VALUE).length >= 2
}

// Walks each sliding direction from the moved piece's square. The first
// enemy piece hit is the "near" piece; if another enemy piece (or the
// king) sits directly behind it on the same ray, near < far in value is a
// pin (near piece can't move without exposing the more valuable one),
// near >= far is a skewer (near piece -- possibly the king itself, in
// check -- must move, exposing what's behind it).
function detectPinsAndSkewers(chess: Chess, moverColor: Color, toSquare: Square): TacticType[] {
  const piece = chess.get(toSquare)
  if (!piece || !isSlider(piece.type)) return []

  const enemy = opponentOf(moverColor)
  const [file, rank] = fileRank(toSquare)
  const results: TacticType[] = []

  for (const [df, dr] of directionsFor(piece.type)) {
    let f = file + df
    let r = rank + dr
    let near: { type: PieceSymbol } | null = null

    while (true) {
      const square = squareAt(f, r)
      if (!square) break
      const occupant = chess.get(square)

      if (occupant) {
        if (!near) {
          if (occupant.color !== enemy) break
          near = { type: occupant.type }
        } else {
          if (occupant.color !== enemy) break
          const nearValue = near.type === 'k' ? Infinity : pieceValue(near.type)
          const farValue = occupant.type === 'k' ? Infinity : pieceValue(occupant.type)
          results.push(nearValue < farValue ? 'pin' : 'skewer')
          break
        }
      }

      f += df
      r += dr
    }
  }

  return results
}

// Compares, for every significant enemy piece and the enemy king, which
// of the mover's pieces attack it before vs. after the move. A square
// that gains an attacker other than the moved piece itself is a
// discovered attack -- the moved piece was blocking that line before.
function detectDiscoveredAttack(fenBefore: string, chess: Chess, moverColor: Color, toSquare: Square): boolean {
  const before = new Chess(fenBefore)
  const enemy = opponentOf(moverColor)

  const targets: Square[] = []
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === enemy && (cell.type === 'k' || pieceValue(cell.type) >= SIGNIFICANT_VALUE)) {
        targets.push(cell.square)
      }
    }
  }

  for (const target of targets) {
    const beforeAttackers = new Set(before.attackers(target, moverColor))
    for (const attackerSquare of chess.attackers(target, moverColor)) {
      if (attackerSquare === toSquare) continue
      if (!beforeAttackers.has(attackerSquare)) return true
    }
  }

  return false
}

function detectBackRankMate(chess: Chess, move: Move): boolean {
  const enemyColor = opponentOf(move.color)
  const homeRank = enemyColor === 'w' ? '1' : '8'

  const kingCell = chess
    .board()
    .flat()
    .find((cell) => cell?.type === 'k' && cell.color === enemyColor)
  if (!kingCell || kingCell.square[1] !== homeRank) return false
  if (move.to[1] !== homeRank) return false

  const forwardDelta = enemyColor === 'w' ? 1 : -1
  const [kingFile, kingRank] = fileRank(kingCell.square)

  for (const df of [-1, 0, 1]) {
    const square = squareAt(kingFile + df, kingRank + forwardDelta)
    if (!square) continue
    const occupant = chess.get(square)
    if (!occupant || occupant.color !== enemyColor || occupant.type !== 'p') return false
  }

  return true
}

// Every check below runs on the position after `moveUci` is played from
// `fenBefore` -- each is a heuristic pattern match (same spirit as the
// hung-piece check's original "not full SEE" comment), not a formal
// tactics solver. A single move can match more than one tag.
export function detectTactics(fenBefore: string, moveUci: string): TacticType[] {
  const chess = new Chess(fenBefore)

  let move: Move
  try {
    move = chess.move(uciToMove(moveUci))
  } catch {
    return []
  }

  const tactics = new Set<TacticType>()

  if (detectHungPiece(chess, move)) tactics.add('hung_piece')
  if (detectFork(chess, move.color, move.to)) tactics.add('fork')
  for (const tag of detectPinsAndSkewers(chess, move.color, move.to)) tactics.add(tag)
  if (detectDiscoveredAttack(fenBefore, chess, move.color, move.to)) tactics.add('discovered_attack')
  if (chess.isCheckmate() && detectBackRankMate(chess, move)) tactics.add('back_rank_mate')

  return Array.from(tactics)
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/main/analysis/tacticDetector.test.ts`
Expected: PASS, 9/9. If any hand-built FEN test fails, the most likely cause is a typo in the FEN or move geometry, not the algorithm — double-check the fixture (e.g. by loading the FEN and calling `chess.moves({verbose: true})` to see what's actually legal) before changing detector logic.

- [ ] **Step 7: Full verify and commit**

Run: `npm run verify`
Expected: `tsc -b` clean, all tests passing (193 existing + 9 new = 202).

```bash
git add src/shared/pgn.ts src/shared/types.ts src/main/analysis/tacticDetector.ts src/main/analysis/tacticDetector.test.ts
git commit -m "Add a deterministic tactic detector (fork/pin/skewer/discovered attack/back-rank mate/hung piece)"
```

---

### Task 2: Wire tactics into the insights pipeline, with cache-schema versioning

**Files:**
- Modify: `src/shared/types.ts` (extend `GameInsightMistake`, `GameInsightRecord`, `InsightsBucket`, `ScanMeta`; add `MistakeSummary`)
- Modify: `src/main/insights/extractInsightRecord.ts` + `extractInsightRecord.test.ts`
- Delete: `src/main/insights/hungPieceDetector.ts` + `hungPieceDetector.test.ts` (superseded by Task 1's `detectTactics`)
- Modify: `src/main/insights/reportAggregator.ts` + `reportAggregator.test.ts`
- Modify: `src/main/insights/topFindings.ts` + `topFindings.test.ts`
- Modify: `src/main/insights/insightsStore.ts` + `insightsStore.test.ts` (schema version)
- Modify: `src/main/insights/scanRunner.ts` (call the new schema-version check)
- Modify: `src/renderer/src/components/insights/TimeControlSection.tsx` (one-line fix so it still compiles — the full UI upgrade is Task 5)

**Interfaces:**
- Consumes: `detectTactics` from Task 1.
- Produces: the final `GameInsightMistake`/`GameInsightRecord`/`InsightsBucket`/`MistakeSummary` shapes that Tasks 3 and 5 build on.

This is one task, not several, because every file above either produces or consumes the same breaking type change (`GameInsightMistake.isHungPiece` → `missedTactics`/`punishedByTactics`, `InsightsBucket.hungPieceCount`/`positionalCount` → `tacticBreakdown`/`missedTacticBreakdown`) — landing any subset of them alone would leave the build red or, worse, leave `reportAggregator.ts` reading fields that no longer exist on freshly-scanned data while old cached JSON still has the *old* shape with no `schemaVersion` to force a rescan. All of it ships together, verified together, one commit.

- [ ] **Step 1: Extend the shared types**

In `src/shared/types.ts`, replace:

```ts
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
```

with:

```ts
export interface GameInsightMistake {
  ply: number
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  cpLoss: number
  fenBefore: string
  playedMoveUci: string
  bestMoveUci: string
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  clockSecondsRemaining: number | null
  isTimePressure: boolean
}

export interface GameInsightRecord {
  gameUrl: string
  endTime: number
  timeControlCategory: TimeControlCategory
  userColor: 'w' | 'b'
  opponentUsername: string
  result: 'win' | 'loss' | 'draw'
  openingName: string | null
  accuracy: number
  mistakes: GameInsightMistake[]
}
```

Replace:

```ts
export interface ScanMeta {
  username: string | null
  lastScanTime: number | null
  scannedUrls: string[]
}
```

with:

```ts
export interface ScanMeta {
  username: string | null
  lastScanTime: number | null
  scannedUrls: string[]
  schemaVersion: number
}
```

Replace:

```ts
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
```

with:

```ts
export interface MistakeSummary {
  gameUrl: string
  endTime: number
  opponentUsername: string
  ply: number
  phase: GamePhase
  cpLoss: number
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
}

export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  tacticBreakdown: Record<TacticType, number>
  missedTacticBreakdown: Record<TacticType, number>
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
  recentMistakes: MistakeSummary[]
}
```

- [ ] **Step 2: Add schema versioning to `insightsStore.ts`**

In `src/main/insights/insightsStore.ts`, replace:

```ts
function defaultScanMeta(): ScanMeta {
  return { username: null, lastScanTime: null, scannedUrls: [] }
}
```

with:

```ts
// Bump this whenever GameInsightMistake/GameInsightRecord's shape changes
// in a way old cached JSON can't satisfy -- a mismatch wipes the cache
// (see ensureSchemaVersion below), the same mechanism ensureUsernameScope
// already uses for a tracked-username change.
export const CURRENT_SCHEMA_VERSION = 1

function defaultScanMeta(): ScanMeta {
  return { username: null, lastScanTime: null, scannedUrls: [], schemaVersion: CURRENT_SCHEMA_VERSION }
}
```

Replace:

```ts
export function loadScanMeta(): ScanMeta {
  const path = scanMetaPath()
  if (!existsSync(path)) return defaultScanMeta()

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScanMeta>
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      lastScanTime: typeof parsed.lastScanTime === 'number' ? parsed.lastScanTime : null,
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : []
    }
  } catch {
    return defaultScanMeta()
  }
}
```

with:

```ts
export function loadScanMeta(): ScanMeta {
  const path = scanMetaPath()
  if (!existsSync(path)) return defaultScanMeta()

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ScanMeta>
    return {
      username: typeof parsed.username === 'string' ? parsed.username : null,
      lastScanTime: typeof parsed.lastScanTime === 'number' ? parsed.lastScanTime : null,
      scannedUrls: Array.isArray(parsed.scannedUrls) ? parsed.scannedUrls : [],
      // 0 never matches CURRENT_SCHEMA_VERSION, so a pre-versioning
      // scan-meta.json (or a missing/corrupt field) always triggers
      // ensureSchemaVersion's wipe below rather than being trusted.
      schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0
    }
  } catch {
    return defaultScanMeta()
  }
}
```

Add, directly after `ensureUsernameScope`:

```ts
// Old cached records were written before GameInsightMistake grew
// cpLoss/fenBefore/missedTactics/etc -- there is no way to backfill those
// fields without re-running the engine, so a version mismatch wipes the
// cache exactly like a username change does, forcing a full rescan on the
// next run. Called before ensureUsernameScope in runScan so a stale
// cache is cleared regardless of whether the username also happens to be
// changing at the same time.
export function ensureSchemaVersion(): void {
  const meta = loadScanMeta()
  if (meta.schemaVersion === CURRENT_SCHEMA_VERSION) return

  const dir = gamesDir()
  if (existsSync(dir)) {
    for (const fileName of readdirSync(dir)) {
      if (fileName.endsWith('.json')) unlinkSync(join(dir, fileName))
    }
  }
  saveScanMeta({ schemaVersion: CURRENT_SCHEMA_VERSION, lastScanTime: null, scannedUrls: [] })
}
```

- [ ] **Step 3: Update `insightsStore.test.ts` for the new field**

In `src/main/insights/insightsStore.test.ts`, update the import line:

```ts
import {
  loadScanMeta,
  saveScanMeta,
  isGameScanned,
  saveGameRecord,
  loadAllGameRecords,
  ensureUsernameScope
} from './insightsStore'
```

to:

```ts
import {
  loadScanMeta,
  saveScanMeta,
  isGameScanned,
  saveGameRecord,
  loadAllGameRecords,
  ensureUsernameScope,
  ensureSchemaVersion,
  CURRENT_SCHEMA_VERSION
} from './insightsStore'
```

Update the `record()` test factory to include the new `GameInsightRecord`/`GameInsightMistake` fields it will need once other tests construct mistakes (this factory currently only builds empty-`mistakes` records, so it just needs `opponentUsername`):

```ts
function record(gameUrl: string): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: []
  }
}
```

Replace the two tests that assert a full `ScanMeta` shape:

```ts
  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({ username: null, lastScanTime: null, scannedUrls: [] })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({ username: 'hikaru', lastScanTime: 12345, scannedUrls: [] })
  })
```

with:

```ts
  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({
      username: null,
      lastScanTime: null,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({
      username: 'hikaru',
      lastScanTime: 12345,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })
```

And the username-change assertion:

```ts
      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta()).toEqual({ username: 'magnuscarlsen', lastScanTime: null, scannedUrls: [] })
```

to:

```ts
      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta()).toEqual({
        username: 'magnuscarlsen',
        lastScanTime: null,
        scannedUrls: [],
        schemaVersion: CURRENT_SCHEMA_VERSION
      })
```

Add a new `describe` block for the new function, after the `ensureUsernameScope` block:

```ts
  describe('ensureSchemaVersion', () => {
    it('is a no-op when the stored schema version already matches', () => {
      saveGameRecord(record('https://www.chess.com/game/live/1'))
      ensureSchemaVersion()

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('clears the cache and bumps the version when the stored version is stale', () => {
      saveGameRecord(record('https://www.chess.com/game/live/1'))
      saveScanMeta({ schemaVersion: 0 })

      ensureSchemaVersion()

      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    })

    it('treats a scan-meta.json written before schema versioning existed as stale', () => {
      saveGameRecord(record('https://www.chess.com/game/live/1'))
      // Simulate pre-versioning data: no schemaVersion field at all.
      saveScanMeta({ username: 'hikaru', lastScanTime: 500, scannedUrls: ['https://www.chess.com/game/live/1'] })
      // saveScanMeta merges onto whatever loadScanMeta() last produced, so
      // force the on-disk file itself to omit schemaVersion the way a
      // real pre-upgrade file would.
      const meta = loadScanMeta()
      // @ts-expect-error -- deliberately constructing a pre-versioning shape
      delete meta.schemaVersion
      saveScanMeta(meta)

      ensureSchemaVersion()

      expect(loadAllGameRecords()).toEqual([])
    })
  })
```

- [ ] **Step 4: Wire `ensureSchemaVersion` into the scan**

In `src/main/insights/scanRunner.ts`, change the import:

```ts
import { ensureUsernameScope, isGameScanned, saveGameRecord, saveScanMeta } from './insightsStore'
```

to:

```ts
import { ensureSchemaVersion, ensureUsernameScope, isGameScanned, saveGameRecord, saveScanMeta } from './insightsStore'
```

and change the first line of `runScan`:

```ts
export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  ensureUsernameScope(username)
```

to:

```ts
export async function runScan(username: string, options: ScanRunnerOptions): Promise<ScanOutcome> {
  ensureSchemaVersion()
  ensureUsernameScope(username)
```

- [ ] **Step 5: Rewrite `extractInsightRecord.ts`**

Replace the full contents of `src/main/insights/extractInsightRecord.ts` with:

```ts
import type {
  ChessComGameSummary,
  GameAnalysisResult,
  GameInsightMistake,
  GameInsightRecord,
  TacticType
} from '../../shared/types'
import { gamePhaseAt } from './phaseHeuristic'
import { detectTactics } from '../analysis/tacticDetector'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import {
  resolveTimeControlCategory,
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

function tacticsFor(fen: string, moveUci: string | undefined): TacticType[] {
  return moveUci ? detectTactics(fen, moveUci) : []
}

export function extractInsightRecord(
  game: ChessComGameSummary,
  analysis: GameAnalysisResult,
  username: string
): GameInsightRecord {
  const normalizedUsername = username.trim().toLowerCase()
  const userColor: 'w' | 'b' = game.black.username.toLowerCase() === normalizedUsername ? 'b' : 'w'
  const opponentUsername = userColor === 'w' ? game.black.username : game.white.username

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
      const bestMoveUci = move.evalBefore.lines[0]?.moveUci
      const opponentBestMoveUci = move.evalAfter.lines[0]?.moveUci

      return {
        ply: move.ply,
        classification: move.classification as 'mistake' | 'blunder',
        phase: gamePhaseAt(move.fenAfter, move.ply),
        cpLoss: computeMoveEvalDelta(move.evalBefore, move.evalAfter, move.moveUci).cpLoss,
        fenBefore: move.fenBefore,
        playedMoveUci: move.moveUci,
        bestMoveUci: bestMoveUci ?? move.moveUci,
        missedTactics: tacticsFor(move.fenBefore, bestMoveUci),
        punishedByTactics: tacticsFor(move.fenAfter, opponentBestMoveUci),
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
    timeControlCategory: resolveTimeControlCategory(game.timeClass, game.timeControl),
    userColor,
    opponentUsername,
    result: resultFor(userColor, game),
    openingName,
    accuracy: userColor === 'w' ? analysis.whiteAccuracy : analysis.blackAccuracy,
    mistakes
  }
}
```

- [ ] **Step 6: Rewrite `extractInsightRecord.test.ts`**

Replace the full contents of `src/main/insights/extractInsightRecord.test.ts` with:

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

  it("records the opponent's username, keyed off the user's own color", () => {
    const analysis: GameAnalysisResult = {
      moves: [move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN })],
      whiteAccuracy: 95,
      blackAccuracy: 80
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'TestUser')
    expect(record.opponentUsername).toBe('opponent')
  })

  it('only records mistakes/blunders made by the tracked user, tagging phase and punished-by tactics', () => {
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
            lines: [{ depth: 14, scoreCp: 900, scoreMate: null, moveUci: 'd8d1', pv: ['d8d1'] }]
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
      punishedByTactics: ['hung_piece']
    })
  })

  it('computes cpLoss and records the position/move context for a mistake', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({
          ply: 25,
          color: 'w',
          san: 'Rd1??',
          classification: 'blunder',
          fenBefore: '3qk3/8/8/8/8/8/8/2R4K w - - 0 1',
          fenAfter: HUNG_ROOK_FEN,
          moveUci: 'c1d1',
          evalBefore: {
            lines: [{ depth: 14, scoreCp: 0, scoreMate: null, moveUci: 'h1h2', pv: ['h1h2'] }]
          },
          evalAfter: {
            lines: [{ depth: 14, scoreCp: 900, scoreMate: null, moveUci: 'd8d1', pv: ['d8d1'] }]
          }
        })
      ],
      whiteAccuracy: 60,
      blackAccuracy: 95
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'testuser')

    expect(record.mistakes[0]).toMatchObject({
      fenBefore: '3qk3/8/8/8/8/8/8/2R4K w - - 0 1',
      playedMoveUci: 'c1d1',
      bestMoveUci: 'h1h2'
    })
    expect(record.mistakes[0].cpLoss).toBeGreaterThan(0)
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

    // This test only checks that game.timeControl flows into
    // categorizeTimeControl() -- the increment-aware bucketing formula
    // itself is covered by timeControl.test.ts, so use a plain base-only
    // value here where increment can't affect the result.
    const record = extractInsightRecord(chessComGame({ timeControl: '60' }), analysis, 'testuser')
    expect(record.timeControlCategory).toBe('bullet')
  })

  it('prefers chess.com\'s own time_class over the raw timeControl heuristic (real "Play vs Coach" data has timeControl "-")', () => {
    const analysis: GameAnalysisResult = {
      moves: [move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN })],
      whiteAccuracy: 90,
      blackAccuracy: 90
    }

    const record = extractInsightRecord(
      chessComGame({ timeControl: '-', timeClass: 'daily' }),
      analysis,
      'testuser'
    )
    expect(record.timeControlCategory).toBe('daily')
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

- [ ] **Step 7: Delete the superseded hung-piece detector**

```bash
git rm src/main/insights/hungPieceDetector.ts src/main/insights/hungPieceDetector.test.ts
```

- [ ] **Step 8: Rewrite `reportAggregator.ts`**

Replace the full contents of `src/main/insights/reportAggregator.ts` with:

```ts
import type {
  GameInsightMistake,
  GameInsightRecord,
  InsightsBucket,
  InsightsBucketKey,
  InsightsReport,
  MistakeSummary,
  OpeningStat,
  PhaseBreakdown,
  TacticType,
  TimeControlCategory
} from '../../shared/types'
import { TACTIC_TYPES } from '../../shared/types'
import { buildTrend } from './trendBucketing'

const MIN_GAMES_FOR_BUCKET = 5
const MIN_GAMES_PER_OPENING = 3
const MAX_RECENT_MISTAKES = 20

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

function emptyTacticBreakdown(): Record<TacticType, number> {
  const breakdown = {} as Record<TacticType, number>
  for (const type of TACTIC_TYPES) breakdown[type] = 0
  return breakdown
}

function tallyTactics(
  records: GameInsightRecord[],
  pick: (mistake: GameInsightMistake) => TacticType[]
): Record<TacticType, number> {
  const breakdown = emptyTacticBreakdown()
  for (const record of records) {
    for (const mistake of record.mistakes) {
      for (const tag of pick(mistake)) breakdown[tag] += 1
    }
  }
  return breakdown
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

function recentMistakes(records: GameInsightRecord[]): MistakeSummary[] {
  const all: MistakeSummary[] = []
  for (const record of records) {
    for (const mistake of record.mistakes) {
      all.push({
        gameUrl: record.gameUrl,
        endTime: record.endTime,
        opponentUsername: record.opponentUsername,
        ply: mistake.ply,
        phase: mistake.phase,
        cpLoss: mistake.cpLoss,
        missedTactics: mistake.missedTactics,
        punishedByTactics: mistake.punishedByTactics
      })
    }
  }
  return all.sort((a, b) => b.endTime - a.endTime).slice(0, MAX_RECENT_MISTAKES)
}

function buildBucket(key: InsightsBucketKey, records: GameInsightRecord[]): InsightsBucket {
  const totalMistakes = records.reduce((sum, r) => sum + r.mistakes.length, 0)

  return {
    key,
    gamesCount: records.length,
    hasEnoughData: records.length >= MIN_GAMES_FOR_BUCKET,
    totalMistakes,
    averageAccuracy: averageAccuracy(records),
    phaseBreakdown: phaseBreakdown(records),
    tacticBreakdown: tallyTactics(records, (m) => m.punishedByTactics),
    missedTacticBreakdown: tallyTactics(records, (m) => m.missedTactics),
    timePressureCount: timePressureCount(records),
    weakOpenings: weakOpenings(records),
    trend: buildTrend(records),
    recentMistakes: recentMistakes(records)
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

- [ ] **Step 9: Rewrite `reportAggregator.test.ts`**

Replace the full contents of `src/main/insights/reportAggregator.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { buildInsightsReport } from './reportAggregator'
import type { GameInsightMistake, GameInsightRecord } from '../../shared/types'

function record(overrides: Partial<GameInsightRecord>): GameInsightRecord {
  return {
    gameUrl: 'https://www.chess.com/game/live/1',
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    ...overrides
  }
}

function mistake(overrides: Partial<GameInsightMistake>): GameInsightMistake {
  return {
    ply: 10,
    classification: 'mistake',
    phase: 'middlegame',
    cpLoss: 150,
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    playedMoveUci: 'a2a3',
    bestMoveUci: 'e2e4',
    missedTactics: [],
    punishedByTactics: [],
    clockSecondsRemaining: null,
    isTimePressure: false,
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

  it('tallies phase breakdown across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ ply: 5, phase: 'opening' }), mistake({ ply: 40, phase: 'endgame' })]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.totalMistakes).toBe(2)
    expect(overall.phaseBreakdown).toEqual({ opening: 1, middlegame: 0, endgame: 1 })
  })

  it('tallies punished-by and missed tactic counts separately across mistakes', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ missedTactics: ['fork'], punishedByTactics: ['hung_piece', 'fork'] })]
      })
    ]

    const report = buildInsightsReport(records, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    expect(overall.tacticBreakdown).toEqual({
      fork: 1,
      pin: 0,
      skewer: 0,
      discovered_attack: 0,
      back_rank_mate: 0,
      hung_piece: 1
    })
    expect(overall.missedTacticBreakdown).toEqual({
      fork: 1,
      pin: 0,
      skewer: 0,
      discovered_attack: 0,
      back_rank_mate: 0,
      hung_piece: 0
    })
  })

  it('builds a recent-mistakes list, most recent game first, capped at 20', () => {
    const manyMistakeRecords = Array.from({ length: 15 }, (_, i) =>
      record({
        gameUrl: `g${i}`,
        endTime: i,
        opponentUsername: `opponent${i}`,
        mistakes: [mistake({ ply: 10 }), mistake({ ply: 20 })]
      })
    )

    const report = buildInsightsReport(manyMistakeRecords, null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    // 15 games x 2 mistakes each = 30 total, capped to 20, newest endTime first.
    expect(overall.recentMistakes).toHaveLength(20)
    expect(overall.recentMistakes[0].opponentUsername).toBe('opponent14')
  })

  it('counts time-pressure mistakes across all games in the bucket', () => {
    const records = [
      record({
        gameUrl: 'g1',
        mistakes: [mistake({ ply: 30, clockSecondsRemaining: 5, isTimePressure: true })]
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

- [ ] **Step 10: Rewrite `topFindings.ts`**

Replace the full contents of `src/main/insights/topFindings.ts` with:

```ts
import type { InsightsBucket, InsightsReport, PhaseBreakdown, TacticType, TopFinding } from '../../shared/types'

const MIN_MISTAKES_FOR_PHASE_FINDING = 5
const PHASE_SHARE_THRESHOLD = 0.5
const MIN_COUNT_FOR_TACTIC_FINDING = 3
const TACTIC_SHARE_THRESHOLD = 0.25
const MIN_TIME_PRESSURE_FOR_FINDING = 3
const TIME_PRESSURE_SHARE_THRESHOLD = 0.3
const ACCURACY_GAP_FOR_OPENING_FINDING = 5

const TACTIC_LABELS: Record<TacticType, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discovered_attack: 'discovered attack',
  back_rank_mate: 'back-rank mate',
  hung_piece: 'hung piece'
}

function bucketLabel(bucket: InsightsBucket): string {
  return bucket.key === 'overall' ? '' : ` in ${bucket.key}`
}

function worstPhase(breakdown: PhaseBreakdown): { phase: keyof PhaseBreakdown; count: number } {
  const entries: Array<[keyof PhaseBreakdown, number]> = [
    ['opening', breakdown.opening],
    ['middlegame', breakdown.middlegame],
    ['endgame', breakdown.endgame]
  ]
  return entries.reduce<{ phase: keyof PhaseBreakdown; count: number }>(
    (best, [phase, count]) => (count > best.count ? { phase, count } : best),
    { phase: 'opening', count: -1 }
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

// Runs once for missedTacticBreakdown (what the player failed to find)
// and once for tacticBreakdown (what actually punished them) -- same
// thresholding logic, different verb in the generated sentence.
function tacticFindings(
  bucket: InsightsBucket,
  breakdown: Record<TacticType, number>,
  verb: string
): TopFinding[] {
  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0)
  if (total === 0) return []

  const findings: TopFinding[] = []
  for (const [tag, count] of Object.entries(breakdown) as Array<[TacticType, number]>) {
    if (count < MIN_COUNT_FOR_TACTIC_FINDING) continue
    const share = count / total
    if (share < TACTIC_SHARE_THRESHOLD) continue

    findings.push({
      text: `You've ${verb} ${count} ${TACTIC_LABELS[tag]}${count === 1 ? '' : 's'} in your last ${bucket.gamesCount} games${bucketLabel(bucket)}`,
      significance: share * total
    })
  }
  return findings
}

function timePressureFinding(bucket: InsightsBucket): TopFinding | null {
  if (bucket.timePressureCount < MIN_TIME_PRESSURE_FOR_FINDING) return null
  if (bucket.totalMistakes === 0) return null

  const share = bucket.timePressureCount / bucket.totalMistakes
  if (share < TIME_PRESSURE_SHARE_THRESHOLD) return null

  return {
    text: `${bucket.timePressureCount} of your mistakes were made with very little time on the clock${bucketLabel(bucket)}`,
    significance: share * bucket.totalMistakes
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

    const phase = phaseFinding(bucket)
    if (phase) findings.push(phase)

    findings.push(...tacticFindings(bucket, bucket.missedTacticBreakdown, 'missed'))
    findings.push(...tacticFindings(bucket, bucket.tacticBreakdown, 'been caught by'))

    const timePressure = timePressureFinding(bucket)
    if (timePressure) findings.push(timePressure)

    findings.push(...openingFindings(bucket))
  }

  return findings.sort((a, b) => b.significance - a.significance)
}
```

- [ ] **Step 11: Rewrite `topFindings.test.ts`**

Replace the full contents of `src/main/insights/topFindings.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { synthesizeTopFindings } from './topFindings'
import type { InsightsBucket, InsightsReport, TacticType } from '../../shared/types'

function emptyTacticBreakdown(): Record<TacticType, number> {
  return { fork: 0, pin: 0, skewer: 0, discovered_attack: 0, back_rank_mate: 0, hung_piece: 0 }
}

function bucket(overrides: Partial<InsightsBucket>): InsightsBucket {
  return {
    key: 'overall',
    gamesCount: 20,
    hasEnoughData: true,
    totalMistakes: 10,
    averageAccuracy: 80,
    phaseBreakdown: { opening: 1, middlegame: 2, endgame: 7 },
    tacticBreakdown: emptyTacticBreakdown(),
    missedTacticBreakdown: emptyTacticBreakdown(),
    timePressureCount: 0,
    weakOpenings: [],
    trend: [],
    recentMistakes: [],
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

  it('surfaces a "been caught by" finding when a tactic is a large share of what punished the player', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticBreakdown: { ...emptyTacticBreakdown(), fork: 4, hung_piece: 1 } })]
    }
    const findings = synthesizeTopFindings(report)
    const forkFinding = findings.find((f) => f.text.includes('caught by') && f.text.includes('fork'))
    expect(forkFinding?.text).toContain('4 forks')
  })

  it('surfaces a "missed" finding separately from a "caught by" finding', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({
          tacticBreakdown: { ...emptyTacticBreakdown(), pin: 5 },
          missedTacticBreakdown: { ...emptyTacticBreakdown(), fork: 5 }
        })
      ]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('missed') && f.text.includes('fork'))).toBe(true)
    expect(findings.some((f) => f.text.includes('caught by') && f.text.includes('pin'))).toBe(true)
  })

  it('does not surface a tactic finding below the count threshold', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticBreakdown: { ...emptyTacticBreakdown(), fork: 2, hung_piece: 8 } })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('fork'))).toBe(false)
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

  it('does not surface a time-pressure finding when the count is a small share of a large sample', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ totalMistakes: 200, timePressureCount: 5 })]
    }
    const findings = synthesizeTopFindings(report)
    expect(findings.some((f) => f.text.includes('little time'))).toBe(false)
  })

  it('gates a time-pressure finding by share of mistakes, not just raw count', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [
        bucket({ key: 'overall', totalMistakes: 5, timePressureCount: 5 }),
        bucket({ key: 'bullet', totalMistakes: 200, timePressureCount: 5 })
      ]
    }
    const findings = synthesizeTopFindings(report)
    const timePressureFindings = findings.filter((f) => f.text.includes('little time'))
    expect(timePressureFindings).toHaveLength(1)
    expect(timePressureFindings[0].text).toContain('5 of your mistakes')
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

- [ ] **Step 12: Minimal fix to `TimeControlSection.tsx` so the renderer still compiles**

In `src/renderer/src/components/insights/TimeControlSection.tsx`, replace:

```tsx
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.hungPieceCount} hung a piece &middot; {bucket.timePressureCount} under time pressure
      </p>
```

with:

```tsx
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.tacticBreakdown.hung_piece} hung a piece &middot; {bucket.timePressureCount} under time
        pressure
      </p>
```

(This is the minimal change needed for the file to compile against the new `InsightsBucket` shape. Task 5 replaces this whole summary line with the fuller tactic-chip row and recent-mistakes list — this step is a real, working intermediate state, not throwaway scaffolding.)

- [ ] **Step 13: Full verify and commit**

Run: `npm run verify`
Expected: `tsc -b` clean, all tests passing. Count check: 202 (after Task 1) minus 4 deleted `hungPieceDetector.test.ts` tests, plus the new tests added across `extractInsightRecord.test.ts` (+2), `reportAggregator.test.ts` (net roughly the same, one test replaced by two), `topFindings.test.ts` (net a few more), `insightsStore.test.ts` (+3) — don't hardcode an exact expected number in your own head, just confirm the run reports 0 failures and the file count matches what you touched.

```bash
git add -A
git commit -m "Wire the tactic detector into the insights pipeline, with cache-schema versioning"
```

---

### Task 3: Trend-over-time findings

**Files:**
- Modify: `src/shared/types.ts` (add `TacticTrend`, extend `InsightsBucket`)
- Modify: `src/main/insights/reportAggregator.ts` + `reportAggregator.test.ts`
- Modify: `src/main/insights/topFindings.ts` + `topFindings.test.ts`

**Interfaces:**
- Consumes: `TACTIC_TYPES`, `tallyTactics` (Task 2's internal helper, extended here).
- Produces: `InsightsBucket.tacticTrends: TacticTrend[]`, consumed by `topFindings.ts`'s new `trendFindings`.

This task is purely additive (new field, new function) — nothing existing is removed, so it's safely separable from Task 2.

- [ ] **Step 1: Add `TacticTrend` and extend `InsightsBucket`**

In `src/shared/types.ts`, immediately before `InsightsBucket`, add:

```ts
export interface TacticTrend {
  type: TacticType
  olderShare: number
  newerShare: number
}
```

Add `tacticTrends: TacticTrend[]` as the last field of `InsightsBucket`:

```ts
export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  tacticBreakdown: Record<TacticType, number>
  missedTacticBreakdown: Record<TacticType, number>
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
  recentMistakes: MistakeSummary[]
  tacticTrends: TacticTrend[]
}
```

- [ ] **Step 2: Write the failing test for the aggregator**

In `src/main/insights/reportAggregator.test.ts`, add this test (any position in the file, e.g. after the "tallies punished-by and missed tactic counts" test):

```ts
  it('flags a tactic trend when its punished-by share shifts by 15+ points between the older and newer half of games', () => {
    const olderGames = Array.from({ length: 5 }, (_, i) =>
      record({
        gameUrl: `old${i}`,
        endTime: i,
        mistakes: [mistake({ punishedByTactics: ['fork'] }), mistake({ punishedByTactics: ['pin'] })]
      })
    )
    const newerGames = Array.from({ length: 5 }, (_, i) =>
      record({
        gameUrl: `new${i}`,
        endTime: 100 + i,
        mistakes: [mistake({ punishedByTactics: ['fork'] }), mistake({ punishedByTactics: ['fork'] })]
      })
    )

    const report = buildInsightsReport([...olderGames, ...newerGames], null)
    const overall = report.buckets.find((b) => b.key === 'overall')!

    // fork share: older half 5/10 = 50%, newer half 10/10 = 100% -- a 50-point jump.
    const forkTrend = overall.tacticTrends.find((t) => t.type === 'fork')
    expect(forkTrend?.olderShare).toBeCloseTo(0.5)
    expect(forkTrend?.newerShare).toBeCloseTo(1)
  })

  it('reports no tactic trends when there are too few mistakes in either half to compare', () => {
    const records = [record({ gameUrl: 'g1', mistakes: [mistake({ punishedByTactics: ['fork'] })] })]
    const report = buildInsightsReport(records, null)
    expect(report.buckets.find((b) => b.key === 'overall')!.tacticTrends).toEqual([])
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/insights/reportAggregator.test.ts`
Expected: FAIL — `overall.tacticTrends` is `undefined` (the field doesn't exist on the object `buildBucket` returns yet).

- [ ] **Step 4: Implement `tacticTrends` in `reportAggregator.ts`**

Add these two constants near the top of `src/main/insights/reportAggregator.ts`, alongside the existing ones:

```ts
const MIN_MISTAKES_PER_HALF_FOR_TREND = 3
const TREND_SHARE_DELTA_THRESHOLD = 0.15
```

Add this function, after `tallyTactics`:

```ts
// Splits records at their chronological midpoint and compares each
// tactic's share of punished-by mistakes between the two halves --
// surfaces only tactics whose share moved by at least
// TREND_SHARE_DELTA_THRESHOLD, and only when both halves have enough
// mistakes to make the comparison meaningful.
function tacticTrends(records: GameInsightRecord[]): TacticTrend[] {
  const sorted = [...records].sort((a, b) => a.endTime - b.endTime)
  const midpoint = Math.floor(sorted.length / 2)
  const older = sorted.slice(0, midpoint)
  const newer = sorted.slice(midpoint)

  const olderCounts = tallyTactics(older, (m) => m.punishedByTactics)
  const newerCounts = tallyTactics(newer, (m) => m.punishedByTactics)
  const olderTotal = Object.values(olderCounts).reduce((sum, n) => sum + n, 0)
  const newerTotal = Object.values(newerCounts).reduce((sum, n) => sum + n, 0)

  if (olderTotal < MIN_MISTAKES_PER_HALF_FOR_TREND || newerTotal < MIN_MISTAKES_PER_HALF_FOR_TREND) return []

  const trends: TacticTrend[] = []
  for (const type of TACTIC_TYPES) {
    const olderShare = olderCounts[type] / olderTotal
    const newerShare = newerCounts[type] / newerTotal
    if (Math.abs(newerShare - olderShare) >= TREND_SHARE_DELTA_THRESHOLD) {
      trends.push({ type, olderShare, newerShare })
    }
  }
  return trends
}
```

Add the `TacticTrend` import to the existing `import type { ... } from '../../shared/types'` block, and add `tacticTrends: tacticTrends(records)` as the last field returned by `buildBucket`:

```ts
    trend: buildTrend(records),
    recentMistakes: recentMistakes(records),
    tacticTrends: tacticTrends(records)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/main/insights/reportAggregator.test.ts`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 6: Write the failing test for `topFindings.ts`**

In `src/main/insights/topFindings.test.ts`, update the `bucket()` factory to include `tacticTrends: []` in its defaults:

```ts
function bucket(overrides: Partial<InsightsBucket>): InsightsBucket {
  return {
    key: 'overall',
    gamesCount: 20,
    hasEnoughData: true,
    totalMistakes: 10,
    averageAccuracy: 80,
    phaseBreakdown: { opening: 1, middlegame: 2, endgame: 7 },
    tacticBreakdown: emptyTacticBreakdown(),
    missedTacticBreakdown: emptyTacticBreakdown(),
    timePressureCount: 0,
    weakOpenings: [],
    trend: [],
    recentMistakes: [],
    tacticTrends: [],
    ...overrides
  }
}
```

Add these two tests:

```ts
  it('surfaces a trend finding when a tactic is being caught more often over time', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticTrends: [{ type: 'fork', olderShare: 0.2, newerShare: 0.6 }] })]
    }
    const findings = synthesizeTopFindings(report)
    const trendFinding = findings.find((f) => f.text.includes('fork') && f.text.includes('more often'))
    expect(trendFinding).toBeDefined()
  })

  it('surfaces a trend finding phrased as "less often" when a tactic\'s share dropped', () => {
    const report: Omit<InsightsReport, 'topFindings'> = {
      gamesScanned: 20,
      lastScanTime: null,
      buckets: [bucket({ tacticTrends: [{ type: 'pin', olderShare: 0.6, newerShare: 0.2 }] })]
    }
    const findings = synthesizeTopFindings(report)
    const trendFinding = findings.find((f) => f.text.includes('pin') && f.text.includes('less often'))
    expect(trendFinding).toBeDefined()
  })
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/main/insights/topFindings.test.ts`
Expected: FAIL — no finding contains "more often"/"less often" (the function producing them doesn't exist yet).

- [ ] **Step 8: Implement `trendFindings` in `topFindings.ts`**

Add this function to `src/main/insights/topFindings.ts`, after `openingFindings`:

```ts
function trendFindings(bucket: InsightsBucket): TopFinding[] {
  return bucket.tacticTrends.map((trend) => {
    const direction = trend.newerShare > trend.olderShare ? 'more often' : 'less often'
    const deltaPoints = Math.abs(trend.newerShare - trend.olderShare) * 100
    return {
      text: `You're being caught by ${TACTIC_LABELS[trend.type]}s ${direction} than earlier in your history${bucketLabel(bucket)}`,
      significance: deltaPoints
    }
  })
}
```

Add `findings.push(...trendFindings(bucket))` inside the `for (const bucket of report.buckets)` loop in `synthesizeTopFindings`, after the existing `findings.push(...openingFindings(bucket))` line:

```ts
    findings.push(...openingFindings(bucket))
    findings.push(...trendFindings(bucket))
  }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/main/insights/topFindings.test.ts`
Expected: PASS, all tests including the 2 new ones.

- [ ] **Step 10: Full verify and commit**

Run: `npm run verify`
Expected: `tsc -b` clean, all tests passing.

```bash
git add src/shared/types.ts src/main/insights/reportAggregator.ts src/main/insights/reportAggregator.test.ts src/main/insights/topFindings.ts src/main/insights/topFindings.test.ts
git commit -m "Add tactic-frequency trend findings (more/less often than earlier in your history)"
```

---

### Task 4: Expand the opening book

**Files:**
- Modify: `src/main/analysis/openingBook.ts`

**Interfaces:**
- No interface change — `OPENING_BOOK_LINES` grows, `isBookMove`/`matchOpeningName` are untouched.

This task is independent of Tasks 1-3 and purely additive to a data table — safe to do in any order, and to skip entirely without affecting anything else in this plan.

- [ ] **Step 1: Splice the expanded table onto the existing 16 entries**

In `src/main/analysis/openingBook.ts`, the array currently ends with:

```ts
  {
    name: 'Reti Opening',
    moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']
  }
]
```

Replace that closing entry with itself followed by a comma and all of the new entries below, keeping every one of the existing 16 entries above it untouched (`openingBook.test.ts` depends on their exact content):

```ts
  {
    name: 'Reti Opening',
    moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']
  },
  {
    name: 'Sicilian Defense, Dragon Variation',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6']
  },
  {
    name: 'Sicilian Defense, Sveshnikov Variation',
    moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5']
  },
  {
    name: 'Sicilian Defense, Taimanov Variation',
    moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6']
  },
  {
    name: 'Sicilian Defense, Alapin Variation',
    moves: ['e4', 'c5', 'c3']
  },
  {
    name: 'Sicilian Defense, Closed',
    moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3']
  },
  {
    name: 'Ruy Lopez, Exchange Variation',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']
  },
  {
    name: 'Ruy Lopez, Berlin Defense',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6']
  },
  {
    name: 'Ruy Lopez, Open Variation',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Nxe4']
  },
  {
    name: 'Ruy Lopez, Marshall Attack',
    moves: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'O-O', 'c3', 'd5'
    ]
  },
  {
    name: 'Italian Game, Evans Gambit',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4']
  },
  {
    name: 'Italian Game, Two Knights Defense',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']
  },
  {
    name: 'Scotch Game',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4']
  },
  {
    name: 'Vienna Game',
    moves: ['e4', 'e5', 'Nc3']
  },
  {
    name: "King's Gambit Accepted",
    moves: ['e4', 'e5', 'f4', 'exf4']
  },
  {
    name: "King's Gambit Declined",
    moves: ['e4', 'e5', 'f4', 'Bc5']
  },
  {
    name: 'Four Knights Game',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6']
  },
  {
    name: 'Philidor Defense',
    moves: ['e4', 'e5', 'Nf3', 'd6']
  },
  {
    name: 'Center Game',
    moves: ['e4', 'e5', 'd4', 'exd4', 'Qxd4']
  },
  {
    name: 'Caro-Kann Defense, Advance Variation',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5']
  },
  {
    name: 'Caro-Kann Defense, Exchange Variation',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5']
  },
  {
    name: 'Caro-Kann Defense, Two Knights Attack',
    moves: ['e4', 'c6', 'Nc3', 'd5', 'Nf3']
  },
  {
    name: 'French Defense, Winawer Variation',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Bb4']
  },
  {
    name: 'French Defense, Advance Variation',
    moves: ['e4', 'e6', 'd4', 'd5', 'e5']
  },
  {
    name: 'French Defense, Tarrasch Variation',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nd2']
  },
  {
    name: 'French Defense, Exchange Variation',
    moves: ['e4', 'e6', 'd4', 'd5', 'exd5', 'exd5']
  },
  {
    name: 'Pirc Defense',
    moves: ['e4', 'd6', 'd4', 'Nf6', 'Nc3', 'g6']
  },
  {
    name: 'Scandinavian Defense, Modern Variation',
    moves: ['e4', 'd5', 'exd5', 'Nf6']
  },
  {
    name: "King's Indian Attack",
    moves: ['e4', 'e6', 'd3']
  },
  {
    name: "Queen's Gambit Accepted",
    moves: ['d4', 'd5', 'c4', 'dxc4']
  },
  {
    name: "Queen's Gambit Declined, Tartakower Variation",
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O']
  },
  {
    name: "Queen's Gambit Declined, Exchange Variation",
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5']
  },
  {
    name: 'Slav Defense',
    moves: ['d4', 'd5', 'c4', 'c6']
  },
  {
    name: 'Semi-Slav Defense',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nc3', 'Nf6', 'Nf3', 'e6']
  },
  {
    name: "King's Indian Defense, Sämisch Variation",
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'f3']
  },
  {
    name: "King's Indian Defense, Fianchetto Variation",
    moves: ['d4', 'Nf6', 'c4', 'g6', 'g3']
  },
  {
    name: 'Grünfeld Defense',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5']
  },
  {
    name: 'Nimzo-Indian Defense, Classical Variation',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'Qc2']
  },
  {
    name: 'Nimzo-Indian Defense, Sämisch Variation',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'a3']
  },
  {
    name: 'Queen\'s Indian Defense',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6']
  },
  {
    name: 'Bogo-Indian Defense',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'Bb4+']
  },
  {
    name: 'Catalan Opening',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'g3']
  },
  {
    name: "Benoni Defense",
    moves: ['d4', 'Nf6', 'c4', 'c5', 'd5']
  },
  {
    name: 'Budapest Gambit',
    moves: ['d4', 'Nf6', 'c4', 'e5']
  },
  {
    name: "Trompowsky Attack",
    moves: ['d4', 'Nf6', 'Bg5']
  },
  {
    name: "London System",
    moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4']
  },
  {
    name: "Torre Attack",
    moves: ['d4', 'Nf6', 'Nf3', 'e6', 'Bg5']
  },
  {
    name: 'Dutch Defense, Classical Variation',
    moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6']
  },
  {
    name: 'Dutch Defense, Stonewall Variation',
    moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6', 'Nf3', 'd5']
  },
  {
    name: 'English Opening, Symmetrical Variation',
    moves: ['c4', 'c5']
  },
  {
    name: 'English Opening, Four Knights Variation',
    moves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6']
  },
  {
    name: "Bird's Opening",
    moves: ['f4']
  },
  {
    name: "Larsen's Opening",
    moves: ['b3']
  },
  {
    name: 'Reti Opening, King\'s Indian Attack',
    moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6']
  }
]
```

(That final `]` closes the array — don't duplicate it if your editor still shows the original one from before this edit.)

- [ ] **Step 2: Verify the existing tests still pass unchanged**

Run: `npx vitest run src/main/analysis/openingBook.test.ts`
Expected: PASS, all existing tests — none of them assert on the table's total size, only on specific known lines that are unchanged.

- [ ] **Step 3: Full verify and commit**

Run: `npm run verify`
Expected: `tsc -b` clean, all tests passing.

```bash
git add src/main/analysis/openingBook.ts
git commit -m "Expand the opening book from 16 to ~65 named lines"
```

---

### Task 5: Renderer — tactic chips and recent-mistakes list

**Files:**
- Create: `src/renderer/src/components/insights/RecentMistakesList.tsx`
- Modify: `src/renderer/src/components/insights/TimeControlSection.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `InsightsBucket.tacticBreakdown`, `InsightsBucket.recentMistakes` (both from Task 2), `TacticType` labels.

No new tests — this repo has no component-level test coverage for `.tsx` files (confirmed: only `lib/`, `hooks/`, and main-process modules have `*.test.ts` files), consistent with existing practice. Verified visually in Task 6 instead.

- [ ] **Step 1: Create a shared tactic-label lookup for the renderer**

Create `src/renderer/src/lib/tacticLabels.ts`:

```ts
import type { TacticType } from '../../../shared/types'

export const TACTIC_LABELS: Record<TacticType, string> = {
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discovered_attack: 'Discovered attack',
  back_rank_mate: 'Back-rank mate',
  hung_piece: 'Hung piece'
}
```

- [ ] **Step 2: Create `RecentMistakesList.tsx`**

Create `src/renderer/src/components/insights/RecentMistakesList.tsx`:

```tsx
import type { MistakeSummary } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'

interface RecentMistakesListProps {
  mistakes: MistakeSummary[]
}

export function RecentMistakesList({ mistakes }: RecentMistakesListProps): JSX.Element | null {
  if (mistakes.length === 0) return null

  return (
    <ul className="recent-mistakes-list">
      {mistakes.map((mistake) => {
        const tags = [...mistake.missedTactics, ...mistake.punishedByTactics]
        return (
          <li key={`${mistake.gameUrl}-${mistake.ply}`} className="recent-mistake-row">
            <span className="recent-mistake-meta">
              {new Date(mistake.endTime * 1000).toLocaleDateString()} &middot; vs {mistake.opponentUsername}
              &middot; move {Math.ceil(mistake.ply / 2)}
            </span>
            <span className="recent-mistake-tags">
              {tags.length === 0
                ? 'Positional'
                : tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="recent-mistake-tag">
                      {TACTIC_LABELS[tag]}
                    </span>
                  ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
```

**Note on `endTime`**: `MistakeSummary.endTime` is the *game's* end time (a Unix timestamp in seconds, matching `ChessComGameSummary.endTime`'s convention used elsewhere in this codebase, e.g. `ImportModal.tsx`'s `new Date(game.endTime * 1000).toLocaleDateString()`) — not the mistake's own timestamp, since chess.com doesn't provide per-move wall-clock time. This is an approximation (every mistake in a game shows that game's end date) and matches how the rest of the app already displays game dates.

- [ ] **Step 3: Update `TimeControlSection.tsx`**

Replace the full contents of `src/renderer/src/components/insights/TimeControlSection.tsx` with:

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { InsightsBucket, TacticType } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'
import { RecentMistakesList } from './RecentMistakesList'

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

  const tacticEntries = (Object.entries(bucket.tacticBreakdown) as Array<[TacticType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="time-control-section">
      <h3>{BUCKET_LABELS[bucket.key]}</h3>
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.timePressureCount} under time pressure
      </p>

      {tacticEntries.length > 0 && (
        <div className="tactic-chip-row">
          {tacticEntries.map(([tag, count]) => (
            <span key={tag} className="tactic-chip">
              {TACTIC_LABELS[tag]} &times;{count}
            </span>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={phaseData}>
          <XAxis dataKey="phase" stroke="var(--text-muted)" />
          <YAxis allowDecimals={false} stroke="var(--text-muted)" />
          <Tooltip />
          <Bar dataKey="count" fill="var(--accent)" />
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
            <Area
              type="monotone"
              dataKey="rollingAccuracy"
              stroke="var(--accent)"
              fill="var(--accent)"
              fillOpacity={0.3}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      <RecentMistakesList mistakes={bucket.recentMistakes} />
    </div>
  )
}
```

- [ ] **Step 4: Add CSS for the new elements**

In `src/renderer/src/app.css`, add these rules after the existing `.weak-openings-table` rules:

```css
.tactic-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.5rem 0 0.75rem;
}

.tactic-chip {
  font-size: 0.78rem;
  color: var(--text-muted);
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.15rem 0.55rem;
  font-family: var(--font-mono);
}

.recent-mistakes-list {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.recent-mistake-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.45rem 0.65rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 0.82rem;
}

.recent-mistake-meta {
  color: var(--text-muted);
}

.recent-mistake-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.recent-mistake-tag {
  font-size: 0.72rem;
  font-family: var(--font-mono);
  color: var(--accent);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  padding: 0.05rem 0.4rem;
}
```

- [ ] **Step 5: Verify it builds**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Full verify and commit**

Run: `npm run verify`
Expected: `tsc -b` clean, all tests passing (this task adds no new tests, so the count is unchanged from Task 4).

```bash
git add src/renderer/src/lib/tacticLabels.ts src/renderer/src/components/insights/RecentMistakesList.tsx src/renderer/src/components/insights/TimeControlSection.tsx src/renderer/src/app.css
git commit -m "Show tactic-type chips and a recent-mistakes list on the Insights tab"
```

---

### Task 6: Full rescan and visual verification

**Files:** none (verification only)

**Interfaces:** none — consumes the completed feature from Tasks 1-5.

- [ ] **Step 1: Run the full check**

Run: `npm run verify`
Expected: `tsc -b` succeeds, all tests pass.

- [ ] **Step 2: Build and launch**

Run: `npm run build`
Expected: ends with `✓ built in`.

- [ ] **Step 3: Force a rescan and capture the result**

Use the `run-desktop` skill. The schema-version bump from Task 2 means the very next scan on this dev machine will already be a full rescan (old cache wiped automatically) — no manual cache-clearing needed. Write a commands file:

```
launch
click-text Insights
sleep 500
click-text Rescan
wait .insights-report 180000
ss insights-tactical
```

Run: `node .claude/skills/run-desktop/driver.mjs <path-to-commands-file>`

(180-second timeout: a 100-game rescan at depth 14 takes real wall-clock time — longer than any single-game wait used elsewhere in this app. If it's still scanning when the wait times out, increase the timeout rather than treating it as a failure.)

- [ ] **Step 4: Check the screenshot against the spec**

- The top findings list should include at least one tactic-specific finding (e.g. "You've missed N forks..." or "You've been caught by N hung pieces...") — not just phase/opening/time-pressure findings, confirming real tactic detection ran against real games.
- Each `TimeControlSection` with enough data should show a tactic-chip row (e.g. "Hung piece ×12 · Fork ×5") between the summary line and the phase chart.
- A "recent mistakes" list should render below the trend chart, each row showing a date, opponent username, move number, and tactic tag(s) (or "Positional" for a mistake with no detected tag).
- Weak-openings table should show real named openings for more games than before (Task 4's expanded book), not `null`/empty for most entries.

If any tactic tag looks obviously wrong on inspection (e.g. every single mistake tagged `hung_piece` and nothing else, suggesting a detector bug rather than real data), don't dismiss it as "probably fine" — cross-check a couple of the flagged positions by hand (load the FEN from that game's mistake and eyeball the board) before declaring this task done.

- [ ] **Step 5: Fix anything found, or confirm clean**

If Step 4 found a real defect, fix it in the relevant task's file, re-run `npm run verify` and `npm run build`, re-screenshot, and commit the fix:

```bash
git add -A
git commit -m "Fix issues found in tactical-insights visual verification"
```

If nothing needed fixing, no commit for this task — Tasks 1-5 already committed everything.

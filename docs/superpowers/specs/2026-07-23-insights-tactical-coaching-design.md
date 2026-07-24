# Insights: Tactical Intelligence Engine — Design Spec

Date: 2026-07-23

## Purpose

Today's Insights tab tells you *that* you blundered — 71% of mistakes happen
in the middlegame, N were "hung pieces," here's a trend line — but never
*what kind* of mistake it was. The only categorization beyond raw
centipawn-loss thresholds is a single crude binary
(`isHungPieceBlunder` — one-ply lookahead, "did the opponent's best reply
capture something unrecapturable") and everything else falls into an
undifferentiated `positionalCount` bucket. There is no tactical-pattern
detection anywhere in the codebase, and per-mistake data is discarded down
to a ply number and two booleans before it's ever persisted — the richer
position/PV data computed during analysis never survives into
`GameInsightRecord`. The user's own words: "I don't get any useful
information from this tab... it's just base level."

This spec is Phase 1 of a three-phase plan (see "Future ideas" for Phases
2-3, which get their own specs once this ships): a **tactical intelligence
engine** that recognizes *why* a mistake was a mistake — fork, pin,
skewer, discovered attack, back-rank mate, or hung piece — and uses that
to synthesize genuinely personalized findings ("you've missed 8 forks in
your last 100 games, 6 of them with your knight") instead of generic
phase/time-pressure percentages. Fully deterministic and offline, per the
user's explicit choice — no LLM, no API key, no network calls beyond the
chess.com game fetch that already exists.

## Scope

`src/main/insights/**`, `src/main/analysis/**`, `src/shared/types.ts`, and
the Insights-tab renderer components. No changes to the Analyze tab, the
interactive engine-analysis flow, or chess.com account linking.

Out of scope (explicitly deferred to later phases — see "Future ideas"):
any new interactive board/click-through UI, puzzle mode, LLM integration
of any kind.

## Tactic detector (new module)

New file `src/main/analysis/tacticDetector.ts`:

```ts
export type TacticType =
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered_attack'
  | 'back_rank_mate'
  | 'hung_piece'

export function detectTactics(fenBefore: string, moveUci: string): TacticType[]
```

Given a position and a single move, returns every tactical pattern that
move contains, using `chess.js` (already a dependency — no new package)
for board representation, legal-move generation, and check/mate detection.
A position can match more than one tag (e.g. a move can simultaneously
fork two pieces and deliver a discovered check) — `detectTactics` returns
all that apply, not just the first match.

**Detection approach per tag** (chess.js does the move application and
legality; each check below runs on the resulting position unless noted):

- **`hung_piece`** — generalizes the existing `isHungPieceBlunder` from a
  one-off scan-time heuristic into a reusable primitive: the move is a
  capture, and after it, no enemy piece can legally recapture on the
  destination square.
- **`fork`** — the moved piece's attacked squares (computed by generating
  its moves as if it were that color's turn, independent of whose turn it
  actually is) include ≥2 enemy-occupied squares, and either the king is
  among them, or at least two of the attacked pieces are worth ≥3 points
  each (knight or greater).
- **`pin` / `skewer`** — for each of the moved piece's sliding directions
  (only applies if the moved piece is a bishop/rook/queen), walk the ray
  outward from its square. The first occupied square is the "near"
  piece; if it's an enemy piece, continue the same ray past it — if the
  next occupied square is also an enemy piece (or the enemy king), we
  have a skewer/pin pair. **Pin**: near piece's value < far piece's value
  (or far piece is the king) — the near piece can't move without
  exposing the more valuable piece behind it. **Skewer**: near piece's
  value ≥ far piece's value — the near piece must move (it's more
  valuable / in check if it's the king), exposing the piece behind it.
- **`discovered_attack`** — after the move, check every *other* sliding
  piece of the mover's color: does it now attack the enemy king or a
  piece worth ≥3 points along a ray that passes through the square the
  moved piece just vacated, where that attack didn't exist (was blocked)
  before the move? This is the one heuristic pattern in this set —
  it only credits "classic" discoveries where the moved piece was
  literally blocking the discovering piece's ray, not more exotic
  discovery patterns.
- **`back_rank_mate`** — after the move, `chess.isCheckmate()` is true,
  the mated king sits on its own back rank (rank 1 for White, rank 8 for
  Black), the mating piece delivers check along that rank, and the king's
  forward escape squares are occupied by its own pawns.

Every one of these is a heuristic, same as the existing hung-piece
detector already is (its own comment says "not full SEE") — the goal is
useful, explainable pattern-matching for coaching text, not a formal
tactics-solver. This gets called on two different (position, move) pairs
per mistake (see next section), and mistakes are a small fraction of a
game's total plies, so running it during scan (which already runs a full
engine pass per game) is not a performance concern.

## Applying the detector: two directions per mistake

For every move a player made that was classified `mistake` or `blunder`
(unchanged — inaccuracies and better still don't count as insight
mistakes), `extractInsightRecord.ts` now calls `detectTactics` twice:

1. **What they missed**: `detectTactics(fenBefore, bestMoveUci)` — the
   engine's top move from `AnalyzedMove.evalBefore.lines[0]`, which is
   already computed during analysis but currently thrown away after
   classification runs.
2. **What they got punished by**: `detectTactics(fenAfter, opponentBestMoveUci)`
   — `fenAfter` is the mistake move's own `AnalyzedMove.fenAfter` (the
   position with the opponent to move), and `opponentBestMoveUci` comes
   directly from that same `AnalyzedMove.evalAfter.lines[0].moveUci` —
   the engine's top move for the position immediately following the
   mistake, already computed, no lookup into a neighboring ply needed.
   This directly replaces `isHungPieceBlunder`, generalizing it from a
   single boolean to the full six-tag set — `hung_piece` can appear here
   exactly where the old boolean would have been `true`.

## Data model changes

`src/shared/types.ts`:

```ts
export type TacticType =
  | 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'back_rank_mate' | 'hung_piece'

export interface GameInsightMistake {
  ply: number
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  clockSecondsRemaining: number | null
  isTimePressure: boolean
  cpLoss: number                      // NEW
  fenBefore: string                   // NEW
  playedMoveUci: string                // NEW
  bestMoveUci: string                  // NEW
  missedTactics: TacticType[]          // NEW
  punishedByTactics: TacticType[]      // NEW — replaces isHungPiece; hung_piece
                                        //       here means what isHungPiece: true meant
}

export interface GameInsightRecord {
  gameUrl: string
  endTime: number
  timeControlCategory: TimeControlCategory
  userColor: 'w' | 'b'
  opponentUsername: string             // NEW — needed for the recent-mistakes list
  result: 'win' | 'loss' | 'draw'
  openingName: string | null
  accuracy: number
  mistakes: GameInsightMistake[]
}

export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  tacticBreakdown: Record<TacticType, number>        // NEW — replaces hungPieceCount/positionalCount, tallies punishedByTactics
  missedTacticBreakdown: Record<TacticType, number>   // NEW — tallies missedTactics
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
  recentMistakes: MistakeSummary[]     // NEW, capped to the 20 most recent
}

export interface MistakeSummary {      // NEW
  gameUrl: string
  endTime: number
  opponentUsername: string
  ply: number
  phase: GamePhase
  cpLoss: number
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
}
```

`hungPieceCount`/`positionalCount` are removed from `InsightsBucket` —
every consumer (`reportAggregator.ts`, `TimeControlSection.tsx`, their
tests) moves to the new `tacticBreakdown`/`missedTacticBreakdown` maps.

## Cache schema versioning

Old cached game records have none of the new fields, and there's no way
to backfill them without re-running the engine — so a stale cache must
trigger a full rescan, the same way changing the tracked username already
does today (`ensureUsernameScope`, `insightsStore.ts`). Add a
`CURRENT_SCHEMA_VERSION` constant and store the version that produced the
cache in `scan-meta.json`. A new `ensureSchemaVersion()` function, called
at scan start alongside `ensureUsernameScope()`, wipes the `games/` cache
directory (same mechanism, same file) whenever the stored version doesn't
match. The next scan re-fetches and re-analyzes all games at the usual
100-game/depth-14 cost — an expected one-time cost identical to today's
first-ever scan for a new user, not a new risk.

## Opening book expansion

Today's `OPENING_BOOK_LINES` (`src/main/analysis/openingBook.ts`) has 16
hand-authored lines, so most games get `openingName: null` and are
silently excluded from opening-based findings
(`reportAggregator.ts:55`). Expand the table to roughly 120 common named
lines/variations in the same `{ name, moves }` format — still a static,
offline, hand-curated table, no new dependency or network source. This is
strictly additive and independent of everything else in this spec (no
other component depends on the table's size) — safe to cut from the plan
without touching anything else if it turns out to be too large a task on
its own.

## Findings synthesis

`topFindings.ts` changes from one hardcoded hung-piece rule to a
parameterized rule that runs once per tactic type against both
breakdowns:

- **Missed-tactic finding**: for each `TacticType` with ≥3 occurrences in
  a bucket's `missedTacticBreakdown` and a ≥25% share of that bucket's
  total missed-tactic count, emit "You've missed N {type}s in your last
  {games} games" (significance scales with count and share, same pattern
  as the existing rules).
- **Punished-by-tactic finding**: same shape, over `tacticBreakdown` —
  "You're most often punished by {type}s" — this is the direct successor
  to today's single `hungPieceFinding`, now covering all six tags instead
  of only hung pieces.
- **Trend finding** (new): split each bucket's mistakes at their midpoint
  by `endTime` (older half / newer half); for any tactic type whose share
  of mistakes changed by ≥15 percentage points between halves, emit
  "You're {missing/getting punished by} {type}s {more/less} often than
  earlier in your history" — reuses the existing rolling-window mental
  model from `trendBucketing.ts` but keyed per tactic type instead of one
  overall accuracy line.
- Existing `phaseFinding`, `timePressureFinding`, and `openingFindings`
  rules are unchanged in logic, just now running against a data set with
  real opening names for far more games (see opening book expansion
  above).

## UI (still text-only this phase)

- `TopFindingsList` — no structural change; renders whatever
  `synthesizeTopFindings` now produces.
- `TimeControlSection.tsx` — the phase bar chart stays; the old
  hung-piece/positional summary line is replaced with a small tag-chip
  row showing `tacticBreakdown` counts sorted descending (e.g. "Hung
  piece ×12 · Fork ×8 · Pin ×5"). A new **recent mistakes list** renders
  below it: each `MistakeSummary` as one row — date, opponent, phase, and
  its tactic tags. Purely informational text, not yet clickable (that's
  Phase 2) — but each row already carries `gameUrl` + `ply`, so Phase 2
  can wire up click-through without another data-model change.

## Error handling

No new error paths beyond what scanning already has. A schema-version
cache wipe surfaces the same way a fresh scan does today (progress bar,
no special messaging needed — it's indistinguishable from a first scan
from the user's point of view).

## Testing

- `tacticDetector.ts` gets its own thorough test file: hand-constructed
  FEN positions for each of the six tags (known fork/pin/skewer/
  discovered-attack/back-rank-mate/hung-piece positions) asserting
  correct detection, plus negative cases (quiet positions matching none
  of the six) and a multi-tag case (one move producing two tags at once).
- `extractInsightRecord.test.ts`, `reportAggregator.test.ts`,
  `topFindings.test.ts` updated for the new fields/shapes.
- Existing Vitest suite (193 tests as of this session) must keep passing;
  `isHungPiece`/`hungPieceCount`/`positionalCount` removal is a breaking
  type change, so every test referencing those needs updating, not just
  new tests added.
- Verified visually via `run-desktop`: Insights tab showing real tactic
  tags and the new recent-mistakes list against a real rescanned account.

## Future ideas (explicitly deferred — separate specs)

- **Phase 2 — click-to-review coaching board**: click a finding or a
  `MistakeSummary` row, jump to an embedded board (reuses `Board.tsx`)
  showing that exact position with arrows for the played move vs. the
  engine's best move, plus a coaching explanation built from the tactic
  tags this phase now produces.
- **Phase 3 — puzzle mode**: missed tactics become solvable puzzles
  (position before the mistake, try to find the move, reveal + explain),
  with a tracked solve rate over time.
- LLM-based coaching narrative — explicitly rejected for now per the
  user's choice of a fully deterministic, offline engine; revisit only if
  the user asks for it later.

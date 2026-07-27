# Mastery Tree — design

## Problem

The Puzzles tab practices whatever's due today as one flat SM-2 queue, mixed across every tactic type. There's no sense of progression by skill, no way to deliberately drill "forks" until you're actually good at them, and nodes for tactics you rarely blunder (back-rank mates, say) barely ever come up — not because you've mastered them, but because you haven't made enough real mistakes of that type for the queue to surface them.

## Scope

Restructures the Puzzles tab around a persistent, visual skill tree — one node per (tactic type, difficulty level) — gated by real mastery rather than an undifferentiated due-queue. Builds on, and does not replace, the existing SM-2 scheduler, tactic detector, and Puzzle Rating gamification layer shipped earlier. Backfills sparse nodes from a curated, already-generated slice of the CC0-licensed Lichess open puzzle database (see §3 — this asset is built and verified, not a future dependency).

## 1. Tree structure

18 nodes: the 6 existing `TacticType`s (fork, pin, skewer, discovered_attack, back_rank_mate, hung_piece) × 3 difficulty levels each. All 6 motifs' **Level 1 are unlocked from the start** — parallel tracks, no motif blocks access to a different one. Within one motif, levels are strictly sequential: mastering level *N* unlocks level *N+1* of that same motif only.

```ts
export type MasteryLevel = 1 | 2 | 3
export type MasteryNodeKey = string // `${TacticType}:${MasteryLevel}`, e.g. "fork:2"

export interface MasteryNodeState {
  key: MasteryNodeKey
  tactic: TacticType
  level: MasteryLevel
  unlocked: boolean   // level 1, or the prior level of the same tactic is mastered
  mastered: boolean
  cleanStreak: number // consecutive clean solves toward mastery, resets on anything else
  dueCount: number     // cards in this node's current pool with an SM-2 due-date <= now
}

export type MasteryTree = MasteryNodeState[] // always 18 entries
```

**Mastery**: 5 consecutive `'clean'` outcomes (first-try correct, no hint — the exact same outcome classification `resolveSolvedOutcome` already computes for Puzzle Rating) marks a node mastered and unlocks the next level of that tactic. A retry, hint, or give-up resets the streak to 0. This is tracked per-node, separately from each individual card's own SM-2 schedule — SM-2 still governs when a specific card comes back due; the streak governs whether the *node* progresses. Persisted in a new `masteryStore.ts` (mirrors `srsStore.ts`'s pattern exactly): `Record<MasteryNodeKey, { cleanStreak: number; mastered: boolean }>`, missing entries defaulting to `{ cleanStreak: 0, mastered: false }`.

**"Current active level"** for a tactic = the lowest level not yet mastered (or level 3, if all three are). This determines where a *new* real mistake of that tactic gets assigned — always to whichever level is currently the frontier, never retroactively re-bucketed. Once you've mastered `fork:1` and moved on, new fork mistakes flow into `fork:2`; `fork:1` keeps whatever backfill cards were already scheduled there for ongoing spaced review, but stops receiving fresh inflow. This avoids needing to invent a difficulty score for a user's own mistakes, or track historical per-mistake node assignment.

## 2. Node queue construction (`src/main/srs/masteryQueue.ts`)

For a node `(tactic, level)`:
- If `level === currentActiveLevel(tactic)`: include every one of the user's own detected mistakes tagged with that tactic (via the existing `missedTactics`/`punishedByTactics` fields on `GameInsightRecord`).
- Top up with backfill puzzles for `(tactic, level)` until the pool reaches a minimum of 15 cards (real mistakes are always preferred; backfill only fills the gap, it never displaces a real mistake). If a node — active or already-mastered — has fewer than 15 cards even after backfill (only possible if a single tactic+level's backfill bucket is nearly exhausted, which §3's numbers show doesn't happen here), just use what exists.
- Levels below the active one (mastered, superseded) draw only from backfill — the shipped queue builder excludes real mistakes entirely for any non-active level, full stop, rather than "freezing" whichever mistakes happened to be there before the level was superseded. A tactic's real mistakes always move wholesale to whichever level is currently active; none stay pinned to an old, already-mastered level. No history is lost (a mistake's SM-2 review schedule still follows its cardId to wherever it's practiced next), and this is simpler than tracking each mistake's historical node assignment — just note it as the actual behavior rather than the finer-grained "already-tracked cards persist" phrasing this section originally used.

Per the earlier "tree becomes primary" decision: **due-dates don't gate whether a node can be practiced** — every unlocked node is always practiceable. Within a session, cards already past their SM-2 due-date sort first; not-yet-due cards fill the rest of the session. `dueCount` on `MasteryNodeState` is purely an informational badge ("3 due"), not a gate.

## 3. Backfill corpus — already generated and verified

Downloaded the real Lichess open puzzle database (`database.lichess.org/lichess_db_puzzle.csv.zst`, CC0-licensed, 6,057,356 puzzles) and filtered it directly — this is not a future implementation step, the output already exists at `src/main/srs/backfillPuzzles.json` (~530KB, committed as a static asset, no runtime download, no network dependency).

Filter criteria: puzzles tagged with one of Lichess's own theme strings matching our six tactic types (`fork`, `pin`, `skewer`, `discoveredAttack`, `backRankMate`, `hangingPiece` → our `fork`, `pin`, `skewer`, `discovered_attack`, `back_rank_mate`, `hung_piece`), well-vetted (`Popularity >= 50`, `NbPlays >= 200`), banded by Lichess's own `Rating` field: **Level 1 <1200, Level 2 1200-1800, Level 3 1800+**, capped at 250 per (tactic, level) bucket. **Result: all 18 buckets filled completely — 4,500 puzzles total.**

**A real constraint this surfaced, not hidden**: our puzzle system grades one move per card; most real Lichess tactics (forks especially) are 2-move combinations recorded as 4+ plies (opponent's setup move, the solver's first move, an opponent reply, the solver's follow-through capture). Every backfill puzzle here is **truncated to the solver's first move only** — the "spot the tactic" moment — discarding the follow-up. This is why every bucket filled cleanly instead of forks coming back nearly empty (an earlier, stricter attempt requiring the *entire* puzzle to be a single move-pair returned essentially zero forks). The existing grading logic (`gradeAttempt`) already tolerates any reasonably good move via a live engine cp-loss check, not just an exact string match to the recorded move, so this truncation doesn't fight anything already built — it just means backfill puzzles test recognizing the tactic, not the full combination's follow-through.

Every one of the 4,500 entries' setup-move-then-best-move sequence was verified legal via `chess.js` directly (not assumed from the source data). Shape actually shipped, keyed by `` `${tactic}:${level}` ``:

```ts
interface BackfillPuzzle {
  id: string          // original Lichess PuzzleId, kept for traceability
  fenBefore: string   // resolved: the source FEN with the opponent's setup move already applied
  bestMoveUci: string
  rating: number       // the source Lichess puzzle's rating, kept for reference (not re-bucketing at runtime — the JSON's keys already encode the level)
}
```

## 4. Puzzle card shape across both sources (`src/shared/types.ts`)

```ts
export interface MasteryPuzzleCard {
  cardId: string        // mistakes: `${gameUrl}#${ply}` (matches existing PuzzleCard); backfill: `backfill:${id}`
  source: 'mistake' | 'backfill'
  fenBefore: string
  bestMoveUci: string
  tactic: TacticType
  userColor: 'w' | 'b'  // mistakes: from the game record; backfill: derived from fenBefore's side-to-move
  gameUrl: string | null
  opponentUsername: string | null
  endTime: number | null
}
```

A backfill card's `gameUrl`/`opponentUsername`/`endTime` are `null` — the practice-session UI (§5) shows the existing "vs `opponentUsername` · date" line only when non-null, and shows nothing (or a neutral "Practice puzzle" label) for backfill cards.

## 5. Renderer: tree as the primary Puzzles view

`PuzzlesTab.tsx` becomes a small router: with no node selected, render a new `MasteryTreeView.tsx` (6 columns, one per tactic, each showing its 3 levels stacked — locked/in-progress-with-streak/mastered); selecting an unlocked node starts a practice session scoped to it.

The practice session itself — retry-until-correct, single hint then give-up, the stats bar, per-card tagging to avoid stale renders — is **unchanged in mechanics**, just re-scoped: `usePuzzleSession` takes a `nodeKey` and fetches that node's queue (§2) instead of the old global due-queue. `submitPuzzleReview` (SM-2) and the existing Puzzle Rating gamification layer (rating/streak/solved-today/accuracy) are untouched and still fire on every attempt regardless of which node it came from — Mastery Tree adds a second, node-scoped progress signal (the clean-streak-to-mastery) alongside them, not instead of them. Mastery-streak updates apply only to the node the session is scoped to, even if a card happens to carry other tactic tags too.

## Out of scope

- Multi-move puzzle support (grading a forced 2-move sequence rather than one move) — a real, separate feature; §3 documents why it's not needed for backfill to work.
- Any change to the underlying SM-2 algorithm, the existing Puzzle Rating scoring, or the tactic detector itself.
- Re-downloading or re-generating the backfill corpus at runtime — the shipped JSON is static; refreshing it (e.g. against a newer Lichess dump) is a manual, occasional maintenance action, not an app feature.
- Cross-tactic node dependencies (e.g. "master forks before pins unlock") — every motif's Level 1 is unlocked from day one.

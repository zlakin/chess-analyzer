# Game History Insights Engine — Design Spec

Date: 2026-07-13

## Purpose

Beyond analyzing one game at a time, the app should be able to scan a
user's chess.com game history and surface recurring mistakes and
improvement areas — the kind of pattern a human coach would notice
("you blunder mostly in the endgame," "you fall apart under 30 seconds,"
"your Caro-Kann results are worse than everything else you play") but
that's invisible from looking at any single game.

This depends on the persisted chess.com username from the
desktop-packaging/settings spec, and lives in the "Insights" tab
introduced by the UI-redesign spec.

## Scope (v1)

- Scan up to the user's last 100 chess.com games (configurable only in
  the sense that re-scanning later pulls in new games since the last
  scan — no UI control to pick a different batch size in v1).
- Incremental: a game already analyzed and cached is never re-analyzed.
- Categorize mistakes (moves classified `mistake` or `blunder` by the
  existing engine pipeline) along four axes: game phase, hung-piece vs.
  positional, time pressure, and opening. Plus a trend view across games
  over time. All broken out per time control (bullet/blitz/rapid/daily)
  with an overall summary.
- A templated, rule-based "top things to work on" list synthesized from
  whichever stats are most significant.
- Runs as a background job with progress and cancellation, matching the
  existing single-game analysis UX.

Out of scope for v1: tactical-motif detection beyond the hung-piece
check (e.g. missed forks/pins/skewers as named patterns), lichess
import, any network/LLM call for generating the summary text (fully
local, rule-based), a UI control for custom scan ranges.

## Architecture

### Data flow

1. User clicks **Scan my games** on the Insights tab.
2. Main process reads the persisted chess.com username
   (`settingsStore.loadSettings()`), then calls `fetchRecentGames`
   (`src/main/chesscom/chessComClient.ts`, already supports a `limit`
   param) with `limit: 100`.
3. Cross-references the returned game URLs against
   `scan-meta.json`'s `scannedUrls` list; only new games proceed.
4. Each new game's PGN is parsed (`parsePgn`, moved from
   `src/renderer/src/lib/pgn.ts` to `src/shared/pgn.ts` so both renderer
   and main can use it — pure logic, no renderer dependency, safe to
   move) and run through the existing `analyzeGame` orchestrator
   (`src/main/analysis/gameAnalyzer.ts`), at **depth 14** instead of the
   single-game default of 18–20, to keep scan time reasonable (~100
   games × ~80 plies × ~0.4s/ply at the shallower depth is still on the
   order of an hour for a first scan; incremental re-scans only touch
   new games and are fast).
5. From each `GameAnalysisResult`, a new pure function
   `extractInsightRecord()` derives a compact `GameInsightRecord` (below)
   — deliberately not the full `AnalyzedMove[]` (which carries full
   engine PV lines and would bloat storage) — and writes it to
   `userData/games/<sha1(gameUrl)>.json`. `userColor` is whichever of
   the game's `white.username` / `black.username` case-insensitively
   matches the scanned username (already known, since the game came from
   that username's own archive). `scan-meta.json` is updated with the
   new URL and a `lastScanTime`.
6. The Insights tab requests the report on demand
   (`insights:get-report` IPC); main reads every cached
   `GameInsightRecord`, runs the aggregation functions (below), and
   returns a `InsightsReport` object. Nothing is precomputed/cached at
   the report level — recomputation over a few hundred small JSON
   records is cheap and guarantees the report always reflects the latest
   scan.

### Storage

- `userData/games/<hash>.json` — one `GameInsightRecord` per scanned
  game (hash of the chess.com game URL, so re-scans naturally dedupe).
- `userData/scan-meta.json` — `{ username, lastScanTime, scannedUrls: string[] }`.
- Both are plain JSON via Node's `fs/promises`, consistent with the
  no-database, minimal-dependency approach used elsewhere in this app.

```ts
interface GameInsightRecord {
  gameUrl: string
  endTime: number              // for chronological trend ordering
  timeControlCategory: 'bullet' | 'blitz' | 'rapid' | 'daily'
  userColor: 'w' | 'b'         // which side the tracked user played
  result: 'win' | 'loss' | 'draw'
  openingName: string | null   // matched against openingBook.ts, null if no match
  accuracy: number             // the user's accuracy for this game
  mistakes: Array<{
    ply: number
    classification: 'mistake' | 'blunder'
    phase: 'opening' | 'middlegame' | 'endgame'
    isHungPiece: boolean
    clockSecondsRemaining: number | null  // null if PGN had no %clk data
  }>
}
```

### Mistake categorization (pure functions, unit-testable against
`AnalyzedMove[]` fixtures — no live Stockfish needed)

- **Phase**: `ply < 20` → opening. Otherwise, endgame if both sides'
  remaining non-pawn material is at or below a rook + minor piece
  (computed from the FEN), else middlegame. Attributed only to moves
  already classified `mistake`/`blunder`.
- **Hung piece vs. positional**: for a mistake/blunder move, take the
  opponent's top engine line from `evalAfter.lines[0].pv[0]` (the
  reply's first move, in UCI). Apply it to `fenAfter` via chess.js; if
  it's a capture and the captured square is not defended by the user
  (no legal recapture, one-ply lookahead — an approximation of static
  exchange evaluation, not a full SEE), tag `isHungPiece: true`.
  Otherwise `false` (a positional/slow-evaluation mistake).
- **Time pressure**: requires `%clk` annotations in the chess.com PGN.
  **Assumption to verify during implementation**: chess.com's
  Published-Data API PGN export includes `{[%clk h:mm:ss]}` comments for
  games played with a clock. If a given game's PGN lacks them,
  `clockSecondsRemaining` is `null` for all its moves and that game is
  simply excluded from the time-pressure aggregation (not an error).
  Threshold for "time pressure" is time-control-relative (e.g. under
  ~10% of the starting time), not a flat constant, so it means something
  comparable across bullet vs. rapid.
- **Opening**: `openingBook.ts`'s `OPENING_BOOK_LINES` gets a `name`
  field added to each entry (the names already exist as source
  comments — this just makes them structured data instead of prose).
  A game's opening is the longest matching book line's name; games with
  no match are excluded from the per-opening breakdown. Openings are
  only reported once they have ≥3 games in the scanned set, to avoid
  drawing conclusions from a single game.
- **Trend**: games ordered by `endTime`; a simple rolling-window
  (e.g. 10-game) average accuracy/blunder-rate across the scanned set,
  oldest to newest.
- **Per-time-control breakout**: every aggregation above is computed
  once per `timeControlCategory` and once overall. A time control with
  too few games (e.g. <5) shows a "not enough games yet" note instead of
  a shaky stat.

### Report synthesis

- `InsightsReport` bundles, per time-control bucket (+ overall): phase
  breakdown, hung-piece ratio, time-pressure count, weak-openings list,
  trend series.
- A separate `synthesizeTopFindings()` function turns the computed stats
  into a ranked list of plain-language bullets (e.g. "62% of your
  blunders happen in the endgame (18 of 29)") using fixed sentence
  templates keyed to each stat category, ranked by a simple significance
  score (magnitude of deviation from the overall baseline, weighted by
  sample size so a stat backed by 3 games doesn't outrank one backed by
  30). This is deterministic template-filling, not free text generation
  — no network/LLM call, consistent with the app's fully-local design.

### UI (Insights tab content)

- Header: scan status (last scan time, games scanned, a **Rescan**
  button), progress bar + cancel while a scan is running.
- "Top things to work on": the synthesized bullet list, most
  significant first.
- Per-time-control sections (tabs or stacked panels): phase breakdown
  (bar chart), hung-piece vs. positional split, time-pressure count,
  weak-openings table, trend line — all via `recharts`, already a
  dependency, styled consistently with `EvalGraph`.

## Error handling

- Scan reuses the `AnalysisRunTracker` pattern (`src/main/ipc/analysisRunTracker.ts`)
  for per-run cancellation, same as single-game analysis.
- Chess.com fetch failures during a scan surface the same user-facing
  error messages `fetchRecentGames` already produces (not found,
  rate-limited, network error) — the scan stops cleanly, already-cached
  games are unaffected.
- A corrupted/unreadable per-game cache file is treated as "not yet
  scanned" (re-fetched and re-analyzed) rather than crashing the scan or
  the report aggregation.
- If Stockfish fails mid-scan (same failure modes as single-game
  analysis), the scan stops with a clear message; games already written
  to cache before the failure remain usable for the report.

## Testing

- Unit tests for each categorization function (phase heuristic,
  hung-piece one-ply lookahead, time-pressure threshold, opening
  grouping, trend bucketing, per-time-control breakout) against
  constructed `AnalyzedMove[]`/`GameInsightRecord` fixtures.
- Unit tests for `synthesizeTopFindings()`'s ranking/templating logic
  given fixed stat inputs.
- Unit tests for the incremental-scan skip logic (already-scanned URLs
  excluded) and the cache read/write layer (missing/corrupt file
  handling).
- No end-to-end test of a real 100-game scan in CI (too slow, needs a
  real Stockfish binary) — verified manually against a real chess.com
  account via the `run-desktop` skill.

## Future ideas (explicitly deferred)

- Named tactical-motif detection (forks, pins, skewers) beyond the
  hung-piece check.
- User-configurable scan batch size / date range in the UI.
- Lichess import as an additional game source.
- Exporting the report (PDF/image) or sharing it.

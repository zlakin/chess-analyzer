# Analyze tab: player perspective & chess.com-style parity — design

## Problem

The Analyze tab's board always defaults to White's perspective (`App.tsx:76`, `useState<'white' | 'black'>('white')`), regardless of which color the user played. There's no way to know from the UI which side is "you" without reading the PGN headers yourself, and flipping the board is only reachable via an undocumented `f`/`F` keyboard shortcut (`App.tsx:101`) — no visible button. For a user who plays Black roughly half the time, every other analysis session opens oriented to the wrong side.

Separately, the tab is asked to look and feel more like chess.com's game-review UI, with room for improvements beyond a straight copy. Today it's missing several things chess.com's report has: player names next to the board, the opening name, richer per-move commentary (currently one templated sentence, `moveDetail.ts`), and a report card that reads as three disconnected widgets (two accuracy numbers, an unlabeled stacked bar chart, a separate legend) rather than one cohesive summary.

## Scope

Renderer-side changes to the Analyze tab only (`App.tsx`, its extracted `AnalyzeTab.tsx`, and related `src/renderer/src/components/`/`lib/` files), plus relocating two existing pure logic modules from `src/main/analysis/` to `src/shared/` so the renderer can call them directly. No new IPC channels, no changes to the analysis engine, `GameAnalysisResult`, or any other tab (Insights, Puzzles).

## 1. Foundation

**Relocate pure logic to `src/shared/analysis/`:** `src/main/analysis/openingBook.ts` and `src/main/analysis/tacticDetector.ts` have zero Node-only dependencies (only `chess.js` and shared types/constants) — they're misplaced under `main`, not main-process-specific. Move both to `src/shared/analysis/`, update their 6 existing import sites (`gameAnalyzer.ts`, `extractInsightRecord.ts`, `classification.test.ts`, `tacticDetector.test.ts`, `openingBook.test.ts`, and their own relative imports), no behavior change. This lets the renderer call `matchOpeningName()` and `detectTactics()` directly — no new IPC channel needed for either.

**Extract `AnalyzeTab.tsx`** from the inline `activeTab === 'analyze'` JSX currently in `App.tsx:135-246`. Every other tab (`InsightsTab`, `PuzzlesTab`) is already its own component; Analyze is the outlier. `App.tsx` keeps owning all the state (`useGameAnalysis`, `useVariationExplorer`, `currentPly`, `boardOrientation`, `players`, `boardHeight`, the keyboard-shortcut `useEffect`) since the keyboard handler needs it in `App.tsx` regardless; `AnalyzeTab` receives it as props, the same shape `InsightsTab`/`PuzzlesTab` already follow. Pure refactor, no visible behavior change from this step alone.

## 2. Board orientation & player headers

**User-color detection** (`src/renderer/src/lib/userColor.ts`, new): `resolveUserColor(players: Players, username: string | null): 'w' | 'b' | null`. Case-insensitive match against `players.white`/`players.black`, mirroring the existing pattern in `src/main/insights/extractInsightRecord.ts:37-38`. Returns `null` when `username` is `null` (no linked account) or matches neither header (common for pasted PGNs, or a linked account that isn't in this particular game).

**Orientation:** in `handleGameLoaded` (`App.tsx:58-72`), after parsing, call `resolveUserColor(players, linkedAccount?.username ?? null)`. If it resolves, initialize `boardOrientation` to that color; otherwise leave the existing default of `'white'`. The `f`/`F` keyboard flip (`App.tsx:101`) stays as-is. New: a visible flip-icon button in `.board-nav` (`App.tsx:191-216`), alongside the existing first/prev/next/last buttons, using a `lucide-react` icon consistent with the others (`RotateCw` or similar) — same click handler the keyboard shortcut already calls.

**`PlayerHeader.tsx`** (new component, two instances per render — above and below the board): displays the header's `[White "..."]`/`[Black "..."]` name and, if present, an Elo badge. New regex extraction alongside the existing name regex in `handleGameLoaded`:
```ts
white: { name: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White', elo: pgn.match(/\[WhiteElo "(\d+)"\]/)?.[1] ?? null }
```
(same shape for black). The `Players` interface (`App.tsx:25-28`) gains `whiteElo`/`blackElo: string | null`. Which name renders top vs. bottom swaps with `boardOrientation` — the bottom slot is always whoever the board is oriented toward, matching chess.com's "you're always at the bottom" convention. No "(you)" label; position alone conveys it, same as chess.com. The Elo badge renders nothing when the tag is absent — no placeholder, no "?".

## 3. Opening name & coach text

**Opening name:** in `AnalyzeTab`, `useMemo(() => matchOpeningName(state.moves.map(m => m.san)), [state.moves])`, computed once moves exist. Rendered as a header line reused by the restyled report card (Section 4) — not a separate standalone element. Renders nothing when `null` (game deviated before any book line completed), matching `matchOpeningName`'s existing "don't guess" behavior.

**Richer coach text:** extend `formatMoveDetail` (`src/renderer/src/lib/moveDetail.ts`) in place — same base sentence (`"{san} — {label}, {sign}{delta}% win chance. Best was {bestSan}."`). For `mistake`/`blunder` classifications only (not `inaccuracy`, to avoid noise on lower-stakes moves) and only in the existing `!delta.isBestMove` branch (where `bestUci` is already computed), additionally call `detectTactics(move.fenBefore, bestUci)` — against the *best* move, not the move actually played, since the point is naming what the missed alternative achieves. `detectTactics` returns tags (e.g. `'fork'`), not which pieces/squares are involved, so the clause names the tag via `TACTIC_LABELS`, lowercased, in parentheses — no invented grammar about what's forked/pinned beyond what the data actually says: `"Nf3 — Blunder, −38% win chance. Best was Bxc6 (fork)."` When more than one tag is returned, list all of them comma-separated inside the same parentheses. No clause when `detectTactics` returns nothing.

## 4. Game Report card restyle

Restyle `GameSummary.tsx` into one cohesive card instead of three disconnected widgets:

- **Header line:** the opening name from Section 3 (renders nothing if `null`, same as today's absence of any opening display).
- **Accuracy:** the two existing numbers become the dominant visual element — larger, `--font-display`, player name beneath each (unchanged data, `whiteAccuracy`/`blackAccuracy`).
- **Classification breakdown:** replace the `recharts` `BarChart` (`GameSummary.tsx:81-96`) and the separate `.classification-legend` list (`98-109`) with a single table — one row per classification that appears at least once in the game (existing fixed order, `book` excluded from rows since it's not a quality judgment), each row `{white count} · {icon + label} · {black count}`. More precisely readable than an unlabeled stacked bar, and closer to chess.com's actual report layout. Drops the `BarChart` import from this file only (`recharts` itself stays a dependency — still used by `EvalGraph.tsx`).

Still renders inline in the side panel (not a modal), per existing confirmation — the board and move list stay visible at all times.

## Testing

Unit tests for the new pure logic:
- `userColor.ts`: linked-and-matching, linked-but-no-match, and unlinked (`null` username) cases.
- Extended `formatMoveDetail`: tactic clause appended only for `mistake`/`blunder`, omitted for `inaccuracy` and when `detectTactics` returns `[]`.
- The new Elo-regex extraction: present, absent, malformed tag.
- `openingBook.ts`/`tacticDetector.ts` relocation carries their existing test suites over unchanged, just updated import paths.

Component-level tests stay out of scope, per this repo's established no-jsdom-for-components policy — verified instead by driving the real app via the `run-desktop` skill (board orientation on a Black-played game, flip button, player headers swapping sides, opening name, coach text on a real blunder, restyled report card), the same verification approach used for the Mastery Tree feature.

## Out of scope

- No estimated-rating-performance stat (chess.com shows this; this app has no reliable way to compute it and a wrong number would undermine trust more than an absent one).
- No modal/overlay report card — stays inline per explicit choice.
- No changes to the analysis engine, classification thresholds, or `GameAnalysisResult`'s shape.
- No changes to Insights or Puzzles tabs, beyond the mechanical import-path update from the `src/shared/analysis/` relocation.

# Insights coaching bridge — design

## Problem

The Insights tab's "Recent mistakes" list (`RecentMistakesList.tsx`) tells the user exactly what went wrong — *"7/23/2026 · vs Adilov2009 · move 26 · Hung piece"* — and then the trail goes dead. Each row is plain text with no click handler. The only way to actually see that position today is to manually re-import the same game in the Analyze tab and scrub to the right move. The single most valuable interaction a chess-improvement app can offer — see the mistake, see the fix, practice it — doesn't exist, even though every piece of data needed to build it (`fenBefore`, `bestMoveUci`, tactic tags) is already cached on disk per mistake and the exact grading mechanics already exist and are proven in the Puzzles feature.

## Scope

Renderer: a new modal opened from Insights' recent-mistakes list, and the components/hook it needs. Main process: one new IPC handler that resolves a mistake's full position data (including which mastery node, if any, it should credit) from data already cached by the existing Insights scan pipeline — no new scanning, no chess.com re-fetch, no engine re-analysis of a whole game. One existing IPC signature (`submitPuzzleOutcome`) widens to accept a nullable `nodeKey`; its existing call site is otherwise unaffected.

## 1. New IPC: resolve a mistake's full data

**`src/shared/types.ts`** gains:
```ts
export interface MistakeDetail {
  fenBefore: string
  playedMoveUci: string
  bestMoveUci: string
  classification: 'mistake' | 'blunder'
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  userColor: 'w' | 'b'
  cardId: string
  nodeKey: MasteryNodeKey | null
}
```

`ChessAPI` gains `getMistakeDetail(gameUrl: string, ply: number): Promise<MistakeDetail | null>` (`null` when the mistake can't be found — e.g. the cache was cleared or rescanned between the list rendering and the click).

**Handler** (`src/main/ipc/handlers.ts`): calls `loadAllGameRecords()` (already used by `getInsightsReport`/`getMasteryTree`/`getNodeQueue` — no new store logic), finds the `GameInsightRecord` matching `gameUrl`, finds the `GameInsightMistake` matching `ply` within it. Builds `cardId` as `` `${gameUrl}#${ply}` `` — the exact convention `mistakeCardsFor` (`masteryQueue.ts`) already uses for real-mistake cards, so this is provably the same card a puzzle session would eventually serve, not a parallel identity.

`nodeKey` resolution happens here, not in the renderer: if `missedTactics`/`punishedByTactics` (deduped, `missedTactics` first) has at least one tag, `nodeKey = `${tag}:${currentActiveLevel(masteryState, tag)}`` using the existing pure function from `masteryTree.ts` (already imported by `masteryQueue.ts` — same pattern, reused not duplicated). Untagged ("Positional") mistakes get `nodeKey: null`. Doing this server-side means the renderer never needs its own copy of "what's the active level for tactic X" logic, and there's no window where a separately-fetched mastery tree could be stale relative to the outcome submission.

## 2. Rating and mastery-node integration

**`submitPuzzleOutcome`'s signature widens**: `nodeKey: MasteryNodeKey` → `nodeKey: MasteryNodeKey | null`, return type's `nodeProgress: MasteryNodeProgress` → `MasteryNodeProgress | null`. When `null`, the handler updates and returns `PuzzleStats` only, skipping the mastery-state read/write entirely. This is purely additive — `usePuzzleSession.ts`'s existing call always passes a concrete `nodeKey` (the node the user deliberately chose to practice), so real puzzle sessions are unaffected.

Resolving the mini-puzzle (solved clean, solved with a hint, or given up) calls the *same two endpoints* a real puzzle session calls, using `MistakeDetail`'s `cardId`/`nodeKey`:
- `submitPuzzleReview(cardId, quality)` — reschedules this exact card's SM2 due-date, so if it later surfaces in a real puzzle session it correctly reflects having already been reviewed.
- `submitPuzzleOutcome(outcome, classification, nodeKey)` — always updates Puzzle Rating/streak; updates the tactic's mastery-node streak only when `nodeKey` is non-null.

A mistake tagged with more than one tactic only credits the first tag's node (matching the existing display-order dedup in `RecentMistakesList`) — rating still updates regardless of tag count.

## 3. Component and hook structure

**Trigger:** `RecentMistakesList.tsx`'s rows change from plain `<li>` text to `<li><button onClick=...>`. The click lifts `{ gameUrl, ply }` to `InsightsTab.tsx` as new state (`selectedMistake: { gameUrl: string; ply: number } | null`); `InsightsTab` fetches `MistakeDetail` via the new IPC when it's set and renders the modal once resolved.

**`MistakeCoachModal.tsx`** (new): a modal overlay reusing `ConnectAccountModal`'s existing backdrop/panel CSS pattern (so it reads as belonging to the app, not a new visual language), containing:
- The tactic tag chip(s), or "Positional" — reusing `.recent-mistake-tag` styling, visually continuous with the row that was clicked.
- `<Board>` (`Board.tsx`, unmodified) at `fenBefore`, oriented to `userColor` — this is always the user's own missed move, so orientation has no ambiguity to resolve, unlike Analyze's auto-detection.
- Hint / Can't-solve controls and feedback states, reusing `PuzzleSessionView`'s existing classes (`.puzzle-hint-controls`, `.puzzle-feedback-*`) so the interaction *feels* like Puzzles, not a distinct thing bolted on.
- Closes via backdrop click or an explicit close button, matching `ConnectAccountModal`.

**`useMistakeAttempt(detail: MistakeDetail)`** (new hook): mirrors the relevant slice of `usePuzzleSession`'s `attempt`/`requestHint`/`giveUp` logic — exact-match fast path, else live `window.chessAPI.evaluatePosition` at depth 12 via the existing `gradeAttempt` — adapted for one ad-hoc card instead of a queue (no `next()`/queue-advance; resolving just ends the interaction, closing the modal is how you move on). This is a deliberate new hook rather than a generalization of `usePuzzleSession` — some attempt/grading logic will be duplicated between the two, but reshaping an already-tested hook to serve two different callers is a bigger, riskier change than the duplication is worth for this feature.

## Testing

- `getMistakeDetail` handler: found (with and without a tactic tag, confirming `nodeKey` resolution both ways), not-found (`null`) cases.
- `useMistakeAttempt`: exact-match fast path (no engine call), engine-graded correct/incorrect paths (mocked `evaluatePosition`), hint/give-up flows — mirroring the existing test coverage pattern for `usePuzzleSession` where practical.
- `submitPuzzleOutcome` handler: `nodeKey: null` path skips mastery-state write and still updates/returns `PuzzleStats`; existing non-null path unchanged (regression coverage).
- Component-level modal rendering stays out of scope per this repo's no-jsdom-for-components policy — verified via `run-desktop` instead: open the modal from a real tagged mistake and a real untagged one, confirm the board/orientation/tags render correctly, attempt both correct and incorrect moves, confirm Puzzle Rating updates, confirm the tagged case's mastery-node streak updates and the untagged case's doesn't, confirm hint/give-up reveal the right square/move.

## Out of scope

- No new scanning, no chess.com re-fetch, no full-game re-analysis — this reuses cached scan data end-to-end.
- No changes to `usePuzzleSession.ts`'s own behavior or signature beyond the additive `submitPuzzleOutcome` widening.
- No UI for browsing *all* mistakes beyond what `RecentMistakesList`/`TimeControlSection` already surface (the existing 20-item cap, "Show N more" pattern, and per-bucket scoping are unchanged).
- Crediting more than one mastery node per mistake (multi-tag mistakes) — only the first tag's node updates.

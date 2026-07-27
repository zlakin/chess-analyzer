# Analyze Tab: Player Perspective & Chess.com-Style Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Analyze tab's board always defaults to White's perspective regardless of which color the user played; this plan makes it auto-orient to the user's own color when detectable (with a visible manual-flip fallback), and brings the tab closer to chess.com's game-review UI — player name/rating headers beside the board, the opening name, richer per-move coach text, and a more cohesive Game Report card.

**Architecture:** Two pure logic modules (`openingBook.ts`, `tacticDetector.ts`) move from `src/main/analysis/` to `src/shared/analysis/` so the renderer can call them directly with no new IPC surface. The Analyze tab's inline JSX in `App.tsx` is extracted into its own `AnalyzeTab.tsx` component, matching the existing `InsightsTab`/`PuzzlesTab` pattern, then every new feature (orientation, player headers, coach text, report card) is added inside that component. No changes to the analysis engine, `GameAnalysisResult`'s shape, or any other tab.

**Tech Stack:** React 18, TypeScript, Vite/electron-vite, Vitest, `lucide-react` icons, `chess.js`, `recharts` (unchanged elsewhere, dropped from `GameSummary.tsx` only).

## Global Constraints

- No new IPC channels anywhere in this plan — every new piece of displayed data derives from state the renderer already holds (`state.moves`, `players`, `linkedAccount`), via the two relocated shared modules.
- This repo's git workflow: commit straight to `main` (no branches/worktrees/PRs).
- No estimated-rating-performance stat — this app has no reliable way to compute one, and a wrong number would undermine trust more than an absent one.
- The Game Report card stays inline in the side panel, not a modal/overlay.
- No changes to the analysis engine, move-classification thresholds, or `GameAnalysisResult`'s shape (`src/shared/types.ts:54-58`).
- No changes to the Insights or Puzzles tabs, beyond the mechanical import-path update from the `src/shared/analysis/` relocation (Task 1).
- Component-level tests stay out of scope, per this repo's established no-jsdom-for-components policy — verify new UI by driving the real app via the `run-desktop` skill instead.
- The dev environment already has a linked, verified test account (`zlakin`, `~/.config/chess-analyzer/settings.json`) — live verification of auto-orientation should use a real chess.com game where this account played Black (visible directly in the Import modal's Chess.com tab game list, which shows `white.username`/`black.username` per row), not just the fallback/manual path.

---

### Task 1: Relocate shared analysis logic

**Files:**
- Move: `src/main/analysis/openingBook.ts` → `src/shared/analysis/openingBook.ts`
- Move: `src/main/analysis/openingBook.test.ts` → `src/shared/analysis/openingBook.test.ts`
- Move: `src/main/analysis/tacticDetector.ts` → `src/shared/analysis/tacticDetector.ts`
- Move: `src/main/analysis/tacticDetector.test.ts` → `src/shared/analysis/tacticDetector.test.ts`
- Modify: `src/main/analysis/gameAnalyzer.ts:4`
- Modify: `src/main/analysis/classification.test.ts:4`
- Modify: `src/main/insights/extractInsightRecord.ts:9,17`

**Interfaces:**
- Consumes: nothing new — this is a pure file move, zero behavior change.
- Produces: `matchOpeningName(sanHistory: string[]): string | null` and `isBookMove(...)` from `src/shared/analysis/openingBook.ts`; `detectTactics(fenBefore: string, moveUci: string): TacticType[]` from `src/shared/analysis/tacticDetector.ts`. Tasks 5-6 import both directly from these new paths.

Both files have zero Node-only dependencies today (only `chess.js`, `../../shared/pgn` for `PIECE_VALUES`, and `../../shared/types`) — they're moving to a directory that's already exactly one level closer to those imports, so their own internal imports also need adjusting.

- [ ] **Step 1: Move the four files**

```bash
mkdir -p src/shared/analysis
git mv src/main/analysis/openingBook.ts src/shared/analysis/openingBook.ts
git mv src/main/analysis/openingBook.test.ts src/shared/analysis/openingBook.test.ts
git mv src/main/analysis/tacticDetector.ts src/shared/analysis/tacticDetector.ts
git mv src/main/analysis/tacticDetector.test.ts src/shared/analysis/tacticDetector.test.ts
```

- [ ] **Step 2: Fix `tacticDetector.ts`'s own import**

`src/shared/analysis/tacticDetector.ts` currently has, at the top:

```ts
import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { PIECE_VALUES } from '../../shared/pgn'
import type { TacticType } from '../../shared/types'
```

It moved from `src/main/analysis/` (two levels under `src/`) to `src/shared/analysis/` (also two levels under `src/`) — same depth, so `../../shared/pgn` and `../../shared/types` are now wrong (they'd resolve to `src/shared/shared/pgn`, which doesn't exist). Change both to one level up:

```ts
import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { PIECE_VALUES } from '../pgn'
import type { TacticType } from '../types'
```

`openingBook.ts` has no imports of its own (it's fully self-contained data + function) — no change needed there.

- [ ] **Step 3: Update `gameAnalyzer.ts`'s import**

In `src/main/analysis/gameAnalyzer.ts:4`, change:

```ts
import { isBookMove } from './openingBook'
```

to:

```ts
import { isBookMove } from '../../shared/analysis/openingBook'
```

- [ ] **Step 4: Update `classification.test.ts`'s import**

In `src/main/analysis/classification.test.ts:4`, change:

```ts
import { isBookMove } from './openingBook'
```

to:

```ts
import { isBookMove } from '../../shared/analysis/openingBook'
```

- [ ] **Step 5: Update `extractInsightRecord.ts`'s two imports**

In `src/main/insights/extractInsightRecord.ts`, change line 9:

```ts
import { detectTactics } from '../analysis/tacticDetector'
```

to:

```ts
import { detectTactics } from '../../shared/analysis/tacticDetector'
```

and line 17:

```ts
import { matchOpeningName } from '../analysis/openingBook'
```

to:

```ts
import { matchOpeningName } from '../../shared/analysis/openingBook'
```

- [ ] **Step 6: Verify**

```bash
npm run typecheck
npx vitest run
```

Expected: typecheck clean, all tests pass (same total as before this task — no tests added or removed, only moved and re-pathed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move openingBook and tacticDetector to src/shared/analysis"
```

---

### Task 2: Extract `AnalyzeTab.tsx`

**Files:**
- Create: `src/renderer/src/lib/players.ts`
- Create: `src/renderer/src/components/AnalyzeTab.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: everything `App.tsx` currently computes for the Analyze tab — `state: AnalysisState` (`src/renderer/src/lib/analysisReducer.ts`), `position: PositionAtPly` and `currentMove: AnalyzedMove | null` (both already computed in `App.tsx` via `getPositionAtPly`/`getMoveAtPly`), `explorer: ReturnType<typeof useVariationExplorer>`, `boardOrientation`, `boardHeight`, `players: Players`, `pgnError`.
- Produces: `AnalyzeTab` component with the props interface below; `Players` interface, now living in `src/renderer/src/lib/players.ts` instead of inline in `App.tsx`. Task 4 extends `Players` with `whiteElo`/`blackElo` and adds a `parsePlayers` function to this same file.

This is a pure refactor — the rendered output and all behavior must be identical before and after. No new features in this task.

- [ ] **Step 1: Create `src/renderer/src/lib/players.ts`**

```ts
export interface Players {
  white: string
  black: string
}
```

This is moved verbatim from the `Players` interface currently at `App.tsx:25-28`.

- [ ] **Step 2: Create `src/renderer/src/components/AnalyzeTab.tsx`**

```tsx
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
import type { AnalyzedMove } from '../../../shared/types'
import type { AnalysisState } from '../lib/analysisReducer'
import type { PositionAtPly } from '../lib/gameNavigation'
import type { Players } from '../lib/players'
import { useVariationExplorer } from '../hooks/useVariationExplorer'
import { ImportModal } from './ImportModal'
import { Board } from './Board'
import { EvalBar } from './EvalBar'
import { MoveList } from './MoveList'
import { EvalGraph } from './EvalGraph'
import { GameSummary } from './GameSummary'
import { MoveDetail } from './MoveDetail'
import { ExploringBanner } from './ExploringBanner'
import { formatScore, whiteWinPercent } from '../lib/displayEval'

interface AnalyzeTabProps {
  state: AnalysisState
  currentPly: number
  position: PositionAtPly
  currentMove: AnalyzedMove | null
  boardOrientation: 'white' | 'black'
  boardHeight: number | undefined
  players: Players
  pgnError: string | null
  explorer: ReturnType<typeof useVariationExplorer>
  onGameLoaded: (pgn: string) => void
  onNewGame: () => void
  onCancelAnalysis: () => void
  onBoardHeightChange: (height: number) => void
  goToPly: (ply: number) => void
  setCurrentPly: (ply: number) => void
}

export function AnalyzeTab({
  state,
  currentPly,
  position,
  currentMove,
  boardOrientation,
  boardHeight,
  players,
  pgnError,
  explorer,
  onGameLoaded,
  onNewGame,
  onCancelAnalysis,
  onBoardHeightChange,
  goToPly,
  setCurrentPly
}: AnalyzeTabProps): JSX.Element {
  return (
    <>
      {state.status !== 'idle' && (
        <div className="analyze-tab-toolbar">
          <button onClick={onNewGame}>New Game</button>
        </div>
      )}

      {state.status === 'idle' && <ImportModal onGameLoaded={onGameLoaded} />}
      {pgnError && <div className="import-error">{pgnError}</div>}

      {state.status === 'analyzing' && (
        <div className="analysis-progress">
          <span>
            Analyzing... {state.moves.length} / {state.positions.length} moves
          </span>
          <progress value={state.moves.length} max={state.positions.length} />
          <button onClick={onCancelAnalysis}>Cancel</button>
        </div>
      )}

      {state.status === 'error' && <div className="import-error">{state.error}</div>}
      {state.status === 'cancelled' && <div className="import-error">Analysis cancelled.</div>}

      {(state.status === 'analyzing' || state.status === 'done') && state.moves.length > 0 && (
        <div className="analysis-layout">
          <EvalBar
            whiteWinPercent={
              explorer.isExploring
                ? explorer.evaluation
                  ? whiteWinPercent(explorer.evaluation, explorer.sideToMove)
                  : 50
                : position.evaluation
                  ? whiteWinPercent(position.evaluation, position.sideToMove)
                  : 50
            }
            displayScore={
              explorer.isExploring
                ? explorer.evaluation
                  ? formatScore(explorer.evaluation, explorer.sideToMove)
                  : '...'
                : position.evaluation
                  ? formatScore(position.evaluation, position.sideToMove)
                  : '0.00'
            }
            height={boardHeight}
          />
          <div className="board-column">
            <Board
              fen={explorer.currentFen}
              bestMoveUci={explorer.isExploring ? null : position.bestMoveUci}
              currentMove={explorer.isExploring ? null : currentMove}
              boardOrientation={boardOrientation}
              onMove={explorer.makeMove}
              onHeightChange={onBoardHeightChange}
            />
            <div className="board-nav">
              <button onClick={() => goToPly(0)} disabled={currentPly === 0} title="First move (Home)">
                <ChevronsLeft size={18} />
              </button>
              <button
                onClick={() => goToPly(currentPly - 1)}
                disabled={currentPly === 0}
                title="Previous move (←)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => goToPly(currentPly + 1)}
                disabled={currentPly === state.moves.length}
                title="Next move (→)"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => goToPly(state.moves.length)}
                disabled={currentPly === state.moves.length}
                title="Last move (End)"
              >
                <ChevronsRight size={18} />
              </button>
            </div>
            {explorer.isExploring ? (
              <ExploringBanner
                evaluation={explorer.evaluation}
                isEvaluating={explorer.isEvaluating}
                sideToMove={explorer.sideToMove}
                canUndo={true}
                onUndo={explorer.undoLastMove}
                onExit={explorer.exitExploration}
              />
            ) : (
              <MoveDetail move={currentMove} />
            )}
          </div>
          <div className="side-panel">
            <MoveList moves={state.moves} currentPly={currentPly} onSelectPly={setCurrentPly} />
            <EvalGraph moves={state.moves} currentPly={currentPly} onSelectPly={setCurrentPly} />
            {state.status === 'done' && state.whiteAccuracy !== null && state.blackAccuracy !== null && (
              <GameSummary
                moves={state.moves}
                whiteAccuracy={state.whiteAccuracy}
                blackAccuracy={state.blackAccuracy}
                whiteUsername={players.white}
                blackUsername={players.black}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
```

This is a byte-for-byte move of `App.tsx:135-246`'s JSX, with every closure reference (`handleNewGame`, `handleGameLoaded`, `cancelAnalysis`, `handleBoardHeightChange`, `goToPly`, `setCurrentPly`) replaced by the equivalent prop.

- [ ] **Step 3: Replace `App.tsx` in full**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavBar } from './components/NavBar'
import type { AppTab } from './components/NavBar'
import { InsightsTab } from './components/InsightsTab'
import { PuzzlesTab } from './components/PuzzlesTab'
import { AnalyzeTab } from './components/AnalyzeTab'
import { ConnectAccountModal } from './components/ConnectAccountModal'
import type { ChessComPlayerStats, LinkedAccount } from '../../shared/types'
import type { Players } from './lib/players'
import { useGameAnalysis } from './hooks/useGameAnalysis'
import { useInsightsScan } from './hooks/useInsightsScan'
import { useTheme } from './hooks/useTheme'
import { parsePgn, PgnParseError } from '../../shared/pgn'
import { getPositionAtPly, getMoveAtPly } from './lib/gameNavigation'
import { useVariationExplorer } from './hooks/useVariationExplorer'

function App(): JSX.Element {
  const { state, startAnalysis, cancelAnalysis, reset } = useGameAnalysis()
  const insightsScan = useInsightsScan()
  const { theme, toggleTheme } = useTheme()
  const [currentPly, setCurrentPly] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Players>({ white: 'White', black: 'Black' })
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccount | null>(null)
  const [rating, setRating] = useState<ChessComPlayerStats | null>(null)
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [boardHeight, setBoardHeight] = useState<number | undefined>(undefined)
  const handleBoardHeightChange = useCallback((height: number) => setBoardHeight(height), [])

  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => setLinkedAccount(settings.linkedAccount))
  }, [])

  useEffect(() => {
    if (!linkedAccount?.verifiedAt) {
      setRating(null)
      return
    }
    window.chessAPI.fetchChessComStats(linkedAccount.username).then((result) => {
      setRating('error' in result ? null : result)
    })
  }, [linkedAccount?.verifiedAt, linkedAccount?.username])

  const handleGameLoaded = (pgn: string): void => {
    setPgnError(null)
    try {
      const positions = parsePgn(pgn)
      setPlayers({
        white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
        black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
      })
      setCurrentPly(0)
      explorer.exitExploration()
      void startAnalysis(positions)
    } catch (err) {
      setPgnError(err instanceof PgnParseError ? err.message : 'Could not parse this PGN')
    }
  }

  const position = useMemo(() => getPositionAtPly(state.moves, currentPly), [state.moves, currentPly])
  const currentMove = useMemo(() => getMoveAtPly(state.moves, currentPly), [state.moves, currentPly])
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const explorer = useVariationExplorer(position.fen)

  const handleNewGame = (): void => {
    // "New Game" is offered while an analysis is still running, so cancel it
    // first - otherwise the whole engine pool keeps churning server-side on a
    // game the renderer has already thrown away. No-op when nothing is in flight.
    cancelAnalysis()
    reset()
    setCurrentPly(0)
    explorer.exitExploration()
    setPgnError(null)
  }

  const goToPly = (ply: number): void => {
    setCurrentPly(Math.max(0, Math.min(ply, state.moves.length)))
  }

  useEffect(() => {
    if (state.moves.length === 0) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') goToPly(currentPly - 1)
      else if (e.key === 'ArrowRight') goToPly(currentPly + 1)
      else if (e.key === 'Home') goToPly(0)
      else if (e.key === 'End') goToPly(state.moves.length)
      else if (e.key === 'f' || e.key === 'F') setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPly, state.moves.length])

  return (
    <div className="app">
      <NavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAnalyzing={state.status === 'analyzing'}
        isScanning={insightsScan.state.status === 'scanning'}
        linkedAccount={linkedAccount}
        rating={rating}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {isConnectModalOpen && (
        <ConnectAccountModal
          linkedAccount={linkedAccount}
          onClose={() => setIsConnectModalOpen(false)}
          onLinked={(account) => {
            setLinkedAccount(account)
            setIsConnectModalOpen(false)
          }}
          onDisconnected={() => {
            setLinkedAccount(null)
            setIsConnectModalOpen(false)
          }}
        />
      )}
      <main className="app-content">
        {activeTab === 'analyze' && (
          <AnalyzeTab
            state={state}
            currentPly={currentPly}
            position={position}
            currentMove={currentMove}
            boardOrientation={boardOrientation}
            boardHeight={boardHeight}
            players={players}
            pgnError={pgnError}
            explorer={explorer}
            onGameLoaded={handleGameLoaded}
            onNewGame={handleNewGame}
            onCancelAnalysis={cancelAnalysis}
            onBoardHeightChange={handleBoardHeightChange}
            goToPly={goToPly}
            setCurrentPly={setCurrentPly}
          />
        )}

        {activeTab === 'insights' && (
          <InsightsTab
            state={insightsScan.state}
            startScan={insightsScan.startScan}
            cancelScan={insightsScan.cancelScan}
          />
        )}

        {activeTab === 'puzzles' && <PuzzlesTab />}
      </main>
    </div>
  )
}

export default App
```

Note what's removed from the original `App.tsx`'s import list: `ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight` (lucide-react), `ImportModal`, `Board`, `EvalBar`, `MoveList`, `EvalGraph`, `GameSummary`, `MoveDetail`, `ExploringBanner` (all now only imported inside `AnalyzeTab.tsx`), and `formatScore`/`whiteWinPercent` (same). The `Players` interface block is gone, replaced by `import type { Players } from './lib/players'`. Everything else — including `position`/`currentMove`'s `useMemo` calls and the keyboard-shortcut `useEffect` — stays in `App.tsx` unchanged, since `explorer` is constructed from `position.fen` right here and the keyboard handler needs `currentPly`/`state.moves.length`/`setBoardOrientation` directly.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: typecheck clean, all tests pass (unchanged total), build clean.

- [ ] **Step 5: Verify visually via `run-desktop`**

```bash
cat > /tmp/verify-analyzetab-extraction.txt <<'EOF'
launch
click-text Analyze
sleep 300
ss analyze-tab-idle
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-analyzetab-extraction.txt
```

Expected: the Analyze tab (Import modal: Paste/Upload/Chess.com tabs) renders exactly as before — this step only confirms the extraction didn't break the tab's idle state. Full behavior (import → analyze → navigate) is exercised in Task 7's final verification pass; a full walkthrough here would be redundant.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-analyzetab-extraction.txt
git add src/renderer/src/lib/players.ts src/renderer/src/components/AnalyzeTab.tsx src/renderer/src/App.tsx
git commit -m "Extract AnalyzeTab.tsx from App.tsx"
```

---

### Task 3: User-color detection, auto-orientation, and a visible flip button

**Files:**
- Create: `src/renderer/src/lib/userColor.ts`
- Test: `src/renderer/src/lib/userColor.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/AnalyzeTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `Players` (`src/renderer/src/lib/players.ts`, from Task 2).
- Produces: `resolveUserColor(players: Players, username: string | null): 'w' | 'b' | null`, consumed by `App.tsx`'s `handleGameLoaded`. `AnalyzeTab` gains an `onFlipBoard: () => void` prop, consumed starting this task and unchanged afterward.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/userColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveUserColor } from './userColor'

const players = { white: 'zlakin', black: 'opponent123' }

describe('resolveUserColor', () => {
  it('returns "w" when the username matches the white player, case-insensitively', () => {
    expect(resolveUserColor(players, 'ZLakin')).toBe('w')
  })

  it('returns "b" when the username matches the black player', () => {
    expect(resolveUserColor(players, 'opponent123')).toBe('b')
  })

  it('returns null when the username matches neither player', () => {
    expect(resolveUserColor(players, 'someone_else')).toBeNull()
  })

  it('returns null when no username is known (no linked account)', () => {
    expect(resolveUserColor(players, null)).toBeNull()
  })

  it('trims surrounding whitespace before comparing', () => {
    expect(resolveUserColor({ white: ' zlakin ', black: 'opponent123' }, 'zlakin')).toBe('w')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run src/renderer/src/lib/userColor.test.ts
```

Expected: FAIL — `userColor.ts` doesn't exist yet (`Cannot find module './userColor'`).

- [ ] **Step 3: Implement `src/renderer/src/lib/userColor.ts`**

```ts
import type { Players } from './players'

// Deliberately returns null rather than defaulting to a color (unlike the
// similar-looking logic in src/main/insights/extractInsightRecord.ts, which
// can safely assume the game belongs to the linked account since it comes
// from that account's own fetched history) - a pasted/uploaded PGN here may
// belong to neither the linked account nor anyone recognizable at all, and
// guessing a color would be worse than the caller's own explicit fallback.
export function resolveUserColor(players: Players, username: string | null): 'w' | 'b' | null {
  if (!username) return null
  const normalized = username.trim().toLowerCase()
  if (players.white.trim().toLowerCase() === normalized) return 'w'
  if (players.black.trim().toLowerCase() === normalized) return 'b'
  return null
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run src/renderer/src/lib/userColor.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 5: Wire orientation detection and a shared flip handler into `App.tsx`**

In `src/renderer/src/App.tsx`, add the import:

```ts
import { resolveUserColor } from './lib/userColor'
```

Replace `handleGameLoaded` (it needs to read `players` right after computing them, and `linkedAccount` from the enclosing closure) with:

```ts
const handleGameLoaded = (pgn: string): void => {
  setPgnError(null)
  try {
    const positions = parsePgn(pgn)
    const newPlayers = {
      white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
      black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
    }
    setPlayers(newPlayers)
    const detectedColor = resolveUserColor(newPlayers, linkedAccount?.username ?? null)
    setBoardOrientation(detectedColor === 'b' ? 'black' : 'white')
    setCurrentPly(0)
    explorer.exitExploration()
    void startAnalysis(positions)
  } catch (err) {
    setPgnError(err instanceof PgnParseError ? err.message : 'Could not parse this PGN')
  }
}
```

This always explicitly sets `boardOrientation` on every load (detected color, or `'white'` when undetected) — it does not preserve whatever a previous game session was flipped to, matching the "default to White + manual toggle" behavior rather than a "remember my last choice" behavior.

Add a shared flip handler, replacing the inline toggle inside the keyboard-shortcut `useEffect`:

```ts
const handleFlipBoard = (): void => {
  setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
}
```

Place it directly above the `useEffect(() => { if (state.moves.length === 0) return ...`, and change the keyboard handler's flip line from:

```ts
else if (e.key === 'f' || e.key === 'F') setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
```

to:

```ts
else if (e.key === 'f' || e.key === 'F') handleFlipBoard()
```

Add `handleFlipBoard` to that `useEffect`'s dependency array (it's stable across renders — defined fresh each render but only reads `setBoardOrientation`, itself stable — so this is a purely mechanical addition, not a behavior change): `}, [currentPly, state.moves.length, handleFlipBoard])`.

Finally, pass the new prop to `AnalyzeTab`:

```tsx
<AnalyzeTab
  ...
  onFlipBoard={handleFlipBoard}
/>
```

- [ ] **Step 6: Add the flip button to `AnalyzeTab.tsx`**

Add `FlipVertical2` to the existing `lucide-react` import:

```ts
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, FlipVertical2 } from 'lucide-react'
```

Add `onFlipBoard: () => void` to `AnalyzeTabProps` and to the destructured props list.

In the `.board-nav` div, add a fifth button after the "Last move" button:

```tsx
<button
  onClick={() => goToPly(state.moves.length)}
  disabled={currentPly === state.moves.length}
  title="Last move (End)"
>
  <ChevronsRight size={18} />
</button>
<button className="board-nav-flip" onClick={onFlipBoard} title="Flip board (F)">
  <FlipVertical2 size={18} />
</button>
```

- [ ] **Step 7: Add flip-button spacing CSS**

In `src/renderer/src/app.css`, directly after the existing `.board-nav button` rule (`app.css:393-399`), add:

```css
.board-nav-flip {
  margin-left: auto;
}
```

`.board-nav` is already `display: flex` (`app.css:388-391`), so `margin-left: auto` pushes just this one button to the row's right edge, visually separating "flip" from the paging controls on the left — matching chess.com's convention of keeping the flip control apart from move navigation, without a new layout.

- [ ] **Step 8: Verify**

```bash
npm run typecheck
npx vitest run
```

Expected: typecheck clean, all tests pass (5 new `userColor.test.ts` cases, same totals otherwise).

- [ ] **Step 9: Verify visually via `run-desktop`**

The linked test account (`zlakin`) auto-loads its own recent games the moment the Chess.com tab opens (`useChessComProfile.ts`'s mount effect fires automatically since `linkedAccount.verifiedAt` is already set in this dev environment's `~/.config/chess-analyzer/settings.json`) — no manual search needed. Each game renders as `<button class="chesscom-game-card">` inside `.chesscom-game-list`, with two `.chesscom-game-player` spans per card (`[0]` = White, `[1]` = Black; `ImportModal.tsx:141-159`). Rather than visually picking a row from a screenshot (fragile — the exact games returned vary run to run), select one deterministically via `eval`, which can find-and-click a DOM element in one step the same way the driver's own `click` command does (`.click()`):

```bash
cat > /tmp/verify-orientation.txt <<'EOF'
launch
click-text Analyze
click-text Chess.com
sleep 1500
eval (() => { const found = Array.from(document.querySelectorAll('.chesscom-game-card')).find((btn) => btn.querySelectorAll('.chesscom-game-player')[1]?.textContent.trim().toLowerCase().startsWith('zlakin')); if (found) { found.click(); return 'clicked a real game' } return 'no black game in the fetched list' })()
sleep 2000
ss oriented-to-black
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-orientation.txt
```

Check the `eval` output. If it printed `'no black game in the fetched list'` (the fetched batch of recent games happened to contain none where `zlakin` played Black), no game was clicked and `oriented-to-black.png` still shows the idle Import screen — fall back to a fixed, always-available PGN via the Paste tab instead:

```bash
cat > /tmp/verify-orientation-fallback.txt <<'EOF'
launch
click-text Analyze
click-text Paste PGN
fill textarea [White "opponent99"] [Black "zlakin"] [WhiteElo "1400"] [BlackElo "1550"] 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *
click-text Load Game
sleep 2000
ss oriented-to-black
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-orientation-fallback.txt
```

(All headers and movetext on one physical line, spaces only, no `\n` — confirmed against a real `chess.js` parse: it's whitespace-tolerant and doesn't require headers on separate lines. The `fill` command's value is everything after the first space in its command-file line, so it can't contain a real line break anyway — this format sidesteps that constraint entirely rather than fighting it.)

(Use whichever of the two actually produced a loaded game for the rest of this step and for Step 10's flip-button check.)

Confirm via the screenshot that the board's dark squares are in the bottom-right corner from the near side, i.e. Black's back rank is nearest the viewer — what `boardOrientation="black"` produces (this task doesn't render `.player-header` yet — Task 4 adds it, so there's no on-screen text label confirming *whose* perspective, only the square-color check).

Then confirm the flip button works, reusing whichever script above successfully loaded a game (repeat its `launch` through the `sleep 2000` after loading, then continue):

```bash
cat > /tmp/verify-flip-button.txt <<'EOF'
launch
click-text Analyze
click-text Chess.com
sleep 1500
eval (() => { const found = Array.from(document.querySelectorAll('.chesscom-game-card')).find((btn) => btn.querySelectorAll('.chesscom-game-player')[1]?.textContent.trim().toLowerCase().startsWith('zlakin')); if (found) found.click() })()
sleep 2000
click .board-nav-flip
sleep 300
ss after-manual-flip
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-flip-button.txt
```

(If the Chess.com list had no Black game for `zlakin` in Step 9, swap this script's `click-text Chess.com` / `eval ...` / `sleep 2000` lines for the Paste-tab fallback lines from above instead.)

Expected: `after-manual-flip.png` shows the board oriented back to White (opposite of the auto-detected orientation) after one click.

- [ ] **Step 10: Clean up and commit**

```bash
rm -f /tmp/verify-orientation.txt /tmp/verify-orientation-2.txt /tmp/verify-flip-button.txt
git add src/renderer/src/lib/userColor.ts src/renderer/src/lib/userColor.test.ts \
  src/renderer/src/App.tsx src/renderer/src/components/AnalyzeTab.tsx src/renderer/src/app.css
git commit -m "Auto-orient the board to the user's color, with a visible flip button"
```

---

### Task 4: Player name and rating headers

**Files:**
- Modify: `src/renderer/src/lib/players.ts`
- Test: `src/renderer/src/lib/players.test.ts`
- Create: `src/renderer/src/components/PlayerHeader.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/AnalyzeTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `boardOrientation` (existing), `players` (extended `Players`, this task).
- Produces: `parsePlayers(pgn: string): Players` (extended shape below), consumed by `App.tsx`'s `handleGameLoaded`, replacing the two inline regex lines. `PlayerHeader` component, consumed only by `AnalyzeTab.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/players.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsePlayers } from './players'

const BASE_PGN = `[Event "Live Chess"]
[White "zlakin"]
[Black "opponent123"]
[WhiteElo "1450"]
[BlackElo "1502"]

1. e4 e5 2. Nf3 Nc6 *`

describe('parsePlayers', () => {
  it('extracts both usernames and both Elo ratings when present', () => {
    expect(parsePlayers(BASE_PGN)).toEqual({
      white: 'zlakin',
      black: 'opponent123',
      whiteElo: '1450',
      blackElo: '1502'
    })
  })

  it('falls back to "White"/"Black" when the name tags are absent', () => {
    const pgn = '1. e4 e5 *'
    expect(parsePlayers(pgn).white).toBe('White')
    expect(parsePlayers(pgn).black).toBe('Black')
  })

  it('returns null Elo values when the Elo tags are absent', () => {
    const pgn = '[White "a"]\n[Black "b"]\n\n1. e4 e5 *'
    expect(parsePlayers(pgn).whiteElo).toBeNull()
    expect(parsePlayers(pgn).blackElo).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run src/renderer/src/lib/players.test.ts
```

Expected: FAIL — `parsePlayers` doesn't exist yet (`players.ts` only exports the `Players` interface so far).

- [ ] **Step 3: Extend `src/renderer/src/lib/players.ts`**

Replace its contents in full:

```ts
export interface Players {
  white: string
  black: string
  whiteElo: string | null
  blackElo: string | null
}

export function parsePlayers(pgn: string): Players {
  return {
    white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
    black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black',
    whiteElo: pgn.match(/\[WhiteElo "(\d+)"\]/)?.[1] ?? null,
    blackElo: pgn.match(/\[BlackElo "(\d+)"\]/)?.[1] ?? null
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run src/renderer/src/lib/players.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Use `parsePlayers` in `App.tsx`, and update the initial state**

Add the import:

```ts
import { parsePlayers } from './lib/players'
```

Change the initial state (currently `useState<Players>({ white: 'White', black: 'Black' })`):

```ts
const [players, setPlayers] = useState<Players>({ white: 'White', black: 'Black', whiteElo: null, blackElo: null })
```

In `handleGameLoaded`, replace:

```ts
const newPlayers = {
  white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
  black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
}
```

with:

```ts
const newPlayers = parsePlayers(pgn)
```

(the rest of `handleGameLoaded` — `setPlayers(newPlayers)`, `resolveUserColor(newPlayers, ...)`, etc. — is unchanged, since `newPlayers` still has `.white`/`.black` alongside the two new fields).

- [ ] **Step 6: Create `src/renderer/src/components/PlayerHeader.tsx`**

```tsx
interface PlayerHeaderProps {
  name: string
  elo: string | null
}

export function PlayerHeader({ name, elo }: PlayerHeaderProps): JSX.Element {
  return (
    <div className="player-header">
      <span className="player-header-name">{name}</span>
      {elo && <span className="player-header-elo">{elo}</span>}
    </div>
  )
}
```

- [ ] **Step 7: Wire two `PlayerHeader`s into `AnalyzeTab.tsx`**

Add the import:

```ts
import { PlayerHeader } from './PlayerHeader'
```

Inside the component, before the `return`, compute which player renders on top vs. bottom (the bottom slot is always whoever the board is oriented toward, matching chess.com's "you're always at the bottom" convention):

```ts
const topPlayer =
  boardOrientation === 'white'
    ? { name: players.black, elo: players.blackElo }
    : { name: players.white, elo: players.whiteElo }
const bottomPlayer =
  boardOrientation === 'white'
    ? { name: players.white, elo: players.whiteElo }
    : { name: players.black, elo: players.blackElo }
```

In the JSX, inside `.board-column`, add a `PlayerHeader` immediately before `<Board`:

```tsx
<div className="board-column">
  <PlayerHeader name={topPlayer.name} elo={topPlayer.elo} />
  <Board
    fen={explorer.currentFen}
    ...
```

and another immediately after `<Board .../>`, before `.board-nav`:

```tsx
  />
  <PlayerHeader name={bottomPlayer.name} elo={bottomPlayer.elo} />
  <div className="board-nav">
```

- [ ] **Step 8: Add player-header CSS**

In `src/renderer/src/app.css`, directly after the `.board-column` rule (`app.css:381-386`), add:

```css
.player-header {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  width: 100%;
  max-width: 480px;
  font-size: 0.85rem;
  color: var(--text);
}

.player-header-name {
  font-weight: 600;
}

.player-header-elo {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-muted);
}
```

- [ ] **Step 9: Verify**

```bash
npm run typecheck
npx vitest run
```

Expected: typecheck clean, all tests pass (3 new `players.test.ts` cases, same totals otherwise).

- [ ] **Step 10: Verify visually via `run-desktop`**

The linked test account (`zlakin`) auto-loads its own recent games the moment the Chess.com tab opens. Select a game where it played Black deterministically via `eval` (each game card is `<button class="chesscom-game-card">` with two `.chesscom-game-player` spans, `[0]` = White, `[1]` = Black — `ImportModal.tsx:141-159`):

```bash
cat > /tmp/verify-player-headers.txt <<'EOF'
launch
click-text Analyze
click-text Chess.com
sleep 1500
eval (() => { const found = Array.from(document.querySelectorAll('.chesscom-game-card')).find((btn) => btn.querySelectorAll('.chesscom-game-player')[1]?.textContent.trim().toLowerCase().startsWith('zlakin')); if (found) { found.click(); return 'clicked a real game' } return 'no black game in the fetched list' })()
sleep 2000
ss player-headers-black-orientation
eval Array.from(document.querySelectorAll('.player-header-name')).map(el => el.textContent)
click .board-nav-flip
sleep 300
ss player-headers-white-orientation
eval Array.from(document.querySelectorAll('.player-header-name')).map(el => el.textContent)
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-player-headers.txt
```

If the `eval` printed `'no black game in the fetched list'`, no game loaded — replace the `click-text Chess.com` / `eval (find + click)` / `sleep 2000` lines above with this fixed fallback instead (a single physical line, spaces only — confirmed against a real `chess.js` parse that headers don't need to be on separate lines, which matters here since the driver's `fill` command can't embed a real line break):

```
click-text Paste PGN
fill textarea [White "opponent99"] [Black "zlakin"] [WhiteElo "1400"] [BlackElo "1550"] 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *
click-text Load Game
```

Expected: two names shown above/below the board in both screenshots, in swapped top/bottom order between the two (`zlakin` at the bottom in the first, at the top in the second, after the manual flip). If the source game has Elo tags (the fallback PGN always does), confirm a rating appears next to each name in the screenshot.

- [ ] **Step 11: Clean up and commit**

```bash
rm -f /tmp/verify-player-headers.txt
git add src/renderer/src/lib/players.ts src/renderer/src/lib/players.test.ts \
  src/renderer/src/components/PlayerHeader.tsx src/renderer/src/App.tsx \
  src/renderer/src/components/AnalyzeTab.tsx src/renderer/src/app.css
git commit -m "Show player name/rating headers beside the board"
```

---

### Task 5: Richer coach text via tactic detection

**Files:**
- Modify: `src/renderer/src/lib/moveDetail.ts`
- Modify: `src/renderer/src/lib/moveDetail.test.ts`

**Interfaces:**
- Consumes: `detectTactics(fenBefore: string, moveUci: string): TacticType[]` (`src/shared/analysis/tacticDetector.ts`, from Task 1); `TACTIC_LABELS: Record<TacticType, string>` (`src/renderer/src/lib/tacticLabels.ts`, existing, unchanged).
- Produces: `formatMoveDetail`'s return shape is unchanged (`string | null`) — this task only enriches its content for `mistake`/`blunder` moves. No consumer changes needed (`MoveDetail.tsx` already just renders whatever string it gets).

- [ ] **Step 1: Write the failing tests**

Add to the end of the `describe('formatMoveDetail', ...)` block in `src/renderer/src/lib/moveDetail.test.ts` (after the existing four `it` blocks, before the closing `})`):

```ts
  it('appends a parenthetical tactic tag when the best move (not the move played) enables one, for a blunder', () => {
    // Same fork fixture as tacticDetector.test.ts: Nd3-e5 forks the queen on
    // c6 and the rook on g6 - Kd2 ignores it entirely.
    const forkFen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    const text = formatMoveDetail(
      makeMove({
        san: 'Kd2',
        moveUci: 'e1d2',
        fenBefore: forkFen,
        classification: 'blunder',
        evalBefore: evalWithLine(50, 'd3e5'),
        evalAfter: evalWithLine(-500, 'e8d8')
      })
    )
    expect(text).toMatch(/^Kd2 — Blunder, -\d+% win chance\. Best was Ne5 \(fork\)\.$/)
  })

  it('omits the tactic tag for an inaccuracy even when the best move would enable one', () => {
    const forkFen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    const text = formatMoveDetail(
      makeMove({
        san: 'Kd2',
        moveUci: 'e1d2',
        fenBefore: forkFen,
        classification: 'inaccuracy',
        evalBefore: evalWithLine(50, 'd3e5'),
        evalAfter: evalWithLine(10, 'e8d8')
      })
    )
    expect(text).not.toContain('(fork)')
    expect(text).toMatch(/Best was Ne5\.$/)
  })

  it('omits the parenthetical when the best move enables no detected tactic, even for a blunder', () => {
    const text = formatMoveDetail(makeMove({ classification: 'blunder' }))
    expect(text).toMatch(/^a3 — Blunder, -\d+% win chance\. Best was Nf3\.$/)
  })
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx vitest run src/renderer/src/lib/moveDetail.test.ts
```

Expected: the first new test FAILs (actual text has no `(fork)` suffix yet — current output is `"Kd2 — Blunder, ...% win chance. Best was Ne5."`); the other two PASS already (they describe today's behavior, kept as regression coverage once tactic-tagging exists).

- [ ] **Step 3: Extend `formatMoveDetail` in `src/renderer/src/lib/moveDetail.ts`**

Add two imports at the top:

```ts
import { detectTactics } from '../../../shared/analysis/tacticDetector'
import { TACTIC_LABELS } from './tacticLabels'
```

Replace the `if (!delta.isBestMove) { ... }` block:

```ts
  if (!delta.isBestMove) {
    const bestUci = move.evalBefore.lines[0]?.moveUci
    const bestSan = bestUci ? sanForUci(move.fenBefore, bestUci) : null
    if (bestSan) text += ` Best was ${bestSan}.`
  }
```

with:

```ts
  if (!delta.isBestMove) {
    const bestUci = move.evalBefore.lines[0]?.moveUci
    const bestSan = bestUci ? sanForUci(move.fenBefore, bestUci) : null
    if (bestSan) {
      const isMistakeOrBlunder = move.classification === 'mistake' || move.classification === 'blunder'
      const tactics = isMistakeOrBlunder && bestUci ? detectTactics(move.fenBefore, bestUci) : []
      const tacticSuffix =
        tactics.length > 0 ? ` (${tactics.map((t) => TACTIC_LABELS[t].toLowerCase()).join(', ')})` : ''
      text += ` Best was ${bestSan}${tacticSuffix}.`
    }
  }
```

`detectTactics` runs against `bestUci` (the engine's top suggestion), not `move.moveUci` (what was actually played) — the point is naming what the missed alternative achieves, not analyzing the move the player made.

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx vitest run src/renderer/src/lib/moveDetail.test.ts
```

Expected: PASS, 9/9 (6 existing + 3 new).

- [ ] **Step 5: Run the full suite**

```bash
npm run typecheck
npx vitest run
```

Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/moveDetail.ts src/renderer/src/lib/moveDetail.test.ts
git commit -m "Name the missed tactic in coach text for mistakes and blunders"
```

---

### Task 6: Restyle the Game Report card

**Files:**
- Modify: `src/renderer/src/components/GameSummary.tsx`
- Modify: `src/renderer/src/components/AnalyzeTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `matchOpeningName(sanHistory: string[]): string | null` (`src/shared/analysis/openingBook.ts`, from Task 1).
- Produces: `GameSummary` gains a required `openingName: string | null` prop. `AnalyzeTab` computes it via `useMemo` and passes it down — no other consumer.

- [ ] **Step 1: Replace `src/renderer/src/components/GameSummary.tsx` in full**

```tsx
import { memo } from 'react'
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface GameSummaryProps {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
  whiteUsername: string
  blackUsername: string
  openingName: string | null
}

const CLASSIFICATIONS_TO_SHOW: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder'
]

function countByClassification(
  moves: AnalyzedMove[],
  color: 'w' | 'b'
): Record<MoveClassification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS_TO_SHOW.map((c) => [c, 0])) as Record<
    MoveClassification,
    number
  >
  for (const move of moves) {
    if (move.color === color && move.classification in counts) {
      counts[move.classification] += 1
    }
  }
  return counts
}

export const GameSummary = memo(function GameSummary({
  moves,
  whiteAccuracy,
  blackAccuracy,
  whiteUsername,
  blackUsername,
  openingName
}: GameSummaryProps): JSX.Element {
  const whiteCounts = countByClassification(moves, 'w')
  const blackCounts = countByClassification(moves, 'b')
  // Only classifications that actually occurred get a row - an 8-row table
  // with mostly zeros is noise, not information, and chess.com's own report
  // only lists what happened in this specific game.
  const rows = CLASSIFICATIONS_TO_SHOW.filter(
    (classification) => whiteCounts[classification] > 0 || blackCounts[classification] > 0
  )

  return (
    <div className="game-summary">
      {openingName && <p className="game-summary-opening">{openingName}</p>}

      <div className="accuracy-scorecards">
        <div className="accuracy-scorecard">
          <span className="accuracy-scorecard-value">{whiteAccuracy.toFixed(1)}%</span>
          <span className="accuracy-scorecard-label">{whiteUsername}</span>
        </div>
        <div className="accuracy-scorecard">
          <span className="accuracy-scorecard-value">{blackAccuracy.toFixed(1)}%</span>
          <span className="accuracy-scorecard-label">{blackUsername}</span>
        </div>
      </div>

      <table className="classification-breakdown">
        <tbody>
          {rows.map((classification) => {
            const style = MOVE_CLASSIFICATION_STYLE[classification]
            const Icon = style.icon
            return (
              <tr key={classification}>
                <td className="classification-breakdown-count">{whiteCounts[classification]}</td>
                <td className="classification-breakdown-label">
                  <Icon size={13} style={{ color: style.color }} />
                  <span>{style.label}</span>
                </td>
                <td className="classification-breakdown-count">{blackCounts[classification]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})
```

This drops the `recharts` (`BarChart`/`Bar`/`XAxis`/`YAxis`/`Tooltip`/`ResponsiveContainer`) import entirely — `recharts` itself stays a project dependency, still used by `EvalGraph.tsx`. It also drops `ALL_CLASSIFICATIONS_FOR_LEGEND` (the separate legend list is replaced by the table, which already carries icon+label per row).

- [ ] **Step 2: Compute and pass `openingName` in `AnalyzeTab.tsx`**

`AnalyzeTab.tsx` has no import from `react` yet (Tasks 2-4 never needed one — it's a pure presentational component so far). Add two new import lines at the top:

```ts
import { useMemo } from 'react'
import { matchOpeningName } from '../../../shared/analysis/openingBook'
```

Inside the component, before the `return`:

```ts
const openingName = useMemo(() => matchOpeningName(state.moves.map((m) => m.san)), [state.moves])
```

In the `GameSummary` usage, add the new prop:

```tsx
<GameSummary
  moves={state.moves}
  whiteAccuracy={state.whiteAccuracy}
  blackAccuracy={state.blackAccuracy}
  whiteUsername={players.white}
  blackUsername={players.black}
  openingName={openingName}
/>
```

- [ ] **Step 3: Update CSS**

In `src/renderer/src/app.css`, modify the existing `.accuracy-scorecard-value` rule (`app.css:941-946`) — change `font-family` and `font-size` to make accuracy the dominant visual element, matching chess.com's oversized accuracy digits:

```css
.accuracy-scorecard-value {
  font-family: var(--font-display);
  font-size: 1.9rem;
  font-weight: 600;
  color: var(--text);
}
```

Remove the now-unused `.classification-legend`/`.classification-legend-item` rules (`app.css:953-968`) — the component no longer renders that markup.

In their place, add:

```css
.game-summary-opening {
  margin: 0 0 0.75rem;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--text);
}

.classification-breakdown {
  width: 100%;
  margin-top: 0.75rem;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.classification-breakdown-count {
  width: 2rem;
  text-align: center;
  font-family: var(--font-mono);
  color: var(--text-muted);
  padding: 0.2rem 0;
}

.classification-breakdown-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx vitest run
npm run build
```

Expected: typecheck clean, all tests pass, build clean.

- [ ] **Step 5: Verify visually via `run-desktop`**

The report card doesn't depend on which color was played, so any real game works — click the first one the linked test account's auto-loaded Chess.com list offers:

```bash
cat > /tmp/verify-report-card.txt <<'EOF'
launch
click-text Analyze
click-text Chess.com
sleep 1500
eval document.querySelector('.chesscom-game-card')?.click()
wait .game-summary 90000
ss report-card-done
eval document.querySelector('.game-summary-opening')?.textContent
eval Array.from(document.querySelectorAll('.classification-breakdown-count')).map(el => el.textContent)
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-report-card.txt
```

If `.chesscom-game-card` doesn't exist (the account has no games returned at all — unlikely but possible), replace the `click-text Chess.com` / `eval (click first card)` lines with the same fixed fallback PGN as Task 3/4 (`click-text Paste PGN` then `fill textarea [White "opponent99"] [Black "zlakin"] [WhiteElo "1400"] [BlackElo "1550"] 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *` then `click-text Load Game`). `wait .game-summary 90000` gives the full game up to 90s to finish analyzing at the app's default depth before checking — `.game-summary` only renders once `state.status === 'done'`.

Expected: `report-card-done.png` shows an opening name (if the game's early moves matched a known book line — some games won't, and that's fine, the line simply won't appear), two large accuracy percentages, and a breakdown table with white/black counts per classification that actually occurred — no chart, no separate legend below it.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f /tmp/verify-report-card.txt
git add src/renderer/src/components/GameSummary.tsx src/renderer/src/components/AnalyzeTab.tsx src/renderer/src/app.css
git commit -m "Restyle the Game Report card: opening name, bigger accuracy, classification table"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

**Interfaces:** none — this task confirms Tasks 1-6 work together as a whole.

- [ ] **Step 1: Full verify**

```bash
npm run verify
```

Expected: typecheck clean, full test suite passes (baseline + `userColor.test.ts`'s 5 + `players.test.ts`'s 3 + `moveDetail.test.ts`'s 3 new = baseline + 11).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: End-to-end live verification via `run-desktop`**

Rebuild first if any change happened since the last `npm run build` in this session. Then drive one full session covering every piece of this plan together, using a real `zlakin`-as-Black game from the Chess.com import tab, selected the same deterministic way as Tasks 3/4/6 (each game card is `<button class="chesscom-game-card">` with two `.chesscom-game-player` spans, `[0]` = White, `[1]` = Black):

```bash
cat > /tmp/verify-full-analyze-tab.txt <<'EOF'
launch
click-text Analyze
click-text Chess.com
sleep 1500
eval (() => { const found = Array.from(document.querySelectorAll('.chesscom-game-card')).find((btn) => btn.querySelectorAll('.chesscom-game-player')[1]?.textContent.trim().toLowerCase().startsWith('zlakin')); if (found) { found.click(); return 'clicked a real game' } return 'no black game in the fetched list' })()
sleep 2000
ss full-01-oriented-to-black
eval Array.from(document.querySelectorAll('.player-header-name')).map(el => el.textContent)
press ArrowRight
press ArrowRight
press ArrowRight
sleep 500
ss full-02-mid-game-coach-text
wait .game-summary 90000
ss full-03-report-card
eval document.querySelector('.game-summary-opening')?.textContent
eval Array.from(document.querySelectorAll('.classification-breakdown-count')).map(el => el.textContent)
click .board-nav-flip
sleep 300
ss full-04-manually-flipped
eval Array.from(document.querySelectorAll('.player-header-name')).map(el => el.textContent)
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/verify-full-analyze-tab.txt
```

If the first `eval` printed `'no black game in the fetched list'`, replace the `click-text Chess.com` / `eval (find + click)` / `sleep 2000` lines with the same fixed fallback PGN used in Tasks 3/4/6: `click-text Paste PGN`, then `fill textarea [White "opponent99"] [Black "zlakin"] [WhiteElo "1400"] [BlackElo "1550"] 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *`, then `click-text Load Game`. `press <key>` is the driver's actual keyboard-input command (per `.claude/skills/run-desktop/SKILL.md`'s command table) — three `ArrowRight` presses step into the game so `full-02` has a real move selected. `wait .game-summary 90000` (unconditional — no need to navigate to any particular ply first, `.game-summary` renders as soon as `state.status === 'done'`) gives the full game up to 90s to finish analyzing at the app's default depth.

Read every screenshot before claiming success:
- `full-01`: board oriented to Black (zlakin's back rank nearest the viewer), player headers showing both names (and ratings, if the source game has Elo tags) with zlakin at the bottom.
- `full-02`: if the selected move's classification is `mistake` or `blunder` and the best alternative enables a tactic, the `.move-detail` text includes a parenthetical tag like `(fork)`; otherwise just the base sentence — either is correct, this only confirms nothing crashed and text renders sensibly. Click through a few different moves with the move list (`click-text` on a SAN entry, or step further with more `press ArrowRight`) if the first few don't happen to include a mistake/blunder, to actually see the tactic tag at least once.
- `full-03`: opening name (if applicable), large accuracy numbers, classification breakdown table with real counts.
- `full-04`: player headers swapped top/bottom versus `full-01`, board back to White's perspective.

If any screenshot doesn't match what's expected, stop and report — do not proceed to Step 4 with a failing visual state.

- [ ] **Step 4: Clean up**

```bash
rm -f /tmp/verify-full-analyze-tab.txt
```

No commit for this task — it's verification only, nothing changed.

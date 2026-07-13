# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Chess Analyzer a persistent nav shell (Analyze / Insights tabs) and a polished, chess.com-inspired dark visual system, without touching any analysis logic or IPC.

**Architecture:** A new `NavBar` component renders the app title and tab switcher; `App.tsx` gains `activeTab` state and renders today's existing analyze flow inside an "Analyze" tab, plus a new (currently empty-state) `InsightsTab` component. All visual changes (color, elevation, radius, typography, classification icons, fluid grid) live entirely in `app.css`.

**Tech Stack:** React, TypeScript, plain CSS (no new styling library).

## Global Constraints

- No changes to analysis logic, IPC, or any `shared`/`main` code — this plan touches only `src/renderer/`.
- Dark theme only — no light mode / theme toggle (per spec).
- No settings affordance in the nav shell (per the packaging/settings spec's minimal-persistence decision — there is nothing for a gear icon to open).
- No new npm dependency — styling is hand-written CSS, no UI kit.
- This repo has no test coverage for React components (`Board.tsx`, `EvalBar.tsx`, `MoveList.tsx`, `ImportModal.tsx`, `App.tsx` are all untested directly today) — this plan follows that convention and verifies visually via the `run-desktop` skill instead of adding component tests.

---

### Task 1: Persistent nav shell (Analyze / Insights tabs)

**Files:**
- Create: `src/renderer/src/components/NavBar.tsx`
- Create: `src/renderer/src/components/InsightsTab.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `<NavBar activeTab: 'analyze' | 'insights', onSelectTab: (tab: 'analyze' | 'insights') => void />`, `<InsightsTab />` (no props — Plan 3 will extend it with real content and props later).

- [ ] **Step 1: Create the NavBar component**

Create `src/renderer/src/components/NavBar.tsx`:

```tsx
export type AppTab = 'analyze' | 'insights'

interface NavBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
}

export function NavBar({ activeTab, onSelectTab }: NavBarProps): JSX.Element {
  return (
    <header className="nav-bar">
      <span className="nav-brand">Chess Analyzer</span>
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'analyze' ? 'active' : ''}`}
          onClick={() => onSelectTab('analyze')}
        >
          Analyze
        </button>
        <button
          className={`nav-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => onSelectTab('insights')}
        >
          Insights
        </button>
      </nav>
    </header>
  )
}
```

- [ ] **Step 2: Create the Insights tab empty state**

Create `src/renderer/src/components/InsightsTab.tsx`:

```tsx
export function InsightsTab(): JSX.Element {
  return (
    <div className="insights-tab insights-empty">
      <p className="insights-empty-message">Scan your games to see patterns in your play.</p>
      <button className="insights-scan-button" disabled title="Coming soon">
        Scan my games
      </button>
    </div>
  )
}
```

The button is disabled here on purpose — wiring up a real scan is out of scope for this plan (it belongs to the separate game-insights-engine plan), this task only reserves the tab and its empty state per the UI-redesign spec.

- [ ] **Step 3: Restructure App.tsx around the nav shell**

Replace the entire contents of `src/renderer/src/App.tsx` with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { NavBar } from './components/NavBar'
import type { AppTab } from './components/NavBar'
import { InsightsTab } from './components/InsightsTab'
import { ImportModal } from './components/ImportModal'
import { Board } from './components/Board'
import { EvalBar } from './components/EvalBar'
import { MoveList } from './components/MoveList'
import { EvalGraph } from './components/EvalGraph'
import { GameSummary } from './components/GameSummary'
import { useGameAnalysis } from './hooks/useGameAnalysis'
import { parsePgn, PgnParseError } from './lib/pgn'
import { getPositionAtPly } from './lib/gameNavigation'
import { formatScore, whiteWinPercent } from './lib/displayEval'

interface Players {
  white: string
  black: string
}

function App(): JSX.Element {
  const { state, startAnalysis, cancelAnalysis, reset } = useGameAnalysis()
  const [currentPly, setCurrentPly] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Players>({ white: 'White', black: 'Black' })
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')

  const handleGameLoaded = (pgn: string): void => {
    setPgnError(null)
    try {
      const positions = parsePgn(pgn)
      setPlayers({
        white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
        black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
      })
      setCurrentPly(0)
      void startAnalysis(positions)
    } catch (err) {
      setPgnError(err instanceof PgnParseError ? err.message : 'Could not parse this PGN')
    }
  }

  const position = useMemo(() => getPositionAtPly(state.moves, currentPly), [state.moves, currentPly])

  const handleNewGame = (): void => {
    reset()
    setCurrentPly(0)
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
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPly, state.moves.length])

  return (
    <div className="app">
      <NavBar activeTab={activeTab} onSelectTab={setActiveTab} />
      <main className="app-content">
        {activeTab === 'analyze' && (
          <>
            {state.status !== 'idle' && (
              <div className="analyze-tab-toolbar">
                <button onClick={handleNewGame}>New Game</button>
              </div>
            )}

            {state.status === 'idle' && <ImportModal onGameLoaded={handleGameLoaded} />}
            {pgnError && <div className="import-error">{pgnError}</div>}

            {state.status === 'analyzing' && (
              <div className="analysis-progress">
                <span>
                  Analyzing... {state.moves.length} / {state.positions.length} moves
                </span>
                <progress value={state.moves.length} max={state.positions.length} />
                <button onClick={cancelAnalysis}>Cancel</button>
              </div>
            )}

            {state.status === 'error' && <div className="import-error">{state.error}</div>}
            {state.status === 'cancelled' && <div className="import-error">Analysis cancelled.</div>}

            {(state.status === 'analyzing' || state.status === 'done') && state.moves.length > 0 && (
              <div className="analysis-layout">
                <EvalBar
                  whiteWinPercent={
                    position.evaluation ? whiteWinPercent(position.evaluation, position.sideToMove) : 50
                  }
                  displayScore={
                    position.evaluation ? formatScore(position.evaluation, position.sideToMove) : '0.00'
                  }
                />
                <div className="board-column">
                  <Board fen={position.fen} bestMoveUci={position.bestMoveUci} />
                  <div className="board-nav">
                    <button onClick={() => goToPly(0)} disabled={currentPly === 0} title="First move (Home)">
                      ⏮
                    </button>
                    <button
                      onClick={() => goToPly(currentPly - 1)}
                      disabled={currentPly === 0}
                      title="Previous move (←)"
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => goToPly(currentPly + 1)}
                      disabled={currentPly === state.moves.length}
                      title="Next move (→)"
                    >
                      ▶
                    </button>
                    <button
                      onClick={() => goToPly(state.moves.length)}
                      disabled={currentPly === state.moves.length}
                      title="Last move (End)"
                    >
                      ⏭
                    </button>
                  </div>
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
        )}

        {activeTab === 'insights' && <InsightsTab />}
      </main>
    </div>
  )
}

export default App
```

The only functional changes from the previous `App.tsx` are: the `<header>` with `<h1>` is replaced by `<NavBar>` (the brand name now lives there instead), all analyze-flow JSX is now conditional on `activeTab === 'analyze'` instead of always rendering, and there's a new `activeTab === 'insights'` branch. Every handler, hook call, and the analyze flow's own JSX is otherwise unchanged.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Build and verify both tabs render**

Run: `npm run build`
Expected: writes `out/main`, `out/preload`, `out/renderer` with no errors.

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-navshell.txt`:

```
launch
ss nav-shell-analyze-empty
click-text Insights
ss nav-shell-insights-empty
click-text Analyze
ss nav-shell-back-to-analyze
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-navshell.txt`
Expected: `nav-shell-analyze-empty.png` shows the top bar ("Chess Analyzer" + Analyze/Insights tabs, Analyze active) with the import panel below it; `nav-shell-insights-empty.png` shows the same top bar with Insights active and the "Scan your games..." empty-state message; `nav-shell-back-to-analyze.png` shows the import panel again.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/NavBar.tsx src/renderer/src/components/InsightsTab.tsx src/renderer/src/App.tsx
git commit -m "Add persistent nav shell with Analyze/Insights tabs"
```

---

### Task 2: Visual system overhaul

**Files:**
- Modify: `src/renderer/src/app.css`

**Interfaces:** none — pure styling, no exported symbols. Relies on the class names already used by `NavBar.tsx` and `InsightsTab.tsx` from Task 1 (`nav-bar`, `nav-brand`, `nav-tabs`, `nav-tab`, `insights-tab`, `insights-empty`, `insights-empty-message`, `insights-scan-button`) and by the existing components (`import-modal`, `move-list`, `.move.<classification>`, `eval-bar`, `game-summary`, `classification-table`, etc.).

- [ ] **Step 1: Replace app.css**

Replace the entire contents of `src/renderer/src/app.css` with:

```css
:root {
  color-scheme: dark;
  --bg: #17181a;
  --panel: #202226;
  --panel-elevated: #262932;
  --border: #34373f;
  --text: #ececec;
  --text-muted: #9a9ea8;
  --accent: #7fa650;
  --radius: 12px;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

button {
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--text);
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 0.6);
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

input,
textarea {
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 0.5);
  padding: 0.45rem 0.6rem;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.5rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.nav-brand {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.nav-tabs {
  display: flex;
  gap: 0.4rem;
}

.nav-tab {
  background: transparent;
  border: 1px solid transparent;
}

.nav-tab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #10130b;
  font-weight: 600;
}

.app-content {
  flex: 1;
  padding: 1.25rem 1.5rem 2rem;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.analyze-tab-toolbar {
  display: flex;
  justify-content: flex-end;
}

.import-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.25rem;
}

.import-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.import-tabs button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #10130b;
  font-weight: 600;
}

.import-error {
  background: #3a1c1c;
  border: 1px solid #a33;
  border-radius: calc(var(--radius) * 0.6);
  padding: 0.6rem 0.85rem;
  margin-bottom: 0.5rem;
}

.import-panel textarea {
  width: 100%;
}

.chesscom-search {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.chesscom-search input {
  flex: 1;
}

.chesscom-game-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.chesscom-game-list button {
  width: 100%;
  text-align: left;
}

.analysis-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.analysis-layout {
  display: grid;
  grid-template-columns: minmax(32px, 44px) minmax(280px, 1fr) minmax(280px, 380px);
  gap: 1.25rem;
  align-items: start;
  justify-content: center;
}

.eval-bar {
  position: relative;
  width: 100%;
  height: 480px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) * 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.eval-bar-black {
  background: #121316;
}

.eval-bar-white {
  background: #ececec;
}

.eval-bar-score {
  position: absolute;
  bottom: 4px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: #000;
  mix-blend-mode: difference;
  filter: invert(1);
}

.board-container {
  width: 100%;
  max-width: 480px;
}

.board-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.board-nav {
  display: flex;
  gap: 0.5rem;
}

.board-nav button {
  min-width: 2.75rem;
  padding: 0.35rem 0.6rem;
  font-size: 1.1rem;
  line-height: 1;
}

.side-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.move-list,
.eval-graph,
.game-summary,
.insights-tab {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.move-list {
  list-style: none;
  padding: 0.4rem 0;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.move-list::-webkit-scrollbar {
  width: 8px;
}

.move-list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.move-list::-webkit-scrollbar-track {
  background: transparent;
}

.move-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.15rem 0.5rem;
}

.move-number {
  width: 2rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.move {
  background: none;
  border: none;
  color: var(--text);
  padding: 0.15rem 0.4rem;
  border-radius: calc(var(--radius) * 0.4);
  cursor: pointer;
}

.move.selected {
  outline: 2px solid var(--accent);
}

.move.brilliant,
.move.great {
  color: #17a2b8;
}
.move.best,
.move.excellent,
.move.good,
.move.book {
  color: #8fce6a;
}
.move.inaccuracy {
  color: #e6c229;
}
.move.mistake {
  color: #e08a2c;
}
.move.blunder {
  color: #e14c4c;
}

.move.brilliant::after {
  content: ' !!';
}
.move.great::after {
  content: ' !';
}
.move.inaccuracy::after {
  content: ' ?!';
}
.move.mistake::after {
  content: ' ?';
}
.move.blunder::after {
  content: ' ??';
}

.eval-graph {
  padding: 0.6rem 0.6rem 0.2rem;
}

.game-summary {
  padding: 0.9rem 1rem;
}

.accuracy-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
  font-size: 1.05rem;
}

.classification-table {
  width: 100%;
  border-collapse: collapse;
}

.classification-table th,
.classification-table td {
  border-bottom: 1px solid var(--border);
  padding: 0.3rem 0.5rem;
  text-align: left;
}

.classification-table th {
  color: var(--text-muted);
  font-weight: 500;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

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

Notable changes from the previous stylesheet: a real elevation system (`--shadow` applied to every panel), a chess.com-style green accent (`--accent: #7fa650`) replacing the old blue, a consistent 12px radius scale (`--radius` and fractions of it) replacing the old ad-hoc 4-8px mix, a base `button`/`input`/`textarea` style (previously entirely unstyled native elements), a fluid `.analysis-layout` grid (`minmax()` columns instead of fixed pixel widths), and classification-badge icon suffixes (`::after` content) using the standard chess annotation symbols (`!!` brilliant, `!` great, `?!` inaccuracy, `?` mistake, `??` blunder) alongside the existing color coding.

- [ ] **Step 2: Build and visually verify**

Run: `npm run build`
Expected: no errors (this is a CSS-only change, but rebuild is required for the driver, which launches `out/`).

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-visuals.txt`:

```
launch
fill textarea 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0
click-text Load Game
wait .game-summary 30000
ss visual-overhaul-analysis
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-visuals.txt`
Expected: `visual-overhaul-analysis.png` shows the analysis view with the new green accent on the active nav tab, shadowed/rounded panels, and the move list showing move 3 (`Nf6`) colored red with a trailing `??` (it's the losing blunder that allows immediate checkmate) and other moves colored per their classification with their respective suffix.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Overhaul visual system: elevation, accent color, radius scale, classification icons"
```

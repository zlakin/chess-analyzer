# UI Polish & Move Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the renderer's visual identity ("Walnut & Ivory": warm dark palette, brass accent, Fraunces/Manrope/IBM Plex Mono typography) and make move classification legible everywhere — move list icons, an on-board badge, a plain-language move-detail readout, and a redesigned game summary — per `docs/superpowers/specs/2026-07-17-ui-polish-and-move-classification-design.md`.

**Architecture:** Pure rendering-layer change over `src/renderer/src/**`. A new shared `moveClassificationStyle.ts` map (icon + color + label per `MoveClassification`) becomes the single source of truth consumed by the move list, the board badge, and the game summary. `app.css` gets a full design-token migration in one early task so every later task builds on a stable palette. No changes to `src/main/**` or `src/shared/types.ts`.

**Tech Stack:** React 19, TypeScript, Vite/electron-vite, Vitest, `recharts` (existing), `react-chessboard` v5 (existing — using its `squareRenderer` prop), new: `lucide-react`, `@fontsource/manrope`, `@fontsource/fraunces`, `@fontsource/ibm-plex-mono`.

## Global Constraints

- No changes to `src/main/**` (analysis logic, IPC surface) or classification thresholds — presentation only.
- Dark theme only — no light mode / theme toggle.
- Self-hosted fonts only (`@fontsource/*`) — no CDN/network font loading (Electron offline-safety).
- No new charting library — reuse `recharts` (already a dependency).
- No CSS framework migration — stay with the existing single `src/renderer/src/app.css` + custom-properties approach.
- Existing Vitest tests must keep passing (`npm test`); `npm run typecheck` must pass after every task.
- Commits go straight to `main` in this repo — no branches/worktrees/PRs.
- Every classification-aware component (`MoveList`, `Board`, `GameSummary`) must read icon/color/label from the single shared `MOVE_CLASSIFICATION_STYLE` map (`src/renderer/src/lib/moveClassificationStyle.ts`) — never re-derive or duplicate it.

---

### Task 1: Dependencies and font setup

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `src/renderer/src/main.tsx`

**Interfaces:**
- Produces: `lucide-react` icon components importable throughout `src/renderer/src/**`; three `@fontsource` CSS packages loaded globally, making `'Manrope'`, `'Fraunces'`, `'IBM Plex Mono'` available as font-family names to any CSS written in later tasks.

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
npm install lucide-react @fontsource/manrope @fontsource/fraunces @fontsource/ibm-plex-mono
```
Expected: `package.json` gains four entries under `dependencies`; `package-lock.json` updates; no install errors.

- [ ] **Step 2: Verify the lucide-react icon names this plan relies on actually exist**

Run:
```bash
node --input-type=module -e "
import * as icons from 'lucide-react'
const names = ['Sparkles','Star','CircleCheck','Check','BookOpen','TriangleAlert','CircleAlert','CircleX','Loader2','ChevronsLeft','ChevronLeft','ChevronRight','ChevronsRight','Lightbulb']
for (const n of names) console.log(n, typeof icons[n] === 'function' ? 'OK' : 'MISSING')
"
```
Expected: every line ends in `OK`. If any line says `MISSING`, find the current export name with:
```bash
node --input-type=module -e "import * as icons from 'lucide-react'; console.log(Object.keys(icons).filter(k => /alert|check|circle|star|sparkle|book|chevron|loader|light/i.test(k)).join('\n'))"
```
and substitute the correct name in every later task that references it (Tasks 3, 8, 9, 12).

- [ ] **Step 3: Load the fonts globally**

Edit `src/renderer/src/main.tsx`:

```tsx
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './app.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 4: Verify the build still typechecks and tests pass**

Run: `npm run verify`
Expected: `tsc -b` and `vitest run` both succeed (no test depends on fonts or icons yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx
git commit -m "Add lucide-react and self-hosted UI fonts"
```

---

### Task 2: Design token migration in app.css

**Files:**
- Modify: `src/renderer/src/app.css` (entire file — every rule referencing the old `--radius`/`--shadow` tokens or hardcoded brand-adjacent hex colors)

**Interfaces:**
- Consumes: font families loaded in Task 1 (`var(--font-ui)` etc. only render correctly once those `.css` imports are present, which they are after Task 1).
- Produces: new tokens available to every later task: `--bg`, `--panel`, `--panel-elevated`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`, `--accent-contrast`, `--radius-panel`, `--radius-control`, `--shadow-modal`, `--eval-black`, `--mq-brilliant`, `--mq-great`, `--mq-best`, `--mq-excellent`, `--mq-good`, `--mq-book`, `--mq-inaccuracy`, `--mq-mistake`, `--mq-blunder`, `--font-ui`, `--font-display`, `--font-mono`. Also produces reusable `.button-primary` / `.button-secondary` classes (consumed by Tasks 10, 11, 12).

This task has no new testable logic — it's a full replacement of `src/renderer/src/app.css`. Verification is visual (Step 3) plus the existing test/typecheck suite (nothing in it depends on CSS).

- [ ] **Step 1: Replace the entire contents of `src/renderer/src/app.css`**

```css
:root {
  color-scheme: dark;
  --bg: #191512;
  --panel: #221d18;
  --panel-elevated: #2b241d;
  --border: #3a312a;
  --border-strong: #4a3f35;
  --text: #f1e9dd;
  --text-muted: #a69a88;
  --text-faint: #7a6f60;
  --accent: #c98a3e;
  --accent-hover: #dda255;
  --accent-contrast: #1a1410;
  --radius-panel: 10px;
  --radius-control: 7px;
  --shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.45);
  --eval-black: #15110d;

  --mq-brilliant: #22d3ee;
  --mq-great: #2dd4bf;
  --mq-best: #4ade80;
  --mq-excellent: #86d99a;
  --mq-good: #9fb08c;
  --mq-book: #a8a29e;
  --mq-inaccuracy: #fbbf24;
  --mq-mistake: #fb923c;
  --mq-blunder: #f0554a;

  --font-ui: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Fraunces', Georgia, serif;
  --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
}

button {
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--text);
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.45rem 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

.button-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.button-primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.button-secondary {
  background: transparent;
}

input,
textarea {
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.45rem 0.6rem;
}

input:focus,
textarea:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
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
  box-shadow: var(--shadow-modal);
  position: sticky;
  top: 0;
  z-index: 10;
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
  color: var(--accent-contrast);
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
  border-radius: var(--radius-panel);
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
  color: var(--accent-contrast);
  font-weight: 600;
}

.import-error {
  background: color-mix(in srgb, var(--mq-blunder) 18%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--mq-blunder) 55%, var(--border));
  border-radius: var(--radius-control);
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
  border-radius: var(--radius-control);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.eval-bar-black {
  background: var(--eval-black);
}

.eval-bar-white {
  background: var(--text);
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
  border-radius: var(--radius-panel);
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
  border-radius: var(--radius-control);
  cursor: pointer;
}

.move.selected {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}

.move.brilliant {
  color: var(--mq-brilliant);
}
.move.great {
  color: var(--mq-great);
}
.move.best {
  color: var(--mq-best);
}
.move.excellent {
  color: var(--mq-excellent);
}
.move.good {
  color: var(--mq-good);
}
.move.book {
  color: var(--mq-book);
}
.move.inaccuracy {
  color: var(--mq-inaccuracy);
}
.move.mistake {
  color: var(--mq-mistake);
}
.move.blunder {
  color: var(--mq-blunder);
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
  border-radius: var(--radius-panel);
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

.account-chip {
  background: transparent;
  border: 1px solid var(--border);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.connect-account-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-modal);
  padding: 1.25rem;
  width: 100%;
  max-width: 420px;
}

.modal-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.verification-code {
  display: block;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.5rem 0.75rem;
  margin: 0.5rem 0;
  font-size: 1rem;
  letter-spacing: 0.03em;
  text-align: center;
}
```

- [ ] **Step 2: Verify typecheck/tests still pass (no CSS-affecting test exists, this just confirms nothing else broke)**

Run: `npm run verify`
Expected: passes.

- [ ] **Step 3: Visual check**

Use the `run-desktop` skill to launch the app and screenshot the import screen. Expected: warm near-black background, ivory text, brass-colored active nav tab and buttons — no layout breakage (this step only changed colors/radii, not markup).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Migrate app.css to the Walnut & Ivory design tokens"
```

---

### Task 3: Shared move-classification style map

**Files:**
- Create: `src/renderer/src/lib/moveClassificationStyle.ts`
- Test: `src/renderer/src/lib/moveClassificationStyle.test.ts`

**Interfaces:**
- Consumes: `MoveClassification` from `../../../shared/types`; icon components from `lucide-react` (verified present in Task 1 Step 2).
- Produces: `MOVE_CLASSIFICATION_STYLE: Record<MoveClassification, { label: string; icon: LucideIcon; color: string }>`, and the `MoveClassificationStyle` interface — consumed by Tasks 4 (`MoveList`), 5 (`moveDetail.ts`), 6 (`Board`), 7 (`GameSummary`).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/moveClassificationStyle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MOVE_CLASSIFICATION_STYLE } from './moveClassificationStyle'
import type { MoveClassification } from '../../../shared/types'

const ALL_CLASSIFICATIONS: MoveClassification[] = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder'
]

describe('MOVE_CLASSIFICATION_STYLE', () => {
  it('defines a label, icon, and color for every move classification', () => {
    for (const classification of ALL_CLASSIFICATIONS) {
      const style = MOVE_CLASSIFICATION_STYLE[classification]
      expect(style, `missing style for "${classification}"`).toBeDefined()
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.icon).toBeDefined()
      expect(style.color).toMatch(/^var\(--mq-[a-z]+\)$/)
    }
  })

  it('gives every classification a distinct color', () => {
    const colors = ALL_CLASSIFICATIONS.map((c) => MOVE_CLASSIFICATION_STYLE[c].color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/moveClassificationStyle.test.ts`
Expected: FAIL — `Cannot find module './moveClassificationStyle'`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/moveClassificationStyle.ts`:

```ts
import {
  Sparkles,
  Star,
  CircleCheck,
  Check,
  BookOpen,
  TriangleAlert,
  CircleAlert,
  CircleX,
  type LucideIcon
} from 'lucide-react'
import type { MoveClassification } from '../../../shared/types'

export interface MoveClassificationStyle {
  label: string
  icon: LucideIcon
  color: string
}

export const MOVE_CLASSIFICATION_STYLE: Record<MoveClassification, MoveClassificationStyle> = {
  book: { label: 'Book', icon: BookOpen, color: 'var(--mq-book)' },
  brilliant: { label: 'Brilliant', icon: Sparkles, color: 'var(--mq-brilliant)' },
  great: { label: 'Great', icon: Star, color: 'var(--mq-great)' },
  best: { label: 'Best', icon: CircleCheck, color: 'var(--mq-best)' },
  excellent: { label: 'Excellent', icon: Check, color: 'var(--mq-excellent)' },
  good: { label: 'Good', icon: Check, color: 'var(--mq-good)' },
  inaccuracy: { label: 'Inaccuracy', icon: TriangleAlert, color: 'var(--mq-inaccuracy)' },
  mistake: { label: 'Mistake', icon: CircleAlert, color: 'var(--mq-mistake)' },
  blunder: { label: 'Blunder', icon: CircleX, color: 'var(--mq-blunder)' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/moveClassificationStyle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/moveClassificationStyle.ts src/renderer/src/lib/moveClassificationStyle.test.ts
git commit -m "Add shared move-classification icon/color/label map"
```

---

### Task 4: Move list icons and badges

**Files:**
- Modify: `src/renderer/src/components/MoveList.tsx`
- Modify: `src/renderer/src/app.css` (append)

**Interfaces:**
- Consumes: `MOVE_CLASSIFICATION_STYLE` (Task 3).

- [ ] **Step 1: Rewrite `MoveList.tsx`**

```tsx
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface MoveListProps {
  moves: AnalyzedMove[]
  currentPly: number
  onSelectPly: (ply: number) => void
}

interface MoveRow {
  moveNumber: number
  white?: AnalyzedMove
  black?: AnalyzedMove
}

function MoveButton({
  move,
  isSelected,
  onSelect
}: {
  move: AnalyzedMove
  isSelected: boolean
  onSelect: () => void
}): JSX.Element {
  const style = MOVE_CLASSIFICATION_STYLE[move.classification]
  const Icon = style.icon
  return (
    <button
      className={`move ${move.classification}${isSelected ? ' selected' : ''}`}
      onClick={onSelect}
      title={style.label}
    >
      <Icon size={12} className="move-icon" style={{ color: style.color }} />
      <span className="move-san" style={{ color: style.color }}>
        {move.san}
      </span>
    </button>
  )
}

export function MoveList({ moves, currentPly, onSelectPly }: MoveListProps): JSX.Element {
  const rows: MoveRow[] = []
  for (const move of moves) {
    const row = rows[move.moveNumber - 1] ?? { moveNumber: move.moveNumber }
    if (move.color === 'w') row.white = move
    else row.black = move
    rows[move.moveNumber - 1] = row
  }

  return (
    <ol className="move-list">
      {rows.map((row) => (
        <li key={row.moveNumber} className="move-row">
          <span className="move-number">{row.moveNumber}.</span>
          {row.white && (
            <MoveButton
              move={row.white}
              isSelected={row.white.ply === currentPly}
              onSelect={() => onSelectPly(row.white!.ply)}
            />
          )}
          {row.black && (
            <MoveButton
              move={row.black}
              isSelected={row.black.ply === currentPly}
              onSelect={() => onSelectPly(row.black!.ply)}
            />
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 2: Remove the now-redundant per-classification color rules and add layout rules**

In `src/renderer/src/app.css`, delete these nine rules added in Task 2 (color now comes from the inline `style` prop, not CSS classes — the classes are kept only for the `::after` NAG-suffix rules below them, which stay):

```css
.move.brilliant {
  color: var(--mq-brilliant);
}
.move.great {
  color: var(--mq-great);
}
.move.best {
  color: var(--mq-best);
}
.move.excellent {
  color: var(--mq-excellent);
}
.move.good {
  color: var(--mq-good);
}
.move.book {
  color: var(--mq-book);
}
.move.inaccuracy {
  color: var(--mq-inaccuracy);
}
.move.mistake {
  color: var(--mq-mistake);
}
.move.blunder {
  color: var(--mq-blunder);
}
```

Replace the `.move` and `.move.selected` rules with:

```css
.move {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  color: var(--text);
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-control);
  cursor: pointer;
}

.move-icon {
  flex-shrink: 0;
}

.move.selected {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

Use `run-desktop` to load an analyzed game and screenshot the move list. Expected: each move shows a small colored icon before the SAN, the NAG suffix (`!!`/`!`/`?!`/`?`/`??`) still appears where applicable, and the currently selected move has a brass-tinted background.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MoveList.tsx src/renderer/src/app.css
git commit -m "Add classification icons to the move list"
```

---

### Task 5: Move-detail readout

**Files:**
- Modify: `src/renderer/src/lib/gameNavigation.ts`
- Test: `src/renderer/src/lib/gameNavigation.test.ts` (new)
- Create: `src/renderer/src/lib/moveDetail.ts`
- Test: `src/renderer/src/lib/moveDetail.test.ts`
- Create: `src/renderer/src/components/MoveDetail.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app.css` (append)

**Interfaces:**
- Consumes: `MOVE_CLASSIFICATION_STYLE` (Task 3); `computeMoveEvalDelta`, `cpToWinPercent` from `src/shared/engineMath.ts` (existing, unmodified).
- Produces: `getMoveAtPly(moves: AnalyzedMove[], ply: number): AnalyzedMove | null` in `gameNavigation.ts` — consumed by Task 6 (`Board`'s badge) via the same `currentMove` variable this task creates in `App.tsx`. `formatMoveDetail(move: AnalyzedMove | null): string | null` in `moveDetail.ts`.

- [ ] **Step 1: Write the failing test for `getMoveAtPly`**

Create `src/renderer/src/lib/gameNavigation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getMoveAtPly } from './gameNavigation'
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

const EMPTY_EVAL: PositionEvaluation = { lines: [] }

function makeMove(ply: number): AnalyzedMove {
  return {
    ply,
    moveNumber: Math.ceil(ply / 2),
    color: ply % 2 === 1 ? 'w' : 'b',
    san: `move${ply}`,
    moveUci: 'e2e4',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    isPotentialSacrifice: false,
    evalBefore: EMPTY_EVAL,
    evalAfter: EMPTY_EVAL,
    classification: 'good',
    accuracy: 90
  }
}

describe('getMoveAtPly', () => {
  it('returns null for ply 0 (the starting position, before any move)', () => {
    expect(getMoveAtPly([makeMove(1), makeMove(2)], 0)).toBeNull()
  })

  it('returns null when there are no moves', () => {
    expect(getMoveAtPly([], 3)).toBeNull()
  })

  it('returns the move at the given ply', () => {
    const moves = [makeMove(1), makeMove(2), makeMove(3)]
    expect(getMoveAtPly(moves, 2)?.ply).toBe(2)
  })

  it('clamps to the last move when ply exceeds the move list length', () => {
    const moves = [makeMove(1), makeMove(2)]
    expect(getMoveAtPly(moves, 99)?.ply).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/gameNavigation.test.ts`
Expected: FAIL — `getMoveAtPly is not exported` / `is not a function`.

- [ ] **Step 3: Implement `getMoveAtPly`**

Append to `src/renderer/src/lib/gameNavigation.ts` (after the existing `getPositionAtPly` function):

```ts
export function getMoveAtPly(moves: AnalyzedMove[], ply: number): AnalyzedMove | null {
  if (ply <= 0 || moves.length === 0) return null
  return moves[Math.min(ply, moves.length) - 1]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/gameNavigation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for `formatMoveDetail`**

Create `src/renderer/src/lib/moveDetail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatMoveDetail, sanForUci } from './moveDetail'
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function evalWithLine(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

function makeMove(overrides: Partial<AnalyzedMove>): AnalyzedMove {
  return {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'a3',
    moveUci: 'a2a3',
    fenBefore: START_FEN,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1',
    isPotentialSacrifice: false,
    evalBefore: evalWithLine(40, 'g1f3'),
    evalAfter: evalWithLine(850, 'e7e5'),
    classification: 'inaccuracy',
    accuracy: 60,
    ...overrides
  }
}

describe('sanForUci', () => {
  it('converts a legal UCI move to SAN for the given position', () => {
    expect(sanForUci(START_FEN, 'g1f3')).toBe('Nf3')
  })

  it('returns null for an illegal move', () => {
    expect(sanForUci(START_FEN, 'a1a8')).toBeNull()
  })
})

describe('formatMoveDetail', () => {
  it('returns null when no move is selected', () => {
    expect(formatMoveDetail(null)).toBeNull()
  })

  it('returns null for book moves', () => {
    expect(formatMoveDetail(makeMove({ classification: 'book' }))).toBeNull()
  })

  it('describes a non-best move with the win-chance swing and the best alternative', () => {
    const text = formatMoveDetail(makeMove({}))
    expect(text).toMatch(/^a3 — Inaccuracy, -\d+% win chance\. Best was Nf3\.$/)
  })

  it('omits the "Best was" suffix when the played move was the engine\'s top choice', () => {
    const text = formatMoveDetail(
      makeMove({
        san: 'Nf3',
        moveUci: 'g1f3',
        classification: 'best',
        evalBefore: evalWithLine(40, 'g1f3'),
        evalAfter: evalWithLine(-30, 'e7e5')
      })
    )
    expect(text).not.toContain('Best was')
    expect(text).toMatch(/^Nf3 — Best, /)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/moveDetail.test.ts`
Expected: FAIL — `Cannot find module './moveDetail'`.

- [ ] **Step 7: Implement**

Create `src/renderer/src/lib/moveDetail.ts`:

```ts
import { Chess } from 'chess.js'
import type { AnalyzedMove } from '../../../shared/types'
import { computeMoveEvalDelta, cpToWinPercent } from '../../../shared/engineMath'
import { MOVE_CLASSIFICATION_STYLE } from './moveClassificationStyle'

export function sanForUci(fen: string, uci: string): string | null {
  const chess = new Chess(fen)
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci.length > 4 ? uci.slice(4) : undefined
  try {
    const result = chess.move({ from, to, promotion })
    return result.san
  } catch {
    return null
  }
}

export function formatMoveDetail(move: AnalyzedMove | null): string | null {
  if (!move || move.classification === 'book') return null

  const delta = computeMoveEvalDelta(move.evalBefore, move.evalAfter, move.moveUci)
  const winBefore = cpToWinPercent(delta.evalBeforeMoverCp)
  const winAfter = cpToWinPercent(delta.evalAfterMoverCp)
  const winDelta = winAfter - winBefore
  const sign = winDelta >= 0 ? '+' : ''
  const label = MOVE_CLASSIFICATION_STYLE[move.classification].label

  let text = `${move.san} — ${label}, ${sign}${winDelta.toFixed(0)}% win chance.`

  if (!delta.isBestMove) {
    const bestUci = move.evalBefore.lines[0]?.moveUci
    const bestSan = bestUci ? sanForUci(move.fenBefore, bestUci) : null
    if (bestSan) text += ` Best was ${bestSan}.`
  }

  return text
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/moveDetail.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Create the `MoveDetail` component**

Create `src/renderer/src/components/MoveDetail.tsx`:

```tsx
import type { AnalyzedMove } from '../../../shared/types'
import { formatMoveDetail } from '../lib/moveDetail'

interface MoveDetailProps {
  move: AnalyzedMove | null
}

export function MoveDetail({ move }: MoveDetailProps): JSX.Element | null {
  const text = formatMoveDetail(move)
  if (!text) return null
  return <p className="move-detail">{text}</p>
}
```

- [ ] **Step 10: Wire `currentMove` and `MoveDetail` into `App.tsx`**

In `src/renderer/src/App.tsx`, update the import and add the derived value and rendered component:

```tsx
import { getPositionAtPly, getMoveAtPly } from './lib/gameNavigation'
```

```tsx
import { MoveDetail } from './components/MoveDetail'
```

Add alongside the existing `position` memo (near `const position = useMemo(...)`):

```tsx
const currentMove = useMemo(() => getMoveAtPly(state.moves, currentPly), [state.moves, currentPly])
```

In the `board-column` div, render `MoveDetail` after `board-nav`:

```tsx
<div className="board-column">
  <Board fen={position.fen} bestMoveUci={position.bestMoveUci} />
  <div className="board-nav">
    {/* ...unchanged buttons... */}
  </div>
  <MoveDetail move={currentMove} />
</div>
```

- [ ] **Step 11: Add CSS**

Append to `src/renderer/src/app.css`:

```css
.move-detail {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 0.85rem;
  color: var(--text-muted);
  text-align: center;
  width: 100%;
  max-width: 480px;
}

.move-detail::first-line {
  font-family: var(--font-mono);
}
```

Note: `::first-line` with `font-family` applies the mono font to the whole single-line paragraph without needing to split the SAN into its own element — acceptable here since `MoveDetail` always renders one line of text.

- [ ] **Step 12: Typecheck and full test run**

Run: `npm run verify`
Expected: passes, including the 10 new tests from Steps 1-8.

- [ ] **Step 13: Visual check**

Use `run-desktop`, load an analyzed game, step to a blunder. Expected: a readout below the board reading like `"Qh5 — Blunder, -38% win chance. Best was Nf3."`.

- [ ] **Step 14: Commit**

```bash
git add src/renderer/src/lib/gameNavigation.ts src/renderer/src/lib/gameNavigation.test.ts \
  src/renderer/src/lib/moveDetail.ts src/renderer/src/lib/moveDetail.test.ts \
  src/renderer/src/components/MoveDetail.tsx src/renderer/src/App.tsx src/renderer/src/app.css
git commit -m "Add a plain-language move-detail readout below the board"
```

---

### Task 6: On-board classification badge

**Files:**
- Modify: `src/renderer/src/components/Board.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app.css` (append)

**Interfaces:**
- Consumes: `currentMove` (produced in `App.tsx` by Task 5); `MOVE_CLASSIFICATION_STYLE` (Task 3); `react-chessboard`'s `SquareRenderer` type (existing dependency, confirmed present on the installed v5 `ChessboardOptions`).

- [ ] **Step 1: Rewrite `Board.tsx`**

```tsx
import { useMemo } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, SquareRenderer } from 'react-chessboard'
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
  currentMove: AnalyzedMove | null
}

export function Board({ fen, bestMoveUci, currentMove }: BoardProps): JSX.Element {
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'rgb(21, 128, 61)'
        }
      ]
    : []

  const badgeSquare = currentMove ? currentMove.moveUci.slice(2, 4) : null
  const badgeStyle = currentMove ? MOVE_CLASSIFICATION_STYLE[currentMove.classification] : null

  const squareRenderer: SquareRenderer = useMemo(() => {
    return ({ square, children }) => {
      const showBadge = badgeSquare !== null && badgeStyle !== null && square === badgeSquare
      const BadgeIcon = badgeStyle?.icon
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {children}
          {showBadge && badgeStyle && BadgeIcon && (
            <span
              className="board-move-badge"
              style={{ backgroundColor: badgeStyle.color }}
              title={badgeStyle.label}
            >
              <BadgeIcon size={12} strokeWidth={2.5} color="var(--accent-contrast)" />
            </span>
          )}
        </div>
      )
    }
  }, [badgeSquare, badgeStyle])

  return (
    <div className="board-container">
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          arrows,
          boardOrientation: 'white',
          squareRenderer
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Pass `currentMove` from `App.tsx`**

In `src/renderer/src/App.tsx`, update the `Board` usage (the `currentMove` variable already exists from Task 5):

```tsx
<Board fen={position.fen} bestMoveUci={position.bestMoveUci} currentMove={currentMove} />
```

- [ ] **Step 3: Add CSS**

Append to `src/renderer/src/app.css`:

```css
.board-move-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  animation: badge-pop 0.15s ease-out;
}

@keyframes badge-pop {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes. If `SquareRenderer`'s parameter type doesn't structurally match the destructured `{ square, children }` usage, check the exact shape with:
```bash
grep -n "SquareRenderer\|SquareHandlerArgs" node_modules/react-chessboard/dist/types.d.ts
```
and adjust the destructuring to match (the type as of this plan's writing is `({ piece, square, children }: SquareHandlerArgs & { children?: React.ReactNode }) => React.JSX.Element`, which is a superset of what's destructured here).

- [ ] **Step 5: Visual check — this is the step that actually validates the approach**

Use `run-desktop`, load an analyzed game with at least one mistake/blunder, and step through moves with the arrow keys. Expected: a small colored icon badge appears pinned to the corner of the destination square of the current move, and moves as you navigate; the piece underneath remains fully visible; the best-move arrow (when shown) still renders correctly. If the badge is mispositioned or the piece disappears, the square renderer's returned wrapper div may need `display: 'grid'`/`place-items: 'center'` instead of the default block layout, or the badge's `position: absolute` may need a different anchor — adjust `Board.tsx` and re-screenshot until correct.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Board.tsx src/renderer/src/App.tsx src/renderer/src/app.css
git commit -m "Add an on-board classification badge for the current move"
```

---

### Task 7: Game summary redesign

**Files:**
- Modify: `src/renderer/src/components/GameSummary.tsx`
- Modify: `src/renderer/src/app.css` (remove dead rules, append new ones)

**Interfaces:**
- Consumes: `MOVE_CLASSIFICATION_STYLE` (Task 3).

- [ ] **Step 1: Rewrite `GameSummary.tsx`**

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface GameSummaryProps {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
  whiteUsername: string
  blackUsername: string
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

export function GameSummary({
  moves,
  whiteAccuracy,
  blackAccuracy,
  whiteUsername,
  blackUsername
}: GameSummaryProps): JSX.Element {
  const whiteCounts = countByClassification(moves, 'w')
  const blackCounts = countByClassification(moves, 'b')

  const barData = [
    { player: whiteUsername, ...whiteCounts },
    { player: blackUsername, ...blackCounts }
  ]

  return (
    <div className="game-summary">
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

      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="player" hide />
          <Tooltip cursor={{ fill: 'transparent' }} />
          {CLASSIFICATIONS_TO_SHOW.map((classification) => (
            <Bar
              key={classification}
              dataKey={classification}
              stackId="quality"
              fill={MOVE_CLASSIFICATION_STYLE[classification].color}
              name={MOVE_CLASSIFICATION_STYLE[classification].label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <ul className="classification-legend">
        {CLASSIFICATIONS_TO_SHOW.map((classification) => {
          const style = MOVE_CLASSIFICATION_STYLE[classification]
          const Icon = style.icon
          return (
            <li key={classification} className="classification-legend-item">
              <Icon size={13} style={{ color: style.color }} />
              <span>{style.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Remove the now-dead table CSS and add the new rules**

In `src/renderer/src/app.css`, delete these rules (no longer referenced by any component):

```css
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
```

Append:

```css
.accuracy-scorecards {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.accuracy-scorecard {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.6rem 0.75rem;
}

.accuracy-scorecard-value {
  font-family: var(--font-mono);
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--text);
}

.accuracy-scorecard-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.classification-legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  padding: 0;
  margin: 0.75rem 0 0;
}

.classification-legend-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

Use `run-desktop`, load a fully analyzed game. Expected: two accuracy scorecards, a horizontal stacked bar per player showing move-quality distribution, and a legend of icon+label below it — no table.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GameSummary.tsx src/renderer/src/app.css
git commit -m "Redesign the game summary as scorecards, a stacked bar, and a legend"
```

---

### Task 8: NavBar redesign

**Files:**
- Modify: `src/renderer/src/components/NavBar.tsx`
- Modify: `src/renderer/src/app.css` (remove dead rules, append new ones)

**Interfaces:**
- Produces: `.segmented-control` / `.segmented-control-option` CSS classes — consumed by Task 10 (`ImportModal`).

- [ ] **Step 1: Rewrite `NavBar.tsx`**

```tsx
import { Loader2, CircleCheck } from 'lucide-react'
import type { LinkedAccount } from '../../../shared/types'

export type AppTab = 'analyze' | 'insights'

interface NavBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
  isAnalyzing: boolean
  isScanning: boolean
  linkedAccount: LinkedAccount | null
  onOpenConnectModal: () => void
}

export function NavBar({
  activeTab,
  onSelectTab,
  isAnalyzing,
  isScanning,
  linkedAccount,
  onOpenConnectModal
}: NavBarProps): JSX.Element {
  const chipLabel = linkedAccount
    ? linkedAccount.verifiedAt
      ? linkedAccount.username
      : `${linkedAccount.username} · Unverified`
    : 'Connect chess.com account'

  return (
    <header className="nav-bar">
      <span className="nav-brand">Chess Analyzer</span>
      <nav className="segmented-control">
        <button
          className={`segmented-control-option${activeTab === 'analyze' ? ' active' : ''}`}
          onClick={() => onSelectTab('analyze')}
        >
          Analyze
          {isAnalyzing && <Loader2 size={14} className="spin-icon" />}
        </button>
        <button
          className={`segmented-control-option${activeTab === 'insights' ? ' active' : ''}`}
          onClick={() => onSelectTab('insights')}
        >
          Insights
          {isScanning && <Loader2 size={14} className="spin-icon" />}
        </button>
      </nav>
      <button
        className={`account-chip${linkedAccount?.verifiedAt ? ' verified' : ''}`}
        onClick={onOpenConnectModal}
      >
        {linkedAccount?.verifiedAt && <CircleCheck size={14} className="account-chip-icon" />}
        {chipLabel}
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Remove the now-dead nav-tab rules and add the new ones**

In `src/renderer/src/app.css`, delete:

```css
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
  color: var(--accent-contrast);
  font-weight: 600;
}
```

Replace the `.nav-brand` rule with:

```css
.nav-brand {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
```

Append:

```css
.segmented-control {
  display: flex;
  gap: 0.2rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.2rem;
}

.segmented-control-option {
  background: transparent;
  border: 1px solid transparent;
  border-radius: calc(var(--radius-control) - 2px);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.segmented-control-option.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.spin-icon {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: transparent;
  border: 1px solid var(--border);
}

.account-chip.verified {
  border-color: var(--mq-best);
  color: var(--mq-best);
}

.account-chip-icon {
  flex-shrink: 0;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

Use `run-desktop`, screenshot the nav bar in all four states: idle, analyzing (spinning loader on "Analyze"), scanning (spinning loader on "Insights"), and with a verified linked account (brass-outlined chip with a check icon). Expected: serif wordmark, pill-style segmented tabs, no leftover Unicode `⏳`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NavBar.tsx src/renderer/src/app.css
git commit -m "Redesign the nav bar: serif wordmark, segmented tabs, account chip states"
```

---

### Task 9: Board furniture polish (nav icons, eval bar, eval graph)

**Files:**
- Modify: `src/renderer/src/App.tsx` (board-nav buttons)
- Modify: `src/renderer/src/components/EvalBar.tsx`
- Modify: `src/renderer/src/components/EvalGraph.tsx`
- Modify: `src/renderer/src/app.css`

- [ ] **Step 1: Swap the Unicode board-nav glyphs for lucide icons in `App.tsx`**

Add the import:

```tsx
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
```

Replace the four `board-nav` buttons:

```tsx
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
```

- [ ] **Step 2: Update `.board-nav button` CSS to center the icons**

In `src/renderer/src/app.css`, replace:

```css
.board-nav button {
  min-width: 2.75rem;
  padding: 0.35rem 0.6rem;
  font-size: 1.1rem;
  line-height: 1;
}
```

with:

```css
.board-nav button {
  min-width: 2.75rem;
  padding: 0.35rem 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 3: Polish `EvalBar.tsx`**

The component's structure stays the same (still two divs sized by `whiteWinPercent`); only its CSS changes:

```tsx
interface EvalBarProps {
  whiteWinPercent: number
  displayScore: string
}

export function EvalBar({ whiteWinPercent, displayScore }: EvalBarProps): JSX.Element {
  return (
    <div className="eval-bar">
      <div className="eval-bar-black" style={{ height: `${100 - whiteWinPercent}%` }} />
      <div className="eval-bar-white" style={{ height: `${whiteWinPercent}%` }} />
      <span className="eval-bar-score">{displayScore}</span>
    </div>
  )
}
```

- [ ] **Step 4: Update the eval bar CSS**

In `src/renderer/src/app.css`, replace the existing `.eval-bar` rule (from Task 2 — same selector, only `border-radius` changes) with:

```css
.eval-bar {
  position: relative;
  width: 100%;
  height: 480px;
  border: 1px solid var(--border);
  border-radius: 999px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

Replace the existing `.eval-bar-score` rule (from Task 2 — `bottom` and `font-size` change, `font-family` is new) with:

```css
.eval-bar-score {
  position: absolute;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  color: #000;
  mix-blend-mode: difference;
  filter: invert(1);
}
```

Then append two new rules after them (the existing `.eval-bar-black` / `.eval-bar-white` background-color rules from Task 2 stay untouched and still apply — these add `position`/`transition` and the gradient sliver alongside them):

```css
.eval-bar-black,
.eval-bar-white {
  position: relative;
  transition: height 0.25s ease;
}

.eval-bar-white::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 16px;
  background: linear-gradient(to bottom, transparent, var(--text));
  pointer-events: none;
}
```

- [ ] **Step 5: Recolor `EvalGraph.tsx`**

Replace the hardcoded hex strings with CSS variable references:

```tsx
<ReferenceLine y={50} stroke="var(--border-strong)" strokeDasharray="3 3" />
<ReferenceLine x={currentPly} stroke="var(--accent)" />
```

```tsx
<Area
  type="stepAfter"
  dataKey="whiteWinPercent"
  stroke="var(--text)"
  fill="var(--text)"
  fillOpacity={0.85}
/>
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 7: Visual check**

Use `run-desktop`, screenshot the board column and eval graph mid-analysis. Expected: pill-shaped eval bar with a soft transition at the black/white boundary, monospace score text, lucide chevron icons on the nav buttons (no `⏮◀▶⏭`), brass reference line in the eval graph.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/EvalBar.tsx \
  src/renderer/src/components/EvalGraph.tsx src/renderer/src/app.css
git commit -m "Polish board nav icons, eval bar shape, and eval graph colors"
```

---

### Task 10: ImportModal redesign

**Files:**
- Create: `src/renderer/src/lib/chessComResult.ts`
- Test: `src/renderer/src/lib/chessComResult.test.ts`
- Modify: `src/renderer/src/components/ImportModal.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `.segmented-control` / `.segmented-control-option` (Task 8).
- Produces: `resultBadge(game: ChessComGameSummary): { text: string; outcome: 'white' | 'black' | 'draw' }`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/lib/chessComResult.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resultBadge } from './chessComResult'
import type { ChessComGameSummary } from '../../../shared/types'

function makeGame(whiteResult: string, blackResult: string): ChessComGameSummary {
  return {
    url: 'https://chess.com/game/1',
    pgn: '',
    endTime: 0,
    timeControl: '600',
    white: { username: 'alice', rating: 1500, result: whiteResult },
    black: { username: 'bob', rating: 1500, result: blackResult }
  }
}

describe('resultBadge', () => {
  it('reports a white win', () => {
    expect(resultBadge(makeGame('win', 'resigned'))).toEqual({ text: '1–0', outcome: 'white' })
  })

  it('reports a black win', () => {
    expect(resultBadge(makeGame('resigned', 'win'))).toEqual({ text: '0–1', outcome: 'black' })
  })

  it('reports a draw', () => {
    expect(resultBadge(makeGame('agreed', 'agreed'))).toEqual({ text: '½–½', outcome: 'draw' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/lib/chessComResult.test.ts`
Expected: FAIL — `Cannot find module './chessComResult'`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/chessComResult.ts`:

```ts
import type { ChessComGameSummary } from '../../../shared/types'

const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  'timevsinsufficient',
  '50move'
])

export function resultBadge(game: ChessComGameSummary): {
  text: string
  outcome: 'white' | 'black' | 'draw'
} {
  if (DRAW_RESULTS.has(game.white.result) || DRAW_RESULTS.has(game.black.result)) {
    return { text: '½–½', outcome: 'draw' }
  }
  return game.white.result === 'win'
    ? { text: '1–0', outcome: 'white' }
    : { text: '0–1', outcome: 'black' }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/lib/chessComResult.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `ImportModal.tsx`**

Add the import:

```tsx
import { resultBadge } from '../lib/chessComResult'
```

Replace the `import-tabs` block:

```tsx
<div className="import-tabs segmented-control">
  <button
    className={`segmented-control-option${tab === 'paste' ? ' active' : ''}`}
    onClick={() => setTab('paste')}
  >
    Paste PGN
  </button>
  <button
    className={`segmented-control-option${tab === 'upload' ? ' active' : ''}`}
    onClick={() => setTab('upload')}
  >
    Upload File
  </button>
  <button
    className={`segmented-control-option${tab === 'chesscom' ? ' active' : ''}`}
    onClick={() => setTab('chesscom')}
  >
    Chess.com
  </button>
</div>
```

Replace the `chesscom-game-list` block:

```tsx
<ul className="chesscom-game-list">
  {chessComGames.map((game) => {
    const badge = resultBadge(game)
    return (
      <li key={game.url}>
        <button className="chesscom-game-card" onClick={() => onGameLoaded(game.pgn)}>
          <span className="chesscom-game-players">
            <span className="chesscom-game-player">
              {game.white.username}{' '}
              <span className="chesscom-game-rating">({game.white.rating})</span>
            </span>
            <span className={`chesscom-game-result ${badge.outcome}`}>{badge.text}</span>
            <span className="chesscom-game-player">
              {game.black.username}{' '}
              <span className="chesscom-game-rating">({game.black.rating})</span>
            </span>
          </span>
          <span className="chesscom-game-date">
            {new Date(game.endTime * 1000).toLocaleDateString()}
          </span>
        </button>
      </li>
    )
  })}
</ul>
```

- [ ] **Step 6: Update the CSS**

In `src/renderer/src/app.css`, delete these two now-dead rules:

```css
.import-tabs button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.chesscom-game-list button {
  width: 100%;
  text-align: left;
}
```

Replace the `.import-tabs` rule with:

```css
.import-tabs {
  margin-bottom: 1rem;
}
```

Append:

```css
.chesscom-game-card {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--panel-elevated);
  text-align: left;
}

.chesscom-game-card:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 10%, var(--panel-elevated));
}

.chesscom-game-players {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.chesscom-game-rating {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.82rem;
}

.chesscom-game-result {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  padding: 0.1rem 0.4rem;
  border-radius: var(--radius-control);
  white-space: nowrap;
}

.chesscom-game-result.white {
  background: color-mix(in srgb, var(--mq-best) 20%, transparent);
  color: var(--mq-best);
}

.chesscom-game-result.black {
  background: color-mix(in srgb, var(--text-muted) 20%, transparent);
  color: var(--text);
}

.chesscom-game-result.draw {
  background: color-mix(in srgb, var(--text-faint) 20%, transparent);
  color: var(--text-muted);
}

.chesscom-game-date {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}
```

- [ ] **Step 7: Typecheck and full test run**

Run: `npm run verify`
Expected: passes, including the 3 new `chessComResult` tests.

- [ ] **Step 8: Visual check**

Use `run-desktop`, open the import modal, search chess.com games for a real username. Expected: segmented-pill import tabs, game rows as cards with a `1–0`/`0–1`/`½–½` badge between the two player names.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/lib/chessComResult.ts src/renderer/src/lib/chessComResult.test.ts \
  src/renderer/src/components/ImportModal.tsx src/renderer/src/app.css
git commit -m "Redesign the import modal: segmented tabs, chess.com game cards"
```

---

### Task 11: ConnectAccountModal redesign

**Files:**
- Modify: `src/renderer/src/components/ConnectAccountModal.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `.button-primary` / `.button-secondary` (Task 2).

- [ ] **Step 1: Apply button hierarchy classes in `ConnectAccountModal.tsx`**

Update the three `step` blocks' buttons:

```tsx
{step === 'status' && linkedAccount && (
  <>
    <p>
      Connected as <strong>{linkedAccount.username}</strong>
      {linkedAccount.verifiedAt ? ' — Verified' : ' — Unverified'}
    </p>
    <div className="modal-actions">
      {!linkedAccount.verifiedAt && (
        <button
          className="button-primary"
          onClick={() => void startLinkFor(linkedAccount.username)}
          disabled={isBusy}
        >
          Verify it&apos;s you
        </button>
      )}
      <button className="button-secondary" onClick={() => void handleDisconnect()} disabled={isBusy}>
        Disconnect
      </button>
      <button className="button-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  </>
)}

{step === 'enter-username' && (
  <>
    <p>Connect your chess.com account</p>
    <div className="chesscom-search">
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="chess.com username"
        onKeyDown={(e) => e.key === 'Enter' && void startLinkFor(username)}
      />
      <button className="button-primary" onClick={() => void startLinkFor(username)} disabled={isBusy}>
        {isBusy ? 'Checking...' : 'Start'}
      </button>
    </div>
    <div className="modal-actions">
      <button className="button-secondary" onClick={onClose}>
        Cancel
      </button>
    </div>
  </>
)}

{step === 'awaiting-code' && (
  <>
    <p>
      Paste this code into your chess.com profile&apos;s <strong>Location</strong> field,
      save it there, then verify:
    </p>
    <code className="verification-code">{code}</code>
    <div className="modal-actions">
      <button
        className="button-secondary"
        onClick={() => void window.chessAPI.openChessComProfileSettings()}
      >
        Open chess.com profile
      </button>
      <button className="button-primary" onClick={() => void handleVerify()} disabled={isBusy}>
        {isBusy ? 'Checking...' : "I've pasted it — Verify"}
      </button>
      <button className="button-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  </>
)}
```

(Only the `className` additions on `<button>` elements change; all handlers, conditions, and text stay exactly as they are today.)

- [ ] **Step 2: Set the verification code to the mono font**

In `src/renderer/src/app.css`, add `font-family: var(--font-mono);` to the `.verification-code` rule:

```css
.verification-code {
  display: block;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.5rem 0.75rem;
  margin: 0.5rem 0;
  font-family: var(--font-mono);
  font-size: 1rem;
  letter-spacing: 0.03em;
  text-align: center;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

Use `run-desktop`, open the connect-account modal and step through "enter username" → "awaiting code" → "status". Expected: one brass-filled primary button per step, ghost secondary buttons for Cancel/Close/Disconnect, verification code in monospace.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ConnectAccountModal.tsx src/renderer/src/app.css
git commit -m "Apply primary/secondary button hierarchy to the connect-account modal"
```

---

### Task 12: Insights tab polish

**Files:**
- Modify: `src/renderer/src/components/insights/TopFindingsList.tsx`
- Modify: `src/renderer/src/components/insights/TimeControlSection.tsx`
- Modify: `src/renderer/src/components/InsightsTab.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `.button-primary` / `.button-secondary` (Task 2).

- [ ] **Step 1: Rewrite `TopFindingsList.tsx`**

```tsx
import { Lightbulb } from 'lucide-react'
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
      {findings.slice(0, 8).map((finding, index) => (
        <li key={`${index}-${finding.text}`} className="top-finding-card">
          <Lightbulb size={15} className="top-finding-icon" />
          <span>{finding.text}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Recolor the charts and add a header font in `TimeControlSection.tsx`**

Replace the `BarChart` block:

```tsx
<ResponsiveContainer width="100%" height={120}>
  <BarChart data={phaseData}>
    <XAxis dataKey="phase" stroke="var(--text-muted)" />
    <YAxis allowDecimals={false} stroke="var(--text-muted)" />
    <Tooltip />
    <Bar dataKey="count" fill="var(--accent)" />
  </BarChart>
</ResponsiveContainer>
```

Replace the trend `AreaChart` block:

```tsx
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
```

- [ ] **Step 3: Apply button classes in `InsightsTab.tsx`**

Replace the scan/cancel buttons:

```tsx
{state.status === 'scanning' ? (
  <div className="insights-scan-progress">
    <span>
      Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
    </span>
    <progress value={state.progress?.scanned ?? 0} max={state.progress?.total || 1} />
    <button className="button-secondary" onClick={cancelScan}>
      Cancel
    </button>
  </div>
) : (
  <button className="button-primary" onClick={() => void startScan()}>
    {hasReport ? 'Rescan' : 'Scan my games'}
  </button>
)}
```

- [ ] **Step 4: Update the CSS**

In `src/renderer/src/app.css`, replace the `.top-findings-list` rule:

```css
.top-findings-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
```

Append:

```css
.top-finding-card {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.55rem 0.7rem;
  font-size: 0.9rem;
}

.top-finding-icon {
  flex-shrink: 0;
  margin-top: 0.15rem;
  color: var(--accent);
}

.time-control-section h3 {
  font-family: var(--font-display);
  font-weight: 600;
  margin: 0 0 0.25rem;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 6: Visual check**

Use `run-desktop`, open the Insights tab with an existing scan report (or run a scan). Expected: findings render as cards with a lightbulb icon, time-control section headers use the serif font, charts use brass/muted-text colors (no `#7fa650`/`#9a9ea8`), scan button is brass-filled.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/insights/TopFindingsList.tsx \
  src/renderer/src/components/insights/TimeControlSection.tsx \
  src/renderer/src/components/InsightsTab.tsx src/renderer/src/app.css
git commit -m "Polish the Insights tab: finding cards, chart colors, button hierarchy"
```

---

### Task 13: Full-app visual verification pass

**Files:** None expected — this task fixes whatever Step 2 finds, in whichever file(s) the defect lives in.

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: `tsc -b` and `vitest run` both pass (all tests from Tasks 1-12, plus the pre-existing suite).

- [ ] **Step 2: Screenshot every screen/state via the `run-desktop` skill and check against the spec**

Capture and review:
1. Import screen (empty state) — Fraunces wordmark, brass active tab, ivory/warm-dark palette throughout.
2. Mid-analysis — progress bar, spinning loader icon on the "Analyze" nav tab.
3. Done state, a game with at least one of each notable classification (brilliant/blunder ideally) — move list icons + NAG suffixes, on-board badge on the current move, move-detail readout below the board, redesigned game summary (scorecards + stacked bar + legend).
4. Step through several moves with arrow keys — confirm the board badge and move-detail readout both update and stay in sync with the selected move.
5. Insights tab, empty state and with a report — finding cards, time-control charts in the new palette, serif section headers.
6. Connect-account modal, all three steps — button hierarchy, monospace verification code.
7. Chess.com import tab with search results — game cards with result badges.

For each: confirm no leftover default browser blue focus outlines, no unstyled/black-on-black text, no visual mismatch between components styled in different tasks (e.g. inconsistent button radii).

- [ ] **Step 3: Fix any defects found**

Any issue found belongs to whichever file owns that rule — check `src/renderer/src/app.css` for the relevant selector first (most defects will be a missed token migration or a copy-paste mismatch between tasks), otherwise the owning component file per the Task list above. Re-run Step 1 and re-screenshot the affected screen after each fix.

- [ ] **Step 4: Final commit (only if Step 3 made changes)**

```bash
git add -A
git commit -m "Fix visual inconsistencies found in full-app UI review"
```

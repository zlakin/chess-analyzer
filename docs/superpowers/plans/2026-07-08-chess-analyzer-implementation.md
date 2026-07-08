# Chess Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, local Electron desktop app that reproduces chess.com's Game Review — engine evaluation, move classification (Book/Brilliant/Great/Best/Excellent/Good/Inaccuracy/Mistake/Blunder), per-player accuracy %, and game import from paste/file/chess.com — using a locally-run Stockfish engine.

**Architecture:** Electron main process owns a Stockfish subprocess (UCI protocol) and orchestrates per-move analysis; it also handles chess.com API fetches and file dialogs. The React renderer parses PGN (via chess.js) into a position list, sends it to main over `contextBridge` IPC, and renders the streamed per-move results (board, eval bar, move list, eval graph, summary). Pure analysis math (engine-math, classification, accuracy) lives in plain TypeScript modules with zero Electron dependency, so it's covered by fast Vitest unit tests.

**Tech Stack:** Electron 43, electron-vite 5, React 19, TypeScript 5 (strict), chess.js 1.4.0, react-chessboard 5.10.0, recharts 3.9, Vitest 4.

## Global Constraints

- Node.js >= 18.18 required (uses global `fetch`, ESM `import.meta.url`).
- TypeScript `strict: true` in every tsconfig.
- `npm run typecheck` (runs `tsc -b` across the project references) must exit 0 before any task's work is committed — `electron-vite`'s `dev`/`build` transpile without type-checking, so this is the only thing that catches cross-file type errors.
- Renderer never uses `nodeIntegration` — all main-process access goes through the single `window.chessAPI` object exposed via `contextBridge` in `src/preload/index.ts`.
- No test-infra beyond Vitest (no jsdom/testing-library) — per the design spec, only pure-logic modules (PGN parsing, accuracy formula, classification, engine manager) get automated tests; UI is verified by running the app.
- The Stockfish binary is downloaded by `scripts/downloadStockfish.mjs` into `vendor/stockfish/` and is **never committed** — `.gitignore` already excludes `vendor/stockfish/`.
- chess.com integration uses only the official public Published-Data API (`api.chess.com/pub/...`). No undocumented endpoints, and no fetch-by-URL (see `docs/superpowers/specs/2026-07-08-chess-analyzer-design.md` for why).
- Package manager: npm.
- Repo root is `/home/zacharyl/chess` (already a git repo with `main` branch, pushed to `github.com/zlakin/chess-analyzer`).

---

### Task 1: Project scaffolding & tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/shared/sanity.test.ts`

**Interfaces:**
- Produces: an installable, runnable Electron+React+TS skeleton (`npm run dev` opens a window; `npm test` runs Vitest; `npm run typecheck` runs `tsc -b`) that every later task builds on. No app-specific types yet.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "chess-analyzer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "engines": {
    "node": ">=18.18"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b",
    "setup:stockfish": "node scripts/downloadStockfish.mjs"
  },
  "dependencies": {
    "chess.js": "^1.4.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.3",
    "electron": "^43.1.0",
    "electron-vite": "^5.0.0",
    "typescript": "^5.5.0",
    "vite": "^8.1.3",
    "vitest": "^4.1.10"
  }
}
```

Note: `typescript` is pinned to `^5.5.0` (not the newest `7.x`) deliberately — TypeScript 7 is a very recent major version; 5.x is the well-proven version most tooling in this stack (electron-vite, @types packages) was written against.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

- [ ] **Step 3: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "composite": true,
    "noEmit": true
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

(`composite: true` is required for `tsc -b` — the project-references build mode used by the `typecheck` script — to treat this as a buildable project. It's compatible with `noEmit: true`: `tsc -b` still type-checks and reports errors, it just doesn't write output files. Verified directly: a throwaway project with this exact `composite`+`noEmit` combination correctly caught a deliberate type error via `tsc -b --force` and exited non-zero.)

- [ ] **Step 4: Write `tsconfig.web.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "composite": true
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

Both this project and `tsconfig.node.json` include `src/shared/**/*` — verified directly that two composite projects independently including the same `noEmit` source files type-checks cleanly with `tsc -b` (no output-collision error, since neither emits).

- [ ] **Step 5: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
```

(electron-vite 5 externalizes main/preload dependencies by default — no `externalizeDepsPlugin` needed.)

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 7: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

- [ ] **Step 8: Write `src/preload/index.ts`**

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('chessAPI', {})
```

(Replaced with the real API surface in Task 10.)

- [ ] **Step 9: Write `src/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Chess Analyzer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Write `src/renderer/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 11: Write `src/renderer/src/App.tsx`**

```tsx
function App(): JSX.Element {
  return <h1>Chess Analyzer</h1>
}

export default App
```

- [ ] **Step 12: Write a sanity test at `src/shared/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('project scaffolding', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 13: Install dependencies**

Run: `npm install`
Expected: completes with no errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 14: Verify the test runner works**

Run: `npm test`
Expected: `src/shared/sanity.test.ts` passes (1 test, 1 file).

- [ ] **Step 15: Verify type-checking works**

Run: `npm run typecheck`
Expected: exits 0 with no errors (this runs `tsc -b` across the `main`/`preload`/`renderer` project references — it's the only thing in this project that catches cross-file type errors, since `electron-vite`'s dev/build commands transpile without type-checking).

- [ ] **Step 16: Verify the app boots**

Run: `npm run dev`
Expected: an Electron window opens showing "Chess Analyzer". Close the window (or Ctrl+C the process) once confirmed.

- [ ] **Step 17: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json tsconfig.web.json electron.vite.config.ts vitest.config.ts src/
git commit -m "Scaffold Electron + React + TS project with Vitest"
```

---

### Task 2: Shared types & PGN parsing

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/renderer/src/lib/pgn.ts`
- Test: `src/renderer/src/lib/pgn.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first app-specific module).
- Produces: `AnalyzedPosition` (used by every later task that touches a game's moves), `EngineLine`, `PositionEvaluation`, `MoveClassification`, `AnalyzedMove`, `GameAnalysisResult`, `ChessComGameSummary`, `ChessAPI` (all in `src/shared/types.ts`); `parsePgn(pgn: string): AnalyzedPosition[]` and `PgnParseError` (in `src/renderer/src/lib/pgn.ts`).

- [ ] **Step 1: Install chess.js**

Run: `npm install chess.js@^1.4.0`

- [ ] **Step 2: Write `src/shared/types.ts`**

```ts
export interface AnalyzedPosition {
  ply: number
  moveNumber: number
  color: 'w' | 'b'
  san: string
  moveUci: string
  fenBefore: string
  fenAfter: string
  isPotentialSacrifice: boolean
}

export interface EngineLine {
  depth: number
  scoreCp: number | null
  scoreMate: number | null
  moveUci: string
  pv: string[]
}

export interface PositionEvaluation {
  lines: EngineLine[]
}

export type MoveClassification =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export interface AnalyzedMove extends AnalyzedPosition {
  evalBefore: PositionEvaluation
  evalAfter: PositionEvaluation
  classification: MoveClassification
  accuracy: number
}

export interface GameAnalysisResult {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
}

export interface ChessComPlayerResult {
  username: string
  rating: number
  result: string
}

export interface ChessComGameSummary {
  url: string
  pgn: string
  endTime: number
  timeControl: string
  white: ChessComPlayerResult
  black: ChessComPlayerResult
}

export interface ChessAPI {
  analyzeGame(
    positions: AnalyzedPosition[],
    depth: number
  ): Promise<GameAnalysisResult | { cancelled: true } | { error: string }>
  onAnalysisProgress(callback: (move: AnalyzedMove) => void): () => void
  cancelAnalysis(): void
  openPgnFile(): Promise<{ pgn: string } | { cancelled: true } | { error: string }>
  fetchChessComGames(username: string): Promise<ChessComGameSummary[] | { error: string }>
}
```

- [ ] **Step 3: Write the failing test at `src/renderer/src/lib/pgn.test.ts`**

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

  it('throws PgnParseError for malformed PGN', () => {
    expect(() => parsePgn('1. e4 Zz9')).toThrow(PgnParseError)
  })

  it('throws PgnParseError for a PGN with no moves', () => {
    expect(() => parsePgn('[Event "Empty"]')).toThrow(PgnParseError)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/pgn.test.ts`
Expected: FAIL — `Cannot find module './pgn'`.

- [ ] **Step 5: Write `src/renderer/src/lib/pgn.ts`**

```ts
import { Chess } from 'chess.js'
import type { AnalyzedPosition } from '../../../shared/types'

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

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/pgn.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/types.ts src/renderer/src/lib/pgn.ts src/renderer/src/lib/pgn.test.ts
git commit -m "Add shared types and PGN parsing with sacrifice detection"
```

---

### Task 3: Engine math (shared pure functions)

**Files:**
- Create: `src/shared/engineMath.ts`
- Test: `src/shared/engineMath.test.ts`

**Interfaces:**
- Consumes: `EngineLine`, `PositionEvaluation` from `src/shared/types.ts` (Task 2).
- Produces: `effectiveCp(line: EngineLine): number`, `cpToWinPercent(cp: number): number`, `computeMoveEvalDelta(evalBefore, evalAfter, playedMoveUci): MoveEvalDelta`, and the `MoveEvalDelta` type — consumed by main's `accuracy.ts` (Task 4), `gameAnalyzer.ts` (Task 8), and renderer's `displayEval.ts` (Task 13).

- [ ] **Step 1: Write the failing test at `src/shared/engineMath.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { effectiveCp, cpToWinPercent, computeMoveEvalDelta } from './engineMath'
import type { EngineLine, PositionEvaluation } from './types'

function line(overrides: Partial<EngineLine>): EngineLine {
  return { depth: 18, scoreCp: 0, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'], ...overrides }
}

describe('effectiveCp', () => {
  it('returns the raw centipawn score when there is no mate', () => {
    expect(effectiveCp(line({ scoreCp: 45, scoreMate: null }))).toBe(45)
  })

  it('returns a large positive number for a short mate for the side to move', () => {
    expect(effectiveCp(line({ scoreCp: null, scoreMate: 2 }))).toBeGreaterThan(50000)
  })

  it('returns a large negative number for a short mate against the side to move', () => {
    expect(effectiveCp(line({ scoreCp: null, scoreMate: -2 }))).toBeLessThan(-50000)
  })

  it('gives a closer mate a bigger magnitude than a longer one', () => {
    const mateIn1 = effectiveCp(line({ scoreCp: null, scoreMate: 1 }))
    const mateIn5 = effectiveCp(line({ scoreCp: null, scoreMate: 5 }))
    expect(mateIn1).toBeGreaterThan(mateIn5)
  })
})

describe('cpToWinPercent', () => {
  it('returns 50% at an equal position', () => {
    expect(cpToWinPercent(0)).toBeCloseTo(50, 5)
  })

  it('increases monotonically with centipawns', () => {
    expect(cpToWinPercent(100)).toBeGreaterThan(cpToWinPercent(0))
    expect(cpToWinPercent(500)).toBeGreaterThan(cpToWinPercent(100))
  })

  it('is symmetric around 50%', () => {
    const above = cpToWinPercent(200)
    const below = cpToWinPercent(-200)
    expect(above - 50).toBeCloseTo(50 - below, 5)
  })
})

describe('computeMoveEvalDelta', () => {
  it('reports zero loss and isBestMove=true when the played move matches the top line', () => {
    const evalBefore: PositionEvaluation = {
      lines: [line({ scoreCp: 40, moveUci: 'e2e4' }), line({ scoreCp: 20, moveUci: 'd2d4' })]
    }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -38, moveUci: 'e7e5' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')

    expect(delta.isBestMove).toBe(true)
    expect(delta.cpLoss).toBe(0)
    expect(delta.evalBeforeMoverCp).toBe(40)
    expect(delta.secondBestMoverCp).toBe(20)
  })

  it('reports positive cpLoss for a move that is worse than the best line', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 40, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: 60, moveUci: 'a7a6' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'a2a3')

    expect(delta.isBestMove).toBe(false)
    expect(delta.evalAfterMoverCp).toBe(-60)
    expect(delta.cpLoss).toBe(100)
  })

  it('returns null secondBestMoverCp when only one line was evaluated', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 10, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -5, moveUci: 'e7e5' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')

    expect(delta.secondBestMoverCp).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/engineMath.test.ts`
Expected: FAIL — `Cannot find module './engineMath'`.

- [ ] **Step 3: Write `src/shared/engineMath.ts`**

```ts
import type { EngineLine, PositionEvaluation } from './types'

const MATE_SCORE_BASE = 100000
const MATE_SCORE_STEP = 100

export function effectiveCp(line: EngineLine): number {
  if (line.scoreMate !== null) {
    const sign = line.scoreMate > 0 ? 1 : -1
    return sign * (MATE_SCORE_BASE - Math.abs(line.scoreMate) * MATE_SCORE_STEP)
  }
  return line.scoreCp ?? 0
}

export function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export interface MoveEvalDelta {
  cpLoss: number
  evalBeforeMoverCp: number
  evalAfterMoverCp: number
  secondBestMoverCp: number | null
  isBestMove: boolean
}

export function computeMoveEvalDelta(
  evalBefore: PositionEvaluation,
  evalAfter: PositionEvaluation,
  playedMoveUci: string
): MoveEvalDelta {
  const bestLineBefore = evalBefore.lines[0]
  const secondLineBefore = evalBefore.lines[1] ?? null
  const bestLineAfter = evalAfter.lines[0]

  const evalBeforeMoverCp = effectiveCp(bestLineBefore)
  const evalAfterMoverCp = -effectiveCp(bestLineAfter)
  const secondBestMoverCp = secondLineBefore ? effectiveCp(secondLineBefore) : null

  return {
    cpLoss: Math.max(0, evalBeforeMoverCp - evalAfterMoverCp),
    evalBeforeMoverCp,
    evalAfterMoverCp,
    secondBestMoverCp,
    isBestMove: bestLineBefore.moveUci === playedMoveUci
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/engineMath.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/engineMath.ts src/shared/engineMath.test.ts
git commit -m "Add shared engine-math: cp-to-win% and per-move eval delta"
```

---

### Task 4: Accuracy formula

**Files:**
- Create: `src/main/analysis/accuracy.ts`
- Test: `src/main/analysis/accuracy.test.ts`

**Interfaces:**
- Consumes: `MoveEvalDelta` from `src/shared/engineMath.ts` (Task 3).
- Produces: `moveAccuracy(delta: MoveEvalDelta): number` and `gameAccuracy(accuracies: number[]): number` — consumed by `gameAnalyzer.ts` (Task 8).

- [ ] **Step 1: Write the failing test at `src/main/analysis/accuracy.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { moveAccuracy, gameAccuracy } from './accuracy'
import type { MoveEvalDelta } from '../../shared/engineMath'

function delta(overrides: Partial<MoveEvalDelta>): MoveEvalDelta {
  return {
    cpLoss: 0,
    evalBeforeMoverCp: 20,
    evalAfterMoverCp: 20,
    secondBestMoverCp: null,
    isBestMove: true,
    ...overrides
  }
}

describe('moveAccuracy', () => {
  it('is 100 when the position value does not drop', () => {
    expect(moveAccuracy(delta({ evalBeforeMoverCp: 20, evalAfterMoverCp: 20 }))).toBeCloseTo(100, 1)
  })

  it('is close to 100 when the position improves', () => {
    expect(moveAccuracy(delta({ evalBeforeMoverCp: 20, evalAfterMoverCp: 60 }))).toBeCloseTo(100, 1)
  })

  it('drops for a large blunder', () => {
    const accuracy = moveAccuracy(delta({ evalBeforeMoverCp: 100, evalAfterMoverCp: -900 }))
    expect(accuracy).toBeLessThan(40)
  })

  it('never goes below 0 or above 100', () => {
    const veryBad = moveAccuracy(delta({ evalBeforeMoverCp: 100000, evalAfterMoverCp: -100000 }))
    expect(veryBad).toBeGreaterThanOrEqual(0)
    expect(veryBad).toBeLessThanOrEqual(100)
  })
})

describe('gameAccuracy', () => {
  it('averages the given move accuracies', () => {
    expect(gameAccuracy([100, 80, 60])).toBeCloseTo(80, 5)
  })

  it('returns 100 for a game with no moves', () => {
    expect(gameAccuracy([])).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/analysis/accuracy.test.ts`
Expected: FAIL — `Cannot find module './accuracy'`.

- [ ] **Step 3: Write `src/main/analysis/accuracy.ts`**

```ts
import { cpToWinPercent } from '../../shared/engineMath'
import type { MoveEvalDelta } from '../../shared/engineMath'

export function moveAccuracy(delta: MoveEvalDelta): number {
  const winPercentBefore = cpToWinPercent(delta.evalBeforeMoverCp)
  const winPercentAfter = cpToWinPercent(delta.evalAfterMoverCp)
  const drop = Math.max(0, winPercentBefore - winPercentAfter)
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669
  return Math.min(100, Math.max(0, raw))
}

export function gameAccuracy(accuracies: number[]): number {
  if (accuracies.length === 0) return 100
  const sum = accuracies.reduce((total, value) => total + value, 0)
  return sum / accuracies.length
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/analysis/accuracy.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/analysis/accuracy.ts src/main/analysis/accuracy.test.ts
git commit -m "Add per-move and per-game accuracy formulas"
```

---

### Task 5: Opening book & move classification

**Files:**
- Create: `src/main/analysis/openingBook.ts`
- Test: `src/main/analysis/openingBook.test.ts`
- Create: `src/main/analysis/classification.ts`
- Test: `src/main/analysis/classification.test.ts`

**Interfaces:**
- Consumes: `MoveClassification` from `src/shared/types.ts` (Task 2).
- Produces: `isBookMove(sanHistory: string[], ply: number): boolean` and `classifyMove(input: ClassifyMoveInput): MoveClassification` — both consumed by `gameAnalyzer.ts` (Task 8).

- [ ] **Step 1: Write the failing test at `src/main/analysis/openingBook.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { isBookMove } from './openingBook'

describe('isBookMove', () => {
  it('recognizes the start of the Ruy Lopez', () => {
    const history = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']
    expect(isBookMove(history, 3)).toBe(true)
    expect(isBookMove(history, 5)).toBe(true)
  })

  it('returns false once the game diverges from every known book line', () => {
    const history = ['e4', 'c5', 'Nf3', 'e6']
    expect(isBookMove(history, 4)).toBe(false)
  })

  it('returns false for an opening not in the book', () => {
    expect(isBookMove(['a4'], 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/analysis/openingBook.test.ts`
Expected: FAIL — `Cannot find module './openingBook'`.

- [ ] **Step 3: Write `src/main/analysis/openingBook.ts`**

```ts
export const OPENING_BOOK_LINES: string[][] = [
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
  ['e4', 'e5', 'Nf3', 'Nf6'],
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'],
  ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4'],
  ['e4', 'c6', 'd4', 'd5'],
  ['e4', 'e6', 'd4', 'd5'],
  ['e4', 'd5'],
  ['e4', 'g6'],
  ['e4', 'Nf6'],
  ['d4', 'd5', 'c4'],
  ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
  ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
  ['d4', 'f5'],
  ['c4'],
  ['Nf3', 'd5', 'g3']
]

export function isBookMove(sanHistory: string[], ply: number): boolean {
  const movesSoFar = sanHistory.slice(0, ply)
  return OPENING_BOOK_LINES.some(
    (line) => line.length >= movesSoFar.length && movesSoFar.every((san, i) => line[i] === san)
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/analysis/openingBook.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test at `src/main/analysis/classification.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { classifyMove } from './classification'
import type { ClassifyMoveInput } from './classification'

function input(overrides: Partial<ClassifyMoveInput>): ClassifyMoveInput {
  return {
    cpLoss: 0,
    isBestMove: true,
    isBookMove: false,
    isPotentialSacrifice: false,
    evalBeforeMoverCp: 20,
    secondBestMoverCp: null,
    ...overrides
  }
}

describe('classifyMove', () => {
  it('classifies book moves regardless of other inputs', () => {
    expect(classifyMove(input({ isBookMove: true, cpLoss: 500 }))).toBe('book')
  })

  it('classifies a plain best move as best', () => {
    expect(classifyMove(input({ isBestMove: true }))).toBe('best')
  })

  it('classifies a sacrifice-and-best move in a balanced position as brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, isPotentialSacrifice: true, evalBeforeMoverCp: 50 }))
    ).toBe('brilliant')
  })

  it('does not call an obviously winning sacrifice brilliant', () => {
    expect(
      classifyMove(input({ isBestMove: true, isPotentialSacrifice: true, evalBeforeMoverCp: 900 }))
    ).toBe('best')
  })

  it('classifies the only good move in a critical position as great', () => {
    expect(
      classifyMove(input({ isBestMove: true, evalBeforeMoverCp: 50, secondBestMoverCp: -150 }))
    ).toBe('great')
  })

  it.each([
    [10, 'excellent'],
    [35, 'good'],
    [80, 'inaccuracy'],
    [150, 'mistake'],
    [400, 'blunder']
  ])('classifies a non-best move with cpLoss %i as %s', (cpLoss, expected) => {
    expect(classifyMove(input({ isBestMove: false, cpLoss }))).toBe(expected)
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/main/analysis/classification.test.ts`
Expected: FAIL — `Cannot find module './classification'`.

- [ ] **Step 7: Write `src/main/analysis/classification.ts`**

```ts
import type { MoveClassification } from '../../shared/types'

export interface ClassifyMoveInput {
  cpLoss: number
  isBestMove: boolean
  isBookMove: boolean
  isPotentialSacrifice: boolean
  evalBeforeMoverCp: number
  secondBestMoverCp: number | null
}

const CP_LOSS_TIERS: Array<{ max: number; label: MoveClassification }> = [
  { max: 20, label: 'excellent' },
  { max: 50, label: 'good' },
  { max: 100, label: 'inaccuracy' },
  { max: 200, label: 'mistake' },
  { max: Infinity, label: 'blunder' }
]

const CRITICAL_POSITION_CP_CEILING = 600
const GREAT_MOVE_GAP_CP = 150

export function classifyMove(input: ClassifyMoveInput): MoveClassification {
  if (input.isBookMove) return 'book'

  if (input.isBestMove) {
    const isCriticalPosition = Math.abs(input.evalBeforeMoverCp) < CRITICAL_POSITION_CP_CEILING

    if (input.isPotentialSacrifice && isCriticalPosition) return 'brilliant'

    const gapToSecondBest =
      input.secondBestMoverCp === null ? Infinity : input.evalBeforeMoverCp - input.secondBestMoverCp
    if (gapToSecondBest >= GREAT_MOVE_GAP_CP && isCriticalPosition) return 'great'

    return 'best'
  }

  const tier = CP_LOSS_TIERS.find((t) => input.cpLoss <= t.max)
  return tier ? tier.label : 'blunder'
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/main/analysis/classification.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 9: Commit**

```bash
git add src/main/analysis/openingBook.ts src/main/analysis/openingBook.test.ts src/main/analysis/classification.ts src/main/analysis/classification.test.ts
git commit -m "Add opening book matcher and move classification"
```

---

### Task 6: Stockfish UCI manager

**Files:**
- Create: `src/main/engine/stockfishManager.ts`
- Test: `src/main/engine/stockfishManager.test.ts`

**Interfaces:**
- Consumes: `EngineLine`, `PositionEvaluation` from `src/shared/types.ts` (Task 2).
- Produces: `class StockfishManager` with `start(): Promise<void>`, `evaluatePosition(fen: string, options: { depth: number; multiPv?: number }): Promise<PositionEvaluation>`, `stop(): void` — consumed by `gameAnalyzer.ts` (Task 8) and `ipc/handlers.ts` (Task 10).

- [ ] **Step 1: Write the failing test at `src/main/engine/stockfishManager.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { StockfishManager } from './stockfishManager'

function createFakeProcess(): {
  proc: ChildProcessWithoutNullStreams
  stdout: EventEmitter
  written: string[]
} {
  const stdout = new EventEmitter()
  const written: string[] = []

  const fakeProc = {
    stdout,
    stdin: {
      write: (data: string) => {
        written.push(data)
        const command = data.trim()
        if (command === 'uci') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('uciok\n')))
        } else if (command === 'isready') {
          queueMicrotask(() => stdout.emit('data', Buffer.from('readyok\n')))
        }
      }
    },
    kill: vi.fn()
  }

  return { proc: fakeProc as unknown as ChildProcessWithoutNullStreams, stdout, written }
}

describe('StockfishManager', () => {
  it('completes the UCI handshake on start()', async () => {
    const { proc, written } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)

    await manager.start()

    expect(written).toContain('uci\n')
    expect(written).toContain('isready\n')
    expect(written).toContain('ucinewgame\n')
  })

  it('parses multipv evaluation lines and returns them sorted best-first', async () => {
    const { proc, stdout } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    const evalPromise = manager.evaluatePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { depth: 15, multiPv: 2 }
    )

    stdout.emit(
      'data',
      Buffer.from(
        [
          'info depth 15 seldepth 20 multipv 1 score cp 32 nodes 500000 nps 900000 pv e2e4 e7e5 g1f3',
          'info depth 15 seldepth 20 multipv 2 score cp -5 nodes 500000 nps 900000 pv d2d4 d7d5',
          'bestmove e2e4 ponder e7e5'
        ].join('\n') + '\n'
      )
    )

    const evaluation = await evalPromise

    expect(evaluation.lines).toHaveLength(2)
    expect(evaluation.lines[0]).toMatchObject({ scoreCp: 32, moveUci: 'e2e4', depth: 15 })
    expect(evaluation.lines[1]).toMatchObject({ scoreCp: -5, moveUci: 'd2d4', depth: 15 })
  })

  it('parses mate scores', async () => {
    const { proc, stdout } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    const evalPromise = manager.evaluatePosition(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { depth: 10, multiPv: 1 }
    )

    stdout.emit(
      'data',
      Buffer.from('info depth 10 multipv 1 score mate 3 nodes 1000 nps 1000 pv f7f6 g2g4 f6f5\nbestmove f7f6\n')
    )

    const evaluation = await evalPromise

    expect(evaluation.lines[0]).toMatchObject({ scoreMate: 3, scoreCp: null, moveUci: 'f7f6' })
  })

  it('stop() kills the subprocess', async () => {
    const { proc } = createFakeProcess()
    const manager = new StockfishManager('/fake/path/to/stockfish', () => proc)
    await manager.start()

    manager.stop()

    expect(proc.kill).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/engine/stockfishManager.test.ts`
Expected: FAIL — `Cannot find module './stockfishManager'`.

- [ ] **Step 3: Write `src/main/engine/stockfishManager.ts`**

```ts
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { EngineLine, PositionEvaluation } from '../../shared/types'

export type SpawnFn = (command: string, args: string[]) => ChildProcessWithoutNullStreams

export class StockfishManager {
  private process: ChildProcessWithoutNullStreams | null = null
  private lineBuffer = ''
  private pendingLineHandlers: Array<(line: string) => void> = []

  constructor(
    private readonly binaryPath: string,
    private readonly spawnFn: SpawnFn = spawn as SpawnFn
  ) {}

  async start(): Promise<void> {
    this.process = this.spawnFn(this.binaryPath, [])
    this.process.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    await this.sendAndWaitForLine('uci', (line) => line === 'uciok')
    await this.sendAndWaitForLine('isready', (line) => line === 'readyok')
    this.send('ucinewgame')
  }

  async evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number }
  ): Promise<PositionEvaluation> {
    const multiPv = options.multiPv ?? 2
    this.send(`setoption name MultiPV value ${multiPv}`)
    this.send(`position fen ${fen}`)

    const linesByMultiPv = new Map<number, EngineLine>()

    await new Promise<void>((resolve) => {
      const handler = (line: string): void => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const parsed = parseInfoLine(line)
          if (parsed) linesByMultiPv.set(parsed.multiPv, parsed.line)
        } else if (line.startsWith('bestmove')) {
          this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
          resolve()
        }
      }
      this.pendingLineHandlers.push(handler)
      this.send(`go depth ${options.depth}`)
    })

    const lines = Array.from(linesByMultiPv.entries())
      .sort(([a], [b]) => a - b)
      .map(([, evalLine]) => evalLine)

    return { lines }
  }

  stop(): void {
    this.process?.kill()
    this.process = null
  }

  private onData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString()
    const lines = this.lineBuffer.split('\n')
    this.lineBuffer = lines.pop() ?? ''
    for (const rawLine of lines) {
      const trimmed = rawLine.trim()
      if (trimmed.length === 0) continue
      for (const handler of [...this.pendingLineHandlers]) {
        handler(trimmed)
      }
    }
  }

  private send(command: string): void {
    if (!this.process) throw new Error('StockfishManager: engine not started')
    this.process.stdin.write(`${command}\n`)
  }

  private sendAndWaitForLine(command: string, matches: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const handler = (line: string): void => {
        if (matches(line)) {
          this.pendingLineHandlers = this.pendingLineHandlers.filter((h) => h !== handler)
          resolve()
        }
      }
      this.pendingLineHandlers.push(handler)
      this.send(command)
    })
  }
}

function parseInfoLine(line: string): { multiPv: number; line: EngineLine } | null {
  const tokens = line.split(' ')
  const get = (key: string): string | null => {
    const idx = tokens.indexOf(key)
    return idx === -1 ? null : tokens[idx + 1]
  }

  const depthStr = get('depth')
  if (!depthStr) return null

  const multiPvStr = get('multipv')
  const multiPv = multiPvStr ? Number(multiPvStr) : 1

  const scoreCpStr = get('cp')
  const scoreMateStr = get('mate')

  const pvIdx = tokens.indexOf('pv')
  const pv = pvIdx === -1 ? [] : tokens.slice(pvIdx + 1)
  if (pv.length === 0) return null

  return {
    multiPv,
    line: {
      depth: Number(depthStr),
      scoreCp: scoreCpStr ? Number(scoreCpStr) : null,
      scoreMate: scoreMateStr ? Number(scoreMateStr) : null,
      moveUci: pv[0],
      pv
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/engine/stockfishManager.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/engine/stockfishManager.ts src/main/engine/stockfishManager.test.ts
git commit -m "Add Stockfish UCI manager with MultiPV support"
```

---

### Task 7: Stockfish download script & binary path resolution

**Files:**
- Create: `scripts/downloadStockfish.mjs`
- Create: `src/main/engine/stockfishPath.ts`

**Interfaces:**
- Produces: a working `vendor/stockfish/stockfish` (or `.exe`) binary on disk, and `getStockfishBinaryPath(): string` — consumed by `ipc/handlers.ts` (Task 10). No automated test (network/OS operation); verified manually.

- [ ] **Step 1: Write `scripts/downloadStockfish.mjs`**

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, chmodSync, existsSync, rmSync, renameSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STOCKFISH_RELEASE_TAG = 'sf_18'
const VENDOR_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'vendor', 'stockfish')

const PLATFORM_ASSETS = {
  'linux-x64': {
    asset: 'stockfish-ubuntu-x86-64.tar',
    binaryInArchive: 'stockfish/stockfish-ubuntu-x86-64'
  },
  'darwin-x64': {
    asset: 'stockfish-macos-x86-64.tar',
    binaryInArchive: 'stockfish/stockfish-macos-x86-64'
  },
  'darwin-arm64': {
    asset: 'stockfish-macos-m1-apple-silicon.tar',
    binaryInArchive: 'stockfish/stockfish-macos-m1-apple-silicon'
  },
  'win32-x64': {
    asset: 'stockfish-windows-x86-64.zip',
    binaryInArchive: 'stockfish/stockfish-windows-x86-64.exe'
  }
}

function resolvePlatformKey() {
  const key = `${process.platform}-${process.arch}`
  if (!(key in PLATFORM_ASSETS)) {
    throw new Error(
      `Unsupported platform/arch: ${key}. Supported: ${Object.keys(PLATFORM_ASSETS).join(', ')}`
    )
  }
  return key
}

async function downloadFile(url, destPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  await writeFile(destPath, Buffer.from(arrayBuffer))
}

function extractArchive(archivePath, destDir, memberPath) {
  if (archivePath.endsWith('.zip')) {
    execFileSync('powershell', [
      '-Command',
      `Expand-Archive -Path "${archivePath}" -DestinationPath "${destDir}" -Force`
    ])
  } else {
    execFileSync('tar', ['xf', archivePath, '-C', destDir, memberPath])
  }
}

async function main() {
  const platformKey = resolvePlatformKey()
  const { asset, binaryInArchive } = PLATFORM_ASSETS[platformKey]
  const finalBinaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const finalBinaryPath = join(VENDOR_DIR, finalBinaryName)

  if (existsSync(finalBinaryPath)) {
    console.log(`Stockfish already present at ${finalBinaryPath}`)
    return
  }

  mkdirSync(VENDOR_DIR, { recursive: true })
  const archivePath = join(VENDOR_DIR, asset)
  const downloadUrl = `https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_RELEASE_TAG}/${asset}`

  console.log(`Downloading ${downloadUrl} ...`)
  await downloadFile(downloadUrl, archivePath)

  console.log('Extracting...')
  extractArchive(archivePath, VENDOR_DIR, binaryInArchive)

  const extractedPath = join(VENDOR_DIR, binaryInArchive)
  renameSync(extractedPath, finalBinaryPath)
  rmSync(join(VENDOR_DIR, 'stockfish'), { recursive: true, force: true })
  rmSync(archivePath, { force: true })

  if (process.platform !== 'win32') {
    chmodSync(finalBinaryPath, 0o755)
  }

  console.log(`Stockfish installed at ${finalBinaryPath}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
```

- [ ] **Step 2: Write `src/main/engine/stockfishPath.ts`**

```ts
import { app } from 'electron'
import { join } from 'node:path'

export function getStockfishBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  return join(app.getAppPath(), 'vendor', 'stockfish', binaryName)
}
```

- [ ] **Step 3: Run the download script**

Run: `npm run setup:stockfish`
Expected: downloads and extracts to `vendor/stockfish/stockfish` (or `.exe` on Windows), prints `Stockfish installed at ...`.

- [ ] **Step 4: Manually verify the binary works**

Run: `echo -e "uci\nisready\nposition startpos\ngo depth 10\nquit" | ./vendor/stockfish/stockfish`
Expected: prints engine options, then `uciok`, `readyok`, several `info depth ... score cp ... pv ...` lines, and a final `bestmove ...` line.

- [ ] **Step 5: Commit**

```bash
git add scripts/downloadStockfish.mjs src/main/engine/stockfishPath.ts
git commit -m "Add Stockfish download script and binary path resolution"
```

(`vendor/stockfish/` itself is not committed — already excluded by `.gitignore` from the initial repo setup.)

---

### Task 8: Game analysis orchestrator

**Files:**
- Create: `src/main/analysis/gameAnalyzer.ts`
- Test: `src/main/analysis/gameAnalyzer.test.ts`

**Interfaces:**
- Consumes: `AnalyzedPosition`, `AnalyzedMove`, `GameAnalysisResult`, `PositionEvaluation` (Task 2); `computeMoveEvalDelta` (Task 3); `classifyMove` (Task 5); `isBookMove` (Task 5); `moveAccuracy`, `gameAccuracy` (Task 4).
- Produces: `analyzeGame(positions, engine, options): Promise<GameAnalysisResult | { cancelled: true }>` — consumed by `ipc/handlers.ts` (Task 10). Takes any object shaped like `{ evaluatePosition(fen, opts): Promise<PositionEvaluation> }` for `engine`, so `StockfishManager` (Task 6) satisfies it structurally.

- [ ] **Step 1: Write the failing test at `src/main/analysis/gameAnalyzer.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { analyzeGame } from './gameAnalyzer'
import type { AnalyzedPosition, PositionEvaluation } from '../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E5_FEN = 'rnbqkbnr/ppp1pppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

const positions: AnalyzedPosition[] = [
  {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'e4',
    moveUci: 'e2e4',
    fenBefore: START_FEN,
    fenAfter: AFTER_E4_FEN,
    isPotentialSacrifice: false
  },
  {
    ply: 2,
    moveNumber: 1,
    color: 'b',
    san: 'e5',
    moveUci: 'e7e5',
    fenBefore: AFTER_E4_FEN,
    fenAfter: AFTER_E5_FEN,
    isPotentialSacrifice: false
  }
]

function evalFor(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

const evalsByFen: Record<string, PositionEvaluation> = {
  [START_FEN]: evalFor(30, 'e2e4'),
  [AFTER_E4_FEN]: evalFor(-25, 'e7e5'),
  [AFTER_E5_FEN]: evalFor(20, 'g1f3')
}

const fakeEngine = {
  evaluatePosition: async (fen: string): Promise<PositionEvaluation> => {
    const evaluation = evalsByFen[fen]
    if (!evaluation) throw new Error(`No fixture eval for fen: ${fen}`)
    return evaluation
  }
}

describe('analyzeGame', () => {
  it('evaluates each unique position exactly once and produces one AnalyzedMove per position', async () => {
    const seenFens: string[] = []
    const engine = {
      evaluatePosition: async (fen: string) => {
        seenFens.push(fen)
        return fakeEngine.evaluatePosition(fen)
      }
    }

    const result = await analyzeGame(positions, engine, { depth: 18 })

    expect(seenFens).toEqual([START_FEN, AFTER_E4_FEN, AFTER_E5_FEN])
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.moves).toHaveLength(2)
    expect(result.moves[0].san).toBe('e4')
    expect(result.moves[0].classification).toBe('book')
  })

  it('reports progress via onMove as each move is analyzed', async () => {
    const seenMoves: string[] = []
    await analyzeGame(positions, fakeEngine, {
      depth: 18,
      onMove: (move) => seenMoves.push(move.san)
    })
    expect(seenMoves).toEqual(['e4', 'e5'])
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    const result = await analyzeGame(positions, fakeEngine, {
      depth: 18,
      isCancelled: () => true
    })
    expect(result).toEqual({ cancelled: true })
  })

  it('returns 100% accuracy for an empty game', async () => {
    const result = await analyzeGame([], fakeEngine, { depth: 18 })
    if ('cancelled' in result) throw new Error('unexpected cancellation')
    expect(result.whiteAccuracy).toBe(100)
    expect(result.blackAccuracy).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/analysis/gameAnalyzer.test.ts`
Expected: FAIL — `Cannot find module './gameAnalyzer'`.

- [ ] **Step 3: Write `src/main/analysis/gameAnalyzer.ts`**

```ts
import type { AnalyzedPosition, AnalyzedMove, GameAnalysisResult, PositionEvaluation } from '../../shared/types'
import { computeMoveEvalDelta } from '../../shared/engineMath'
import { classifyMove } from './classification'
import { isBookMove } from './openingBook'
import { moveAccuracy, gameAccuracy } from './accuracy'

export interface EvaluationEngine {
  evaluatePosition(
    fen: string,
    options: { depth: number; multiPv?: number }
  ): Promise<PositionEvaluation>
}

export interface AnalyzeGameOptions {
  depth: number
  onMove?: (move: AnalyzedMove) => void
  isCancelled?: () => boolean
}

export async function analyzeGame(
  positions: AnalyzedPosition[],
  engine: EvaluationEngine,
  options: AnalyzeGameOptions
): Promise<GameAnalysisResult | { cancelled: true }> {
  if (positions.length === 0) {
    return { moves: [], whiteAccuracy: 100, blackAccuracy: 100 }
  }

  const sanHistory = positions.map((p) => p.san)
  const moves: AnalyzedMove[] = []

  if (options.isCancelled?.()) return { cancelled: true }
  let previousEval = await engine.evaluatePosition(positions[0].fenBefore, { depth: options.depth })

  for (const position of positions) {
    if (options.isCancelled?.()) return { cancelled: true }
    const currentEval = await engine.evaluatePosition(position.fenAfter, { depth: options.depth })

    const delta = computeMoveEvalDelta(previousEval, currentEval, position.moveUci)
    const classification = classifyMove({
      cpLoss: delta.cpLoss,
      isBestMove: delta.isBestMove,
      isBookMove: isBookMove(sanHistory, position.ply),
      isPotentialSacrifice: position.isPotentialSacrifice,
      evalBeforeMoverCp: delta.evalBeforeMoverCp,
      secondBestMoverCp: delta.secondBestMoverCp
    })

    const move: AnalyzedMove = {
      ...position,
      evalBefore: previousEval,
      evalAfter: currentEval,
      classification,
      accuracy: moveAccuracy(delta)
    }
    moves.push(move)
    options.onMove?.(move)

    previousEval = currentEval
  }

  const whiteAccuracy = gameAccuracy(moves.filter((m) => m.color === 'w').map((m) => m.accuracy))
  const blackAccuracy = gameAccuracy(moves.filter((m) => m.color === 'b').map((m) => m.accuracy))

  return { moves, whiteAccuracy, blackAccuracy }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/analysis/gameAnalyzer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/analysis/gameAnalyzer.ts src/main/analysis/gameAnalyzer.test.ts
git commit -m "Add game analysis orchestrator with streaming progress and cancellation"
```

---

### Task 9: Chess.com API client

**Files:**
- Create: `src/main/chesscom/chessComClient.ts`
- Test: `src/main/chesscom/chessComClient.test.ts`

**Interfaces:**
- Consumes: `ChessComGameSummary` from `src/shared/types.ts` (Task 2).
- Produces: `fetchRecentGames(username: string, limit?: number): Promise<ChessComGameSummary[]>` and `ChessComFetchError` — consumed by `ipc/handlers.ts` (Task 10).

- [ ] **Step 1: Write the failing test at `src/main/chesscom/chessComClient.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRecentGames, ChessComFetchError } from './chessComClient'

describe('fetchRecentGames', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns games from the most recent archive, newest first', async () => {
    const archivesResponse = {
      archives: [
        'https://api.chess.com/pub/player/testuser/games/2026/06',
        'https://api.chess.com/pub/player/testuser/games/2026/07'
      ]
    }
    const gamesResponse = {
      games: [
        {
          url: 'https://www.chess.com/game/live/1',
          pgn: '1. e4 e5',
          end_time: 1000,
          time_control: '600',
          white: { username: 'testuser', rating: 1500, result: 'win' },
          black: { username: 'opponent', rating: 1490, result: 'checkmated' }
        },
        {
          url: 'https://www.chess.com/game/live/2',
          pgn: '1. d4 d5',
          end_time: 2000,
          time_control: '600',
          white: { username: 'opponent2', rating: 1600, result: 'win' },
          black: { username: 'testuser', rating: 1500, result: 'resigned' }
        }
      ]
    }

    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().endsWith('/archives')) {
        return new Response(JSON.stringify(archivesResponse), { status: 200 })
      }
      return new Response(JSON.stringify(gamesResponse), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const games = await fetchRecentGames('testuser', 10)

    expect(games).toHaveLength(2)
    expect(games[0].url).toBe('https://www.chess.com/game/live/2')
    expect(games[1].url).toBe('https://www.chess.com/game/live/1')
  })

  it('throws ChessComFetchError when the user does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(fetchRecentGames('nobody')).rejects.toThrow(ChessComFetchError)
  })

  it('throws ChessComFetchError for an empty username', async () => {
    await expect(fetchRecentGames('   ')).rejects.toThrow(ChessComFetchError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/chesscom/chessComClient.test.ts`
Expected: FAIL — `Cannot find module './chessComClient'`.

- [ ] **Step 3: Write `src/main/chesscom/chessComClient.ts`**

```ts
import type { ChessComGameSummary } from '../../shared/types'

const USER_AGENT = 'chess-analyzer (personal, non-commercial use)'

export class ChessComFetchError extends Error {}

interface ChessComArchivesResponse {
  archives: string[]
}

interface ChessComGamesResponse {
  games: Array<{
    url: string
    pgn?: string
    end_time: number
    time_control: string
    white: { username: string; rating: number; result: string }
    black: { username: string; rating: number; result: string }
  }>
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    throw new ChessComFetchError(`Network error contacting chess.com: ${(err as Error).message}`)
  }
  if (response.status === 404) {
    throw new ChessComFetchError('Chess.com user not found')
  }
  if (response.status === 429) {
    throw new ChessComFetchError('Chess.com rate-limited this request. Try again in a moment.')
  }
  if (!response.ok) {
    throw new ChessComFetchError(`Chess.com request failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export async function fetchRecentGames(
  username: string,
  limit = 20
): Promise<ChessComGameSummary[]> {
  const trimmedUsername = username.trim().toLowerCase()
  if (trimmedUsername.length === 0) {
    throw new ChessComFetchError('Enter a chess.com username')
  }

  const { archives } = await fetchJson<ChessComArchivesResponse>(
    `https://api.chess.com/pub/player/${trimmedUsername}/games/archives`
  )

  if (archives.length === 0) {
    throw new ChessComFetchError(`${username} has no games on chess.com`)
  }

  const games: ChessComGameSummary[] = []
  for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
    const { games: monthGames } = await fetchJson<ChessComGamesResponse>(archives[i])
    for (const game of [...monthGames].reverse()) {
      if (!game.pgn) continue
      games.push({
        url: game.url,
        pgn: game.pgn,
        endTime: game.end_time,
        timeControl: game.time_control,
        white: game.white,
        black: game.black
      })
      if (games.length >= limit) break
    }
  }

  return games
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/chesscom/chessComClient.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/chesscom/chessComClient.ts src/main/chesscom/chessComClient.test.ts
git commit -m "Add chess.com Published-Data API client"
```

---

### Task 10: Electron main process wiring (IPC, preload, window)

**Files:**
- Create: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts` (replace Task 1's stub)
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts` (wire up `registerIpcHandlers`)

**Interfaces:**
- Consumes: `StockfishManager` (Task 6), `getStockfishBinaryPath` (Task 7), `analyzeGame` (Task 8), `fetchRecentGames`/`ChessComFetchError` (Task 9), `ChessAPI`/`AnalyzedPosition` (Task 2).
- Produces: `window.chessAPI` (the `ChessAPI` interface) available in the renderer — consumed by every renderer task from here on (11-14).

- [ ] **Step 1: Write `src/shared/ipc.ts`**

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games'
} as const
```

- [ ] **Step 2: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AnalyzedPosition, AnalyzedMove, ChessAPI } from '../shared/types'

const chessAPI: ChessAPI = {
  analyzeGame: (positions: AnalyzedPosition[], depth: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.analyzeGame, positions, depth),
  onAnalysisProgress: (callback: (move: AnalyzedMove) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, move: AnalyzedMove): void => callback(move)
    ipcRenderer.on(IPC_CHANNELS.analysisProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.analysisProgress, handler)
  },
  cancelAnalysis: () => ipcRenderer.send(IPC_CHANNELS.cancelAnalysis),
  openPgnFile: () => ipcRenderer.invoke(IPC_CHANNELS.openPgnFile),
  fetchChessComGames: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchChessComGames, username)
}

contextBridge.exposeInMainWorld('chessAPI', chessAPI)
```

- [ ] **Step 3: Write `src/main/ipc/handlers.ts`**

```ts
import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { AnalyzedPosition } from '../../shared/types'
import { StockfishManager } from '../engine/stockfishManager'
import { getStockfishBinaryPath } from '../engine/stockfishPath'
import { analyzeGame } from '../analysis/gameAnalyzer'
import { fetchRecentGames, ChessComFetchError } from '../chesscom/chessComClient'

const ANALYSIS_DEPTH_DEFAULT = 18

let cancelCurrentAnalysis = false

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(
    IPC_CHANNELS.analyzeGame,
    async (_event, positions: AnalyzedPosition[], depth: number) => {
      cancelCurrentAnalysis = false
      const engine = new StockfishManager(getStockfishBinaryPath())

      try {
        await engine.start()
      } catch (err) {
        return { error: `Could not start Stockfish: ${(err as Error).message}` }
      }

      try {
        return await analyzeGame(positions, engine, {
          depth: depth || ANALYSIS_DEPTH_DEFAULT,
          isCancelled: () => cancelCurrentAnalysis,
          onMove: (move) => {
            getWindow()?.webContents.send(IPC_CHANNELS.analysisProgress, move)
          }
        })
      } catch (err) {
        return { error: `Analysis failed: ${(err as Error).message}` }
      } finally {
        engine.stop()
      }
    }
  )

  ipcMain.on(IPC_CHANNELS.cancelAnalysis, () => {
    cancelCurrentAnalysis = true
  })

  ipcMain.handle(IPC_CHANNELS.openPgnFile, async () => {
    const window = getWindow()
    if (!window) return { cancelled: true }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'PGN files', extensions: ['pgn'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { cancelled: true }
    }

    try {
      const pgn = await readFile(result.filePaths[0], 'utf-8')
      return { pgn }
    } catch (err) {
      return { error: `Could not read file: ${(err as Error).message}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.fetchChessComGames, async (_event, username: string) => {
    try {
      return await fetchRecentGames(username)
    } catch (err) {
      if (err instanceof ChessComFetchError) return { error: err.message }
      return { error: `Unexpected error: ${(err as Error).message}` }
    }
  })
}
```

- [ ] **Step 4: Modify `src/main/index.ts` to register the handlers**

Replace the `app.whenReady().then(...)` block with:

```ts
import { registerIpcHandlers } from './ipc/handlers'

// ... (keep createWindow as-is)

app.whenReady().then(() => {
  registerIpcHandlers(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

(Add the `import { registerIpcHandlers } from './ipc/handlers'` line at the top of the file alongside the existing imports; replace only the body of `app.whenReady().then(...)`, keep everything else in the file unchanged.)

- [ ] **Step 5: Manually verify the IPC surface**

Run: `npm run dev`, open DevTools in the app window (View menu or Ctrl+Shift+I), and in the console run:

```js
await window.chessAPI.fetchChessComGames('hikaru')
```

Expected: resolves to an array of game summary objects (or `{ error: ... }` if offline — either is fine, it confirms the IPC round-trip works).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc/handlers.ts src/main/index.ts
git commit -m "Wire up Electron IPC: analyze-game, open-pgn-file, chesscom fetch"
```

---

### Task 11: Renderer analysis state (reducer + hook)

**Files:**
- Create: `src/renderer/src/lib/analysisReducer.ts`
- Test: `src/renderer/src/lib/analysisReducer.test.ts`
- Create: `src/renderer/src/hooks/useGameAnalysis.ts`
- Create: `src/renderer/src/env.d.ts`

**Interfaces:**
- Consumes: `AnalyzedPosition`, `AnalyzedMove`, `GameAnalysisResult`, `ChessAPI` from `src/shared/types.ts` (Task 2); `window.chessAPI` from Task 10.
- Produces: `analysisReducer`, `INITIAL_STATE`, `AnalysisState`, `AnalysisAction` types; `useGameAnalysis()` hook returning `{ state, startAnalysis, cancelAnalysis, reset }` — consumed by `App.tsx` (Task 14).

- [ ] **Step 1: Write the failing test at `src/renderer/src/lib/analysisReducer.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { analysisReducer, INITIAL_STATE } from './analysisReducer'
import type { AnalyzedMove, AnalyzedPosition, GameAnalysisResult } from '../../../shared/types'

const fakePosition: AnalyzedPosition = {
  ply: 1,
  moveNumber: 1,
  color: 'w',
  san: 'e4',
  moveUci: 'e2e4',
  fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  isPotentialSacrifice: false
}

const fakeMove: AnalyzedMove = {
  ...fakePosition,
  evalBefore: { lines: [] },
  evalAfter: { lines: [] },
  classification: 'best',
  accuracy: 95
}

describe('analysisReducer', () => {
  it('resets to analyzing state on START', () => {
    const state = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    expect(state.status).toBe('analyzing')
    expect(state.positions).toEqual([fakePosition])
    expect(state.moves).toEqual([])
  })

  it('appends moves on MOVE_PROGRESS', () => {
    const started = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    const withMove = analysisReducer(started, { type: 'MOVE_PROGRESS', move: fakeMove })
    expect(withMove.moves).toEqual([fakeMove])
    expect(withMove.progressCount).toBe(1)
  })

  it('stores accuracies on COMPLETE', () => {
    const result: GameAnalysisResult = { moves: [fakeMove], whiteAccuracy: 91.2, blackAccuracy: 88.4 }
    const state = analysisReducer(INITIAL_STATE, { type: 'COMPLETE', result })
    expect(state.status).toBe('done')
    expect(state.whiteAccuracy).toBe(91.2)
    expect(state.blackAccuracy).toBe(88.4)
  })

  it('records the error message on ERROR', () => {
    const state = analysisReducer(INITIAL_STATE, { type: 'ERROR', message: 'boom' })
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('RESET returns to the initial state', () => {
    const started = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    const reset = analysisReducer(started, { type: 'RESET' })
    expect(reset).toEqual(INITIAL_STATE)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/lib/analysisReducer.test.ts`
Expected: FAIL — `Cannot find module './analysisReducer'`.

- [ ] **Step 3: Write `src/renderer/src/lib/analysisReducer.ts`**

```ts
import type { AnalyzedMove, AnalyzedPosition, GameAnalysisResult } from '../../../shared/types'

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error' | 'cancelled'

export interface AnalysisState {
  status: AnalysisStatus
  positions: AnalyzedPosition[]
  moves: AnalyzedMove[]
  whiteAccuracy: number | null
  blackAccuracy: number | null
  error: string | null
  progressCount: number
}

export type AnalysisAction =
  | { type: 'START'; positions: AnalyzedPosition[] }
  | { type: 'MOVE_PROGRESS'; move: AnalyzedMove }
  | { type: 'COMPLETE'; result: GameAnalysisResult }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' }

export const INITIAL_STATE: AnalysisState = {
  status: 'idle',
  positions: [],
  moves: [],
  whiteAccuracy: null,
  blackAccuracy: null,
  error: null,
  progressCount: 0
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'START':
      return { ...INITIAL_STATE, status: 'analyzing', positions: action.positions }
    case 'MOVE_PROGRESS':
      return {
        ...state,
        moves: [...state.moves, action.move],
        progressCount: state.progressCount + 1
      }
    case 'COMPLETE':
      return {
        ...state,
        status: 'done',
        moves: action.result.moves,
        whiteAccuracy: action.result.whiteAccuracy,
        blackAccuracy: action.result.blackAccuracy
      }
    case 'CANCELLED':
      return { ...state, status: 'cancelled' }
    case 'ERROR':
      return { ...state, status: 'error', error: action.message }
    case 'RESET':
      return INITIAL_STATE
    default:
      return state
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/lib/analysisReducer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `src/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
import type { ChessAPI } from '../../shared/types'

declare global {
  interface Window {
    chessAPI: ChessAPI
  }
}

export {}
```

- [ ] **Step 6: Write `src/renderer/src/hooks/useGameAnalysis.ts`**

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AnalyzedPosition } from '../../../shared/types'
import { analysisReducer, INITIAL_STATE } from '../lib/analysisReducer'

export function useGameAnalysis(): {
  state: ReturnType<typeof analysisReducer>
  startAnalysis: (positions: AnalyzedPosition[], depth?: number) => Promise<void>
  cancelAnalysis: () => void
  reset: () => void
} {
  const [state, dispatch] = useReducer(analysisReducer, INITIAL_STATE)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    unsubscribeRef.current = window.chessAPI.onAnalysisProgress((move) => {
      dispatch({ type: 'MOVE_PROGRESS', move })
    })
    return () => unsubscribeRef.current?.()
  }, [])

  const startAnalysis = useCallback(async (positions: AnalyzedPosition[], depth = 18) => {
    dispatch({ type: 'START', positions })
    const result = await window.chessAPI.analyzeGame(positions, depth)
    if ('error' in result) {
      dispatch({ type: 'ERROR', message: result.error })
    } else if ('cancelled' in result) {
      dispatch({ type: 'CANCELLED' })
    } else {
      dispatch({ type: 'COMPLETE', result })
    }
  }, [])

  const cancelAnalysis = useCallback(() => {
    window.chessAPI.cancelAnalysis()
  }, [])

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  return { state, startAnalysis, cancelAnalysis, reset }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/lib/analysisReducer.ts src/renderer/src/lib/analysisReducer.test.ts src/renderer/src/hooks/useGameAnalysis.ts src/renderer/src/env.d.ts
git commit -m "Add renderer analysis state: reducer and useGameAnalysis hook"
```

---

### Task 12: Import modal UI

**Files:**
- Create: `src/renderer/src/components/ImportModal.tsx`

**Interfaces:**
- Consumes: `ChessComGameSummary` from `src/shared/types.ts` (Task 2); `window.chessAPI.openPgnFile` / `window.chessAPI.fetchChessComGames` from Task 10.
- Produces: `<ImportModal onGameLoaded={(pgn: string) => void} />` — consumed by `App.tsx` (Task 14). No automated test (UI component); verified manually in Task 14's end-to-end check.

- [ ] **Step 1: Write `src/renderer/src/components/ImportModal.tsx`**

```tsx
import { useState } from 'react'
import type { ChessComGameSummary } from '../../../shared/types'

interface ImportModalProps {
  onGameLoaded: (pgn: string) => void
}

type ImportTab = 'paste' | 'upload' | 'chesscom'

export function ImportModal({ onGameLoaded }: ImportModalProps): JSX.Element {
  const [tab, setTab] = useState<ImportTab>('paste')
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [chessComGames, setChessComGames] = useState<ChessComGameSummary[]>([])
  const [isFetching, setIsFetching] = useState(false)

  const handlePasteSubmit = (): void => {
    if (pasteText.trim().length === 0) {
      setError('Paste some PGN text first')
      return
    }
    setError(null)
    onGameLoaded(pasteText)
  }

  const handleUpload = async (): Promise<void> => {
    setError(null)
    const result = await window.chessAPI.openPgnFile()
    if ('error' in result) {
      setError(result.error)
    } else if (!('cancelled' in result)) {
      onGameLoaded(result.pgn)
    }
  }

  const handleFindGames = async (): Promise<void> => {
    if (username.trim().length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsFetching(true)
    setChessComGames([])
    const result = await window.chessAPI.fetchChessComGames(username)
    setIsFetching(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setChessComGames(result)
    }
  }

  return (
    <div className="import-modal">
      <div className="import-tabs">
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
          Paste PGN
        </button>
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          Upload File
        </button>
        <button className={tab === 'chesscom' ? 'active' : ''} onClick={() => setTab('chesscom')}>
          Chess.com
        </button>
      </div>

      {error && <div className="import-error">{error}</div>}

      {tab === 'paste' && (
        <div className="import-panel">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste PGN text here"
            rows={10}
          />
          <button onClick={handlePasteSubmit}>Load Game</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="import-panel">
          <button onClick={handleUpload}>Choose .pgn File...</button>
        </div>
      )}

      {tab === 'chesscom' && (
        <div className="import-panel">
          <div className="chesscom-search">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="chess.com username"
              onKeyDown={(e) => e.key === 'Enter' && handleFindGames()}
            />
            <button onClick={handleFindGames} disabled={isFetching}>
              {isFetching ? 'Searching...' : 'Find Games'}
            </button>
          </div>
          <ul className="chesscom-game-list">
            {chessComGames.map((game) => (
              <li key={game.url}>
                <button onClick={() => onGameLoaded(game.pgn)}>
                  {game.white.username} ({game.white.rating}) vs {game.black.username} (
                  {game.black.rating}) &mdash; {new Date(game.endTime * 1000).toLocaleDateString()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/components/ImportModal.tsx
git commit -m "Add game import UI: paste, upload, chess.com search"
```

---

### Task 13: Board & eval bar UI

**Files:**
- Create: `src/renderer/src/lib/displayEval.ts`
- Create: `src/renderer/src/lib/gameNavigation.ts`
- Create: `src/renderer/src/components/Board.tsx`
- Create: `src/renderer/src/components/EvalBar.tsx`

**Interfaces:**
- Consumes: `effectiveCp`, `cpToWinPercent` from `src/shared/engineMath.ts` (Task 3); `PositionEvaluation`, `AnalyzedMove` from `src/shared/types.ts` (Task 2).
- Produces: `whiteWinPercent(evaluation, sideToMove): number`, `formatScore(evaluation, sideToMove): string`, `getPositionAtPly(moves, ply): PositionAtPly`, `STARTING_FEN`, `<Board fen bestMoveUci />`, `<EvalBar whiteWinPercent displayScore />` — consumed by `App.tsx` (Task 14). No automated test (visual components + already-tested math); verified manually in Task 14.

- [ ] **Step 1: Install react-chessboard**

Run: `npm install react-chessboard@^5.10.0`

- [ ] **Step 2: Write `src/renderer/src/lib/displayEval.ts`**

```ts
import type { PositionEvaluation } from '../../../shared/types'
import { effectiveCp, cpToWinPercent } from '../../../shared/engineMath'

export function whiteWinPercent(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): number {
  const cpFromSideToMove = effectiveCp(evaluation.lines[0])
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  return cpToWinPercent(cpFromWhite)
}

export function formatScore(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): string {
  const topLine = evaluation.lines[0]
  if (topLine.scoreMate !== null) {
    const mateFromWhite = sideToMove === 'w' ? topLine.scoreMate : -topLine.scoreMate
    return mateFromWhite > 0 ? `M${mateFromWhite}` : `-M${Math.abs(mateFromWhite)}`
  }
  const cpFromSideToMove = topLine.scoreCp ?? 0
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  const pawns = cpFromWhite / 100
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2)
}
```

- [ ] **Step 3: Write `src/renderer/src/lib/gameNavigation.ts`**

```ts
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface PositionAtPly {
  fen: string
  evaluation: PositionEvaluation | null
  sideToMove: 'w' | 'b'
  bestMoveUci: string | null
}

export function getPositionAtPly(moves: AnalyzedMove[], ply: number): PositionAtPly {
  if (ply <= 0 || moves.length === 0) {
    const first = moves[0]
    return {
      fen: first ? first.fenBefore : STARTING_FEN,
      evaluation: first ? first.evalBefore : null,
      sideToMove: 'w',
      bestMoveUci: first ? first.evalBefore.lines[0]?.moveUci ?? null : null
    }
  }
  const move = moves[Math.min(ply, moves.length) - 1]
  const sideToMove = move.color === 'w' ? 'b' : 'w'
  return {
    fen: move.fenAfter,
    evaluation: move.evalAfter,
    sideToMove,
    bestMoveUci: move.evalAfter.lines[0]?.moveUci ?? null
  }
}
```

- [ ] **Step 4: Write `src/renderer/src/components/Board.tsx`**

```tsx
import { Chessboard } from 'react-chessboard'
import type { Arrow } from 'react-chessboard'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
}

export function Board({ fen, bestMoveUci }: BoardProps): JSX.Element {
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'rgb(21, 128, 61)'
        }
      ]
    : []

  return (
    <div className="board-container">
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          arrows,
          boardOrientation: 'white'
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/components/EvalBar.tsx`**

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

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/lib/displayEval.ts src/renderer/src/lib/gameNavigation.ts src/renderer/src/components/Board.tsx src/renderer/src/components/EvalBar.tsx
git commit -m "Add board and eval bar with best-move arrow overlay"
```

---

### Task 14: Move list, eval graph, summary, App composition & final verification

**Files:**
- Create: `src/renderer/src/components/MoveList.tsx`
- Create: `src/renderer/src/components/EvalGraph.tsx`
- Create: `src/renderer/src/components/GameSummary.tsx`
- Create: `src/renderer/src/app.css`
- Modify: `src/renderer/src/App.tsx` (replace Task 1's placeholder)
- Modify: `src/renderer/src/main.tsx` (import the stylesheet)

**Interfaces:**
- Consumes: everything from Tasks 2-13 (`AnalyzedMove`, `MoveClassification`, `useGameAnalysis`, `ImportModal`, `Board`, `EvalBar`, `parsePgn`/`PgnParseError`, `getPositionAtPly`, `formatScore`/`whiteWinPercent`).
- Produces: the complete, runnable app. No automated test (top-level composition); verified end-to-end manually in this task's final step.

- [ ] **Step 1: Install recharts**

Run: `npm install recharts@^3.9.2`

- [ ] **Step 2: Write `src/renderer/src/components/MoveList.tsx`**

```tsx
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'

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

const CLASSIFICATION_LABELS: Record<MoveClassification, string> = {
  book: 'Book',
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder'
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
            <button
              className={`move ${row.white.classification} ${row.white.ply === currentPly ? 'selected' : ''}`}
              onClick={() => onSelectPly(row.white!.ply)}
              title={CLASSIFICATION_LABELS[row.white.classification]}
            >
              {row.white.san}
            </button>
          )}
          {row.black && (
            <button
              className={`move ${row.black.classification} ${row.black.ply === currentPly ? 'selected' : ''}`}
              onClick={() => onSelectPly(row.black!.ply)}
              title={CLASSIFICATION_LABELS[row.black.classification]}
            >
              {row.black.san}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 3: Write `src/renderer/src/components/EvalGraph.tsx`**

```tsx
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { AnalyzedMove } from '../../../shared/types'
import { whiteWinPercent } from '../lib/displayEval'

interface EvalGraphProps {
  moves: AnalyzedMove[]
  currentPly: number
  onSelectPly: (ply: number) => void
}

export function EvalGraph({ moves, currentPly, onSelectPly }: EvalGraphProps): JSX.Element {
  const data = moves.map((move) => ({
    ply: move.ply,
    whiteWinPercent: whiteWinPercent(move.evalAfter, move.color === 'w' ? 'b' : 'w')
  }))

  return (
    <div className="eval-graph">
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={data}
          onClick={(state) => {
            const ply = state?.activeLabel
            if (typeof ply === 'number') onSelectPly(ply)
          }}
        >
          <XAxis dataKey="ply" hide />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={50} stroke="#888" strokeDasharray="3 3" />
          <ReferenceLine x={currentPly} stroke="#4b9fff" />
          <Tooltip
            formatter={(value: number) => `${value.toFixed(0)}%`}
            labelFormatter={(ply) => `Move ${ply}`}
          />
          <Area
            type="stepAfter"
            dataKey="whiteWinPercent"
            stroke="#e5e5e5"
            fill="#e5e5e5"
            fillOpacity={0.9}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 4: Write `src/renderer/src/components/GameSummary.tsx`**

```tsx
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'

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

  return (
    <div className="game-summary">
      <div className="accuracy-row">
        <span>
          {whiteUsername}: {whiteAccuracy.toFixed(1)}% accuracy
        </span>
        <span>
          {blackUsername}: {blackAccuracy.toFixed(1)}% accuracy
        </span>
      </div>
      <table className="classification-table">
        <thead>
          <tr>
            <th>Move Quality</th>
            <th>{whiteUsername}</th>
            <th>{blackUsername}</th>
          </tr>
        </thead>
        <tbody>
          {CLASSIFICATIONS_TO_SHOW.map((classification) => (
            <tr key={classification}>
              <td>{classification}</td>
              <td>{whiteCounts[classification]}</td>
              <td>{blackCounts[classification]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Write `src/renderer/src/app.css`**

```css
:root {
  color-scheme: dark;
  --bg: #1e1e1e;
  --panel: #262626;
  --border: #3a3a3a;
  --text: #e5e5e5;
  --accent: #4b9fff;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, sans-serif;
}

.app {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}

.app header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.import-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
}

.import-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.import-tabs button.active {
  background: var(--accent);
  color: #fff;
}

.import-error {
  background: #4a1f1f;
  border: 1px solid #a33;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.import-panel textarea {
  width: 100%;
  box-sizing: border-box;
}

.chesscom-search {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.chesscom-game-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
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
  grid-template-columns: 40px minmax(300px, 480px) 320px;
  gap: 1rem;
  align-items: start;
}

.eval-bar {
  position: relative;
  width: 32px;
  height: 480px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 4px;
}

.eval-bar-black {
  background: #1a1a1a;
}

.eval-bar-white {
  background: #e5e5e5;
}

.eval-bar-score {
  position: absolute;
  bottom: 4px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 0.7rem;
  color: #000;
  mix-blend-mode: difference;
  filter: invert(1);
}

.board-container {
  width: 100%;
  max-width: 480px;
}

.side-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.move-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.move-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.15rem 0.5rem;
}

.move-number {
  width: 2rem;
  opacity: 0.6;
}

.move {
  background: none;
  border: none;
  color: var(--text);
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
}

.move.selected {
  outline: 2px solid var(--accent);
}

.move.brilliant, .move.great {
  color: #17a2b8;
}
.move.best, .move.excellent, .move.good, .move.book {
  color: #6fcf6f;
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

.classification-table {
  width: 100%;
  border-collapse: collapse;
}

.classification-table th,
.classification-table td {
  border-bottom: 1px solid var(--border);
  padding: 0.25rem 0.5rem;
  text-align: left;
}
```

- [ ] **Step 6: Replace `src/renderer/src/App.tsx`**

```tsx
import { useMemo, useState } from 'react'
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

  return (
    <div className="app">
      <header>
        <h1>Chess Analyzer</h1>
        {state.status !== 'idle' && <button onClick={handleNewGame}>New Game</button>}
      </header>

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
            displayScore={position.evaluation ? formatScore(position.evaluation, position.sideToMove) : '0.00'}
          />
          <Board fen={position.fen} bestMoveUci={position.bestMoveUci} />
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
    </div>
  )
}

export default App
```

- [ ] **Step 7: Modify `src/renderer/src/main.tsx` to import the stylesheet**

Add `import './app.css'` as the first line of `src/renderer/src/main.tsx`.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all tests across every task pass (pgn, engineMath, accuracy, openingBook, classification, stockfishManager, gameAnalyzer, chessComClient, analysisReducer, sanity).

- [ ] **Step 9: End-to-end manual verification**

Run: `npm run dev`, then in the app:
1. Paste a short PGN (e.g. `1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`) into the Paste tab and click "Load Game".
   Expected: progress bar advances, board/eval bar/move list/graph populate, and a "done" state shows accuracy and a classification table once analysis finishes.
2. Click a few moves in the move list and points on the eval graph.
   Expected: the board jumps to that position and the eval bar updates.
3. Click "New Game", switch to "Chess.com", enter a real chess.com username, click "Find Games".
   Expected: a list of recent games appears; clicking one loads and analyzes it.
4. Click "New Game", switch to "Upload File", pick a `.pgn` file from disk.
   Expected: the file loads and analyzes.
5. Paste clearly invalid text (e.g. `not a pgn`) into the Paste tab.
   Expected: an inline error appears, no crash.
6. Temporarily rename `vendor/stockfish/stockfish` (e.g. to `stockfish.bak`), reload the app, and try to analyze a game.
   Expected: an in-app error message about Stockfish, no crash. Rename it back afterward.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/MoveList.tsx src/renderer/src/components/EvalGraph.tsx src/renderer/src/components/GameSummary.tsx src/renderer/src/app.css src/renderer/src/App.tsx src/renderer/src/main.tsx package.json package-lock.json
git commit -m "Compose full analysis UI: move list, eval graph, summary, styling"
```

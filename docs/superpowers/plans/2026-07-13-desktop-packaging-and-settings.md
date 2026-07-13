# Desktop Packaging + Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Chess Analyzer as a native pacman package (with an app-launcher icon) and persist the chess.com username so it's never asked for twice.

**Architecture:** A hand-rolled JSON settings store in the main process persists `{ chessComUsername }` to `userData/settings.json`, exposed to the renderer via two new IPC channels; `ImportModal` loads it on mount and saves after a successful chess.com search. Separately, `electron-builder` is configured to produce a `pacman` target with a generated icon, and the Stockfish binary path resolver is fixed to work inside a packaged (asar) app instead of only in dev.

**Tech Stack:** Electron, TypeScript, Vitest, electron-builder, Node `fs`/`path`.

## Global Constraints

- Linux packaging only — pacman target, no Windows/macOS (per spec scope).
- No settings UI/panel — the username is remembered silently, with no new user-facing preferences screen (per spec).
- No new dependency for settings persistence — hand-rolled JSON read/write, not `electron-store` (per spec).
- All `npm install` calls rely on the committed `.npmrc` (`legacy-peer-deps=true`) — do not pass conflicting flags.
- The Stockfish binary itself is still never committed to git (`vendor/stockfish/` stays gitignored) — only the packaging config that bundles it as a build-time resource changes.

---

### Task 1: Settings store module

**Files:**
- Modify: `src/shared/types.ts` (add `AppSettings`)
- Create: `src/main/settings/settingsStore.ts`
- Test: `src/main/settings/settingsStore.test.ts`

**Interfaces:**
- Produces: `AppSettings { chessComUsername: string | null }` (from `src/shared/types.ts`), `loadSettings(): AppSettings`, `saveSettings(patch: Partial<AppSettings>): AppSettings` (from `src/main/settings/settingsStore.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/main/settings/settingsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`)
      return userDataDir
    }
  }
}))

import { loadSettings, saveSettings } from './settingsStore'

describe('settingsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-settings-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default settings when no file exists yet', () => {
    expect(loadSettings()).toEqual({ chessComUsername: null })
  })

  it('returns default settings when the file contains invalid JSON', () => {
    writeFileSync(join(userDataDir, 'settings.json'), '{not valid json', 'utf-8')
    expect(loadSettings()).toEqual({ chessComUsername: null })
  })

  it('round-trips a saved username', () => {
    saveSettings({ chessComUsername: 'hikaru' })
    expect(loadSettings()).toEqual({ chessComUsername: 'hikaru' })
  })

  it('creates the userData directory if it does not exist yet', () => {
    rmSync(userDataDir, { recursive: true, force: true })
    expect(() => saveSettings({ chessComUsername: 'magnus' })).not.toThrow()
    expect(loadSettings()).toEqual({ chessComUsername: 'magnus' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/settings/settingsStore.test.ts`
Expected: FAIL — `Cannot find module './settingsStore'` (the module doesn't exist yet).

- [ ] **Step 3: Add `AppSettings` to shared types**

In `src/shared/types.ts`, add near the top (after the existing imports/interfaces, order doesn't matter — this is a standalone interface):

```ts
export interface AppSettings {
  chessComUsername: string | null
}
```

- [ ] **Step 4: Write the settings store implementation**

Create `src/main/settings/settingsStore.ts`:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../../shared/types'

const DEFAULT_SETTINGS: AppSettings = { chessComUsername: null }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      chessComUsername:
        typeof parsed.chessComUsername === 'string' ? parsed.chessComUsername : null
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...patch }
  const path = getSettingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/settings/settingsStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/settings/settingsStore.ts src/main/settings/settingsStore.test.ts
git commit -m "Add settings store for persisting app preferences to disk"
```

---

### Task 2: Wire settings IPC end-to-end

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts` (extend `ChessAPI`)
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `loadSettings()`, `saveSettings()` from `src/main/settings/settingsStore.ts` (Task 1); `AppSettings` from `src/shared/types.ts` (Task 1).
- Produces: `window.chessAPI.getSettings(): Promise<AppSettings>`, `window.chessAPI.setChessComUsername(username: string): Promise<AppSettings>` — consumed by Task 3.

No dedicated unit test for this task: this codebase has no existing tests for `handlers.ts` or `preload/index.ts` (IPC wiring is verified by the app actually running, not mocked-IPC unit tests — consistent with the existing pattern for `analyzeGame`/`fetchChessComGames`/`openPgnFile`). The verification for this task is a clean typecheck; end-to-end behavior is verified manually in Task 3.

- [ ] **Step 1: Add the two IPC channel names**

In `src/shared/ipc.ts`, replace the whole file with:

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  setChessComUsername: 'settings:set-chesscom-username'
} as const
```

- [ ] **Step 2: Extend the `ChessAPI` interface**

In `src/shared/types.ts`, find the `ChessAPI` interface (currently ending with `fetchChessComGames(username: string): Promise<ChessComGameSummary[] | { error: string }>`) and add two more members so it reads:

```ts
export interface ChessAPI {
  analyzeGame(
    positions: AnalyzedPosition[],
    depth: number
  ): Promise<GameAnalysisResult | { cancelled: true } | { error: string }>
  onAnalysisProgress(callback: (move: AnalyzedMove) => void): () => void
  cancelAnalysis(): void
  openPgnFile(): Promise<{ pgn: string } | { cancelled: true } | { error: string }>
  fetchChessComGames(username: string): Promise<ChessComGameSummary[] | { error: string }>
  getSettings(): Promise<AppSettings>
  setChessComUsername(username: string): Promise<AppSettings>
}
```

- [ ] **Step 3: Register the two IPC handlers**

In `src/main/ipc/handlers.ts`, add the import and the two handlers. The import line goes alongside the existing imports at the top:

```ts
import { loadSettings, saveSettings } from '../settings/settingsStore'
```

And inside `registerIpcHandlers`, add (anywhere after the existing `ipcMain.handle(IPC_CHANNELS.fetchChessComGames, ...)` block, before the closing brace):

```ts
  ipcMain.handle(IPC_CHANNELS.getSettings, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.setChessComUsername, async (_event, username: string) => {
    return saveSettings({ chessComUsername: username })
  })
```

- [ ] **Step 4: Expose the two methods from preload**

In `src/preload/index.ts`, replace the whole file with:

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
  fetchChessComGames: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchChessComGames, username),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  setChessComUsername: (username: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setChessComUsername, username)
}

contextBridge.exposeInMainWorld('chessAPI', chessAPI)
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors (confirms `ChessAPI`, the preload implementation, and the handler all agree on shapes).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Expose settings get/set over IPC"
```

---

### Task 3: Prefill and persist the chess.com username in ImportModal

**Files:**
- Modify: `src/renderer/src/components/ImportModal.tsx`

**Interfaces:**
- Consumes: `window.chessAPI.getSettings()`, `window.chessAPI.setChessComUsername()` (Task 2).

No unit test: this repo has no component-level tests for any renderer component (`Board.tsx`, `EvalBar.tsx`, `MoveList.tsx`, `ImportModal.tsx` etc. are all untested directly — only pure logic in `lib/`, `shared/`, and `main/` has unit tests). Verified manually via the `run-desktop` skill instead, per existing project convention.

- [ ] **Step 1: Prefill username on mount and save it after a successful search**

In `src/renderer/src/components/ImportModal.tsx`, change the top of the file from:

```tsx
import { useState } from 'react'
import type { ChessComGameSummary } from '../../../shared/types'
```

to:

```tsx
import { useEffect, useState } from 'react'
import type { ChessComGameSummary } from '../../../shared/types'
```

Add, right after the existing `useState` declarations (after the `isFetching` line):

```tsx
  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => {
      if (settings.chessComUsername) setUsername(settings.chessComUsername)
    })
  }, [])
```

Change `handleFindGames` from:

```tsx
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
```

to:

```tsx
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
      void window.chessAPI.setChessComUsername(username)
    }
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Build for the driver**

Run: `npm run build`
Expected: writes `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 4: Manually verify persistence with the run-desktop skill**

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-settings-a.txt`:

```
launch
click-text Chess.com
fill input hikaru
click-text Find Games
wait .chesscom-game-list li 15000
ss settings-search-done
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-settings-a.txt`
Expected: the games list populates (`hikaru` is a real, always-populated chess.com account used here only as a known-good test value) — this proves the search succeeded and triggered the save.

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-settings-b.txt`:

```
launch
click-text Chess.com
eval document.querySelector('input').value
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-settings-b.txt`
Expected: prints `"hikaru"` — a fresh app launch has the username pre-filled without the user typing it again.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ImportModal.tsx
git commit -m "Prefill and persist the chess.com username across restarts"
```

---

### Task 4: App icon

**Files:**
- Create: `build/icon.svg`
- Create: `build/icon.png`

**Interfaces:**
- Produces: `build/icon.png` (512×512), consumed by `electron-builder`'s `linux.icon` config in Task 6.

- [ ] **Step 1: Create the SVG source**

Create `build/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1e1e1e"/>
  <rect x="16" y="16" width="480" height="480" rx="84" fill="none" stroke="#7fa650" stroke-width="16"/>
  <circle cx="256" cy="176" r="62" fill="#e5e5e5"/>
  <path d="M204 250 L308 250 L332 320 L180 320 Z" fill="#e5e5e5"/>
  <path d="M150 400 L362 400 L378 356 L134 356 Z" fill="#e5e5e5"/>
  <rect x="120" y="400" width="272" height="40" rx="12" fill="#e5e5e5"/>
</svg>
```

This draws a simple geometric pawn silhouette (circle head, two trapezoid flares, base) in the app's light text color, on the app's dark background with a green ring — deliberately not relying on a chess-symbol font glyph being installed, so rasterization is deterministic.

- [ ] **Step 2: Rasterize to PNG**

Run: `rsvg-convert -w 512 -h 512 build/icon.svg -o build/icon.png`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify the PNG**

Run: `file build/icon.png`
Expected: `build/icon.png: PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced` (or equivalent — confirms it's a valid 512×512 PNG).

- [ ] **Step 4: Commit**

```bash
git add build/icon.svg build/icon.png
git commit -m "Add app icon"
```

---

### Task 5: Fix Stockfish binary path resolution for packaged builds

**Files:**
- Modify: `src/main/engine/stockfishPath.ts`
- Test: `src/main/engine/stockfishPath.test.ts`

**Interfaces:**
- Produces: `getStockfishBinaryPath(): string` (same signature as before — behavior changes, not the interface). Consumed today by `src/main/ipc/handlers.ts`; consumed at runtime by the packaged app built in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/main/engine/stockfishPath.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'

let isPackaged = false

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    },
    getAppPath: () => '/dev/app-root'
  }
}))

import { getStockfishBinaryPath } from './stockfishPath'

describe('getStockfishBinaryPath', () => {
  const originalPlatform = process.platform
  const originalResourcesPath = process.resourcesPath

  afterEach(() => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.resourcesPath = originalResourcesPath
  })

  it('resolves relative to the app root in dev (not packaged)', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'linux' })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish')
  })

  it('resolves relative to process.resourcesPath when packaged', () => {
    isPackaged = true
    process.resourcesPath = '/packaged/resources'
    Object.defineProperty(process, 'platform', { value: 'linux' })

    expect(getStockfishBinaryPath()).toBe('/packaged/resources/vendor/stockfish/stockfish')
  })

  it('uses the .exe suffix on win32', () => {
    isPackaged = false
    Object.defineProperty(process, 'platform', { value: 'win32' })

    expect(getStockfishBinaryPath()).toBe('/dev/app-root/vendor/stockfish/stockfish.exe')
  })
})
```

- [ ] **Step 2: Run the test to verify the packaged case fails**

Run: `npx vitest run src/main/engine/stockfishPath.test.ts`
Expected: 2 pass (dev, win32), 1 fail (packaged) — because `getStockfishBinaryPath()` currently always uses `app.getAppPath()`, so the packaged-case assertion gets `/dev/app-root/vendor/stockfish/stockfish` instead of the `/packaged/resources/...` it expects.

- [ ] **Step 3: Implement the fix**

Replace `src/main/engine/stockfishPath.ts` with:

```ts
import { app } from 'electron'
import { join } from 'node:path'

export function getStockfishBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'
  const baseDir = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(baseDir, 'vendor', 'stockfish', binaryName)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/engine/stockfishPath.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/engine/stockfishPath.ts src/main/engine/stockfishPath.test.ts
git commit -m "Fix Stockfish binary path resolution inside a packaged (asar) app"
```

---

### Task 6: Configure electron-builder for a pacman package

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `build/icon.png` (Task 4), `vendor/stockfish/` (existing, gitignored, downloaded via `npm run setup:stockfish`).
- Produces: `npm run build:linux` script; a `release/*.pacman` output file, consumed manually in Task 7.

- [ ] **Step 1: Install electron-builder**

Run: `npm install --save-dev electron-builder`
Expected: installs cleanly (the committed `.npmrc` already sets `legacy-peer-deps=true`), `package.json` and `package-lock.json` both change.

- [ ] **Step 2: Add package metadata and the build config**

In `package.json`, add `"author"` and `"description"` fields, and a `"build"` config block. The full file should read:

```json
{
  "name": "chess-analyzer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "author": "Zachary L",
  "description": "A free, local desktop chess analyzer with engine evaluation, move-quality classification, and game-history insights.",
  "main": "./out/main/index.js",
  "engines": {
    "node": ">=18.18"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:linux": "electron-vite build && electron-builder --linux pacman",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc -b",
    "setup:stockfish": "node scripts/downloadStockfish.mjs"
  },
  "build": {
    "appId": "com.chessanalyzer.app",
    "productName": "Chess Analyzer",
    "files": ["out/**/*", "package.json"],
    "directories": {
      "output": "release"
    },
    "extraResources": [
      {
        "from": "vendor/stockfish",
        "to": "vendor/stockfish"
      }
    ],
    "linux": {
      "target": ["pacman"],
      "icon": "build/icon.png",
      "category": "Game"
    }
  },
  "dependencies": {
    "chess.js": "^1.4.0",
    "react": "^19.2.7",
    "react-chessboard": "^5.10.0",
    "react-dom": "^19.2.7",
    "react-is": "^19.2.7",
    "recharts": "^3.9.2"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.3",
    "electron": "^43.1.0",
    "electron-builder": "<version installed by Step 1>",
    "electron-vite": "^5.0.0",
    "playwright-core": "^1.61.1",
    "typescript": "^5.5.0",
    "vite": "^8.1.3",
    "vitest": "^4.1.10"
  }
}
```

Keep whatever exact `electron-builder` version Step 1 actually installed (don't hand-edit it to a guessed number) — only add the surrounding fields (`author`, `description`, `scripts.build:linux`, `build`) around it.

- [ ] **Step 2: Typecheck (config change only, sanity check nothing broke)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Configure electron-builder to produce a pacman package"
```

---

### Task 7: Build, install, and verify the packaged app

This task is manual/interactive (the install step needs the user's `sudo` password) — it is not meant to be run unattended by an autonomous coding agent. Whoever executes this plan should hand this task to the user rather than running `sudo` themselves.

- [ ] **Step 1: Ensure the Stockfish binary is present**

Run: `npm run setup:stockfish`
Expected: `Stockfish already present at .../vendor/stockfish/stockfish` (or downloads it if this is a fresh checkout).

- [ ] **Step 2: Build the package**

Run: `npm run build:linux`
Expected: completes with no errors; produces a file under `release/`, e.g. `release/chess-analyzer-0.1.0.pacman` (electron-builder derives the exact filename from `productName`/`version`).

Run: `ls release/*.pacman`
Expected: prints the path to the produced package.

- [ ] **Step 3: Install it (user runs this — needs sudo)**

Run: `sudo pacman -U release/chess-analyzer-0.1.0.pacman` (adjust the filename to whatever Step 2 actually produced)
Expected: pacman installs the package; confirm at the prompt.

- [ ] **Step 4: Verify it appears in the KDE application launcher**

Open the KDE application launcher (e.g. the Kickoff menu) and search "Chess Analyzer".
Expected: it appears with the icon from Task 4, under the "Games" category.

- [ ] **Step 5: Launch it and run a real analysis**

Click the launcher icon (not a terminal command).
Expected: the app window opens. Paste a short PGN (e.g. `1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0`) and confirm engine analysis completes — this exercises the Task 5 fix, since the packaged app's Stockfish binary only resolves correctly if `getStockfishBinaryPath()` correctly used `process.resourcesPath`.

- [ ] **Step 6: Confirm the settings persistence survives a real install (not just the dev build)**

In the running packaged app, search chess.com for a username, then quit and relaunch from the KDE launcher.
Expected: the chess.com tab's username field is pre-filled, same as verified against the dev build in Task 3.

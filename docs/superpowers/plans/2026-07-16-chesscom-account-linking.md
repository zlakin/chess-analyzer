# Chess.com Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user explicitly "connect" their chess.com account, prove they own it via a profile-code challenge (no OAuth), and have the app auto-use that account for Insights and Analyze afterward without asking again.

**Architecture:** `AppSettings.chessComUsername` (a bare, unverified string) is replaced with `linkedAccount: LinkedAccount | null` (`{ username, verifiedAt }`), with a one-time migration for existing installs. A new main-process module (`accountLink.ts`) generates a short code, has the user paste it into their chess.com profile's `location` field, and confirms it via the existing public `/pub/player/{username}` API before marking the account verified. A persistent chip in `NavBar` and a new `ConnectAccountModal` give this a visible home; the Analyze tab's ad-hoc "search anyone's games" flow stops silently overwriting the linked account.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React 19, Vitest. No new dependencies — `node:crypto` (already used elsewhere in this codebase, e.g. `insightsStore.ts`) covers code generation.

## Global Constraints

- No real chess.com OAuth — verification is a profile-code challenge only; chess.com's OAuth requires a manual, externally-gated developer application that is out of scope (per spec).
- No multiple linked accounts / account switching — one linked account at a time (per spec).
- The pending verification challenge lives in main-process memory only — no persistence, no expiry timer (per spec).
- The real end-to-end proof (pasting a code into a live chess.com profile) cannot be automated — final verification of that step is a manual pass against the `zlakin` test account (per spec).
- This repo commits go straight to `main` — no branches/worktrees/PRs.

---

### Task 1: Replace `chessComUsername` with a migrated `LinkedAccount` model

This is one task, not several, because the type change is breaking: every direct consumer (`settingsStore`, `handlers.ts`, `preload`, `ImportModal.tsx`) must be fixed in the same commit or the tree won't typecheck.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/settings/settingsStore.ts`
- Modify: `src/main/settings/settingsStore.test.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/ImportModal.tsx`

**Interfaces:**
- Produces: `LinkedAccount { username: string; verifiedAt: number | null }`, `AppSettings { linkedAccount: LinkedAccount | null }` (from `src/shared/types.ts`); `loadSettings(): AppSettings`, `saveSettings(patch: Partial<AppSettings>): AppSettings` (unchanged signatures, new shape) — consumed by Task 3 and Task 4.

- [ ] **Step 1: Write the failing test**

Replace `src/main/settings/settingsStore.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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
    expect(loadSettings()).toEqual({ linkedAccount: null })
  })

  it('returns default settings when the file contains invalid JSON', () => {
    writeFileSync(join(userDataDir, 'settings.json'), '{not valid json', 'utf-8')
    expect(loadSettings()).toEqual({ linkedAccount: null })
  })

  it('round-trips a saved linked account', () => {
    saveSettings({ linkedAccount: { username: 'hikaru', verifiedAt: 1700000000000 } })
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'hikaru', verifiedAt: 1700000000000 }
    })
  })

  it('creates the userData directory if it does not exist yet', () => {
    rmSync(userDataDir, { recursive: true, force: true })
    expect(() =>
      saveSettings({ linkedAccount: { username: 'magnus', verifiedAt: null } })
    ).not.toThrow()
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'magnus', verifiedAt: null }
    })
  })

  it('migrates a legacy chessComUsername string into an unverified linked account', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ chessComUsername: 'zlakin' }),
      'utf-8'
    )
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'zlakin', verifiedAt: null }
    })
  })

  it('persists the migrated shape back to disk so the file only needs migrating once', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({ chessComUsername: 'zlakin' }),
      'utf-8'
    )

    loadSettings()

    const onDisk = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf-8'))
    expect(onDisk).toEqual({ linkedAccount: { username: 'zlakin', verifiedAt: null } })
  })

  it('prefers a real linkedAccount over a stale legacy field if somehow both are present', () => {
    writeFileSync(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        chessComUsername: 'old-username',
        linkedAccount: { username: 'new-username', verifiedAt: 1700000000000 }
      }),
      'utf-8'
    )
    expect(loadSettings()).toEqual({
      linkedAccount: { username: 'new-username', verifiedAt: 1700000000000 }
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/settings/settingsStore.test.ts`
Expected: FAIL — the current implementation still returns `{ chessComUsername: ... }`, not `{ linkedAccount: ... }`.

- [ ] **Step 3: Update the shared types**

In `src/shared/types.ts`, replace:

```ts
export interface AppSettings {
  chessComUsername: string | null
}
```

with:

```ts
export interface LinkedAccount {
  username: string
  verifiedAt: number | null
}

export interface AppSettings {
  linkedAccount: LinkedAccount | null
}
```

Then find the `ChessAPI` interface and remove the `setChessComUsername` member so it reads:

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
  scanChessComGames(): Promise<ScanOutcome>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  cancelScan(): void
  getInsightsReport(): Promise<InsightsReport>
}
```

(Task 4 adds the new account-linking members back onto this interface.)

- [ ] **Step 4: Rewrite the settings store implementation**

Replace `src/main/settings/settingsStore.ts` with:

```ts
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, LinkedAccount } from '../../shared/types'

const DEFAULT_SETTINGS: AppSettings = { linkedAccount: null }

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }

  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed.linkedAccount !== undefined) {
      const linkedAccount = parsed.linkedAccount as Partial<LinkedAccount> | null
      if (linkedAccount && typeof linkedAccount.username === 'string') {
        return {
          linkedAccount: {
            username: linkedAccount.username,
            verifiedAt: typeof linkedAccount.verifiedAt === 'number' ? linkedAccount.verifiedAt : null
          }
        }
      }
      return { linkedAccount: null }
    }

    // Legacy pre-account-linking shape: a plain saved username with no proof
    // of ownership. Migrate it into an unverified linked account and persist
    // the new shape immediately, so this file only ever needs migrating once.
    if (typeof parsed.chessComUsername === 'string') {
      const migrated: AppSettings = {
        linkedAccount: { username: parsed.chessComUsername, verifiedAt: null }
      }
      writeFileSync(path, JSON.stringify(migrated, null, 2), 'utf-8')
      return migrated
    }

    return { ...DEFAULT_SETTINGS }
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
Expected: PASS (7 tests).

- [ ] **Step 6: Remove the old IPC channel**

In `src/shared/ipc.ts`, remove the `setChessComUsername: 'settings:set-chesscom-username'` line so the file reads:

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
} as const
```

- [ ] **Step 7: Fix `handlers.ts`**

In `src/main/ipc/handlers.ts`, change the top import from:

```ts
import { loadSettings, saveSettings } from '../settings/settingsStore'
```

to:

```ts
import { loadSettings } from '../settings/settingsStore'
```

Then replace:

```ts
  ipcMain.handle(IPC_CHANNELS.getSettings, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.setChessComUsername, async (_event, username: string) => {
    return saveSettings({ chessComUsername: username })
  })

  ipcMain.handle(IPC_CHANNELS.scanChessComGames, async () => {
    const settings = loadSettings()
    if (!settings.chessComUsername) {
      return { error: 'Set a chess.com username first by searching for your games in the Analyze tab.' }
    }

    const runId = scanRuns.start()
    try {
      return await runScan(settings.chessComUsername, {
```

with:

```ts
  ipcMain.handle(IPC_CHANNELS.getSettings, async () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.scanChessComGames, async () => {
    const settings = loadSettings()
    const username = settings.linkedAccount?.username
    if (!username) {
      return { error: 'Connect your chess.com account first.' }
    }

    const runId = scanRuns.start()
    try {
      return await runScan(username, {
```

- [ ] **Step 8: Fix `preload/index.ts`**

In `src/preload/index.ts`, remove the `setChessComUsername` exposure so the relevant lines read:

```ts
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  scanChessComGames: () => ipcRenderer.invoke(IPC_CHANNELS.scanChessComGames),
```

- [ ] **Step 9: Fix `ImportModal.tsx`**

In `src/renderer/src/components/ImportModal.tsx`, change:

```tsx
  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => {
      setUsername((current) => resolvePrefillUsername(current, settings.chessComUsername))
    })
  }, [])
```

to:

```tsx
  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => {
      setUsername((current) =>
        resolvePrefillUsername(current, settings.linkedAccount?.username ?? null)
      )
    })
  }, [])
```

And change `handleFindGames` from:

```tsx
  const handleFindGames = async (): Promise<void> => {
    const trimmedUsername = username.trim()
    if (trimmedUsername.length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsFetching(true)
    setChessComGames([])
    const result = await window.chessAPI.fetchChessComGames(trimmedUsername)
    setIsFetching(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setChessComGames(result)
      void window.chessAPI.setChessComUsername(trimmedUsername)
    }
  }
```

to:

```tsx
  const handleFindGames = async (): Promise<void> => {
    const trimmedUsername = username.trim()
    if (trimmedUsername.length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsFetching(true)
    setChessComGames([])
    const result = await window.chessAPI.fetchChessComGames(trimmedUsername)
    setIsFetching(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setChessComGames(result)
    }
  }
```

This ad-hoc search no longer touches settings at all — only the account-link flow (Task 5) will.

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 12: Build for the driver**

Run: `npm run build`
Expected: writes `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 13: Manually verify the real migration**

This machine already has a real `~/.config/chess-analyzer/settings.json` with the legacy shape (`{"chessComUsername": "zlakin"}`) from prior manual testing — a genuine pre-upgrade install to migrate.

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-migration-a.txt`:

```
launch
click-text Chess.com
eval document.querySelector('input').value
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-migration-a.txt`
Expected: prints `"zlakin"` — the legacy username prefills correctly through the new `linkedAccount` field.

Run: `cat ~/.config/chess-analyzer/settings.json`
Expected: `{"linkedAccount": {"username": "zlakin", "verifiedAt": null}}` (2-space indented) — confirms the file was rewritten to the new shape on that first load.

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-migration-b.txt`:

```
launch
click-text Chess.com
fill input hikaru
click-text Find Games
wait .chesscom-game-list li 15000
ss migration-search-done
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-migration-b.txt`
Expected: the games list populates for `hikaru` (a real, always-populated chess.com account used here only as a known-good test value).

Run: `cat ~/.config/chess-analyzer/settings.json`
Expected: unchanged — still `{"linkedAccount": {"username": "zlakin", "verifiedAt": null}}`, proving the ad-hoc search for `hikaru` did **not** silently overwrite the linked account.

- [ ] **Step 14: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts src/main/settings/settingsStore.ts src/main/settings/settingsStore.test.ts src/main/ipc/handlers.ts src/preload/index.ts src/renderer/src/components/ImportModal.tsx
git commit -m "Replace chessComUsername with a migrated LinkedAccount model"
```

---

### Task 2: Add `fetchPlayerProfile` to the chess.com client

**Files:**
- Modify: `src/main/chesscom/chessComClient.ts`
- Modify: `src/main/chesscom/chessComClient.test.ts`

**Interfaces:**
- Consumes: existing module-local `fetchJson`, `ChessComFetchError` (already in this file).
- Produces: `ChessComPlayerProfile { username: string; location: string | null }`, `fetchPlayerProfile(username: string): Promise<ChessComPlayerProfile>` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

In `src/main/chesscom/chessComClient.test.ts`, change the top import line from:

```ts
import { fetchRecentGames, ChessComFetchError } from './chessComClient'
```

to:

```ts
import { fetchRecentGames, fetchPlayerProfile, ChessComFetchError } from './chessComClient'
```

Then append this new `describe` block at the end of the file (after the existing `describe('fetchRecentGames', ...)` block's closing `})`):

```ts
describe('fetchPlayerProfile', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the username and location from the player profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ username: 'testuser', location: 'New York, USA' }), {
          status: 200
        })
      )
    )

    const profile = await fetchPlayerProfile('testuser')
    expect(profile).toEqual({ username: 'testuser', location: 'New York, USA' })
  })

  it('returns a null location when the profile has none set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ username: 'testuser' }), { status: 200 }))
    )

    const profile = await fetchPlayerProfile('testuser')
    expect(profile.location).toBeNull()
  })

  it('throws ChessComFetchError when the user does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(fetchPlayerProfile('nobody')).rejects.toThrow(ChessComFetchError)
  })

  it('throws ChessComFetchError for an empty username', async () => {
    await expect(fetchPlayerProfile('   ')).rejects.toThrow(ChessComFetchError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/chesscom/chessComClient.test.ts`
Expected: FAIL — `fetchPlayerProfile` is not exported yet (`TypeError: fetchPlayerProfile is not a function`).

- [ ] **Step 3: Implement `fetchPlayerProfile`**

In `src/main/chesscom/chessComClient.ts`, add this at the end of the file (after `fetchRecentGames`):

```ts
export interface ChessComPlayerProfile {
  username: string
  location: string | null
}

export async function fetchPlayerProfile(username: string): Promise<ChessComPlayerProfile> {
  const trimmedUsername = username.trim().toLowerCase()
  if (trimmedUsername.length === 0) {
    throw new ChessComFetchError('Enter a chess.com username')
  }

  const profile = await fetchJson<{ username: string; location?: string }>(
    `https://api.chess.com/pub/player/${trimmedUsername}`
  )

  return { username: profile.username, location: profile.location ?? null }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/chesscom/chessComClient.test.ts`
Expected: PASS (9 tests: 5 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/main/chesscom/chessComClient.ts src/main/chesscom/chessComClient.test.ts
git commit -m "Add fetchPlayerProfile to the chess.com client"
```

---

### Task 3: Add the `accountLink` verification-challenge module

**Files:**
- Create: `src/main/chesscom/accountLink.ts`
- Test: `src/main/chesscom/accountLink.test.ts`

**Interfaces:**
- Consumes: `fetchPlayerProfile(username): Promise<ChessComPlayerProfile>` (Task 2); `saveSettings(patch: Partial<AppSettings>): AppSettings` (Task 1).
- Produces: `startLink(username: string): Promise<{ code: string } | { error: string }>`, `verifyLink(): Promise<{ verified: true; username: string; verifiedAt: number } | { error: string }>`, `disconnectAccount(): void` — all consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/main/chesscom/accountLink.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./chessComClient', () => ({
  fetchPlayerProfile: vi.fn()
}))
vi.mock('../settings/settingsStore', () => ({
  saveSettings: vi.fn()
}))

import { fetchPlayerProfile } from './chessComClient'
import { saveSettings } from '../settings/settingsStore'
import {
  startLink,
  verifyLink,
  disconnectAccount,
  __resetPendingChallengeForTests
} from './accountLink'

const fetchPlayerProfileMock = vi.mocked(fetchPlayerProfile)
const saveSettingsMock = vi.mocked(saveSettings)

describe('accountLink', () => {
  beforeEach(() => {
    fetchPlayerProfileMock.mockReset()
    saveSettingsMock.mockReset()
    __resetPendingChallengeForTests()
  })

  describe('startLink', () => {
    it('returns a code once the profile is confirmed to exist', async () => {
      fetchPlayerProfileMock.mockResolvedValue({ username: 'zlakin', location: null })

      const result = await startLink('zlakin')

      expect('code' in result).toBe(true)
      expect((result as { code: string }).code).toMatch(/^CHESSANALYZER-[0-9A-F]{8}$/)
    })

    it('surfaces the error when the profile lookup fails', async () => {
      fetchPlayerProfileMock.mockRejectedValue(new Error('Chess.com user not found'))

      const result = await startLink('nobody')

      expect(result).toEqual({ error: 'Chess.com user not found' })
    })
  })

  describe('verifyLink', () => {
    it('errors when there is no pending challenge', async () => {
      const result = await verifyLink()
      expect(result).toEqual({ error: 'Start linking your account first.' })
    })

    it('links the account once the code shows up in the profile location', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      const started = (await startLink('zlakin')) as { code: string }

      fetchPlayerProfileMock.mockResolvedValueOnce({
        username: 'zlakin',
        location: `hi, my code is ${started.code.toLowerCase()} thanks`
      })

      const result = await verifyLink()

      expect(result).toEqual({
        verified: true,
        username: 'zlakin',
        verifiedAt: expect.any(Number)
      })
      expect(saveSettingsMock).toHaveBeenCalledWith({
        linkedAccount: { username: 'zlakin', verifiedAt: expect.any(Number) }
      })
    })

    it('does not link when the code is not found in the profile location', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      await startLink('zlakin')

      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: 'New York, USA' })

      const result = await verifyLink()

      expect(result).toEqual({
        error: "Didn't find the code in zlakin's profile location yet. Try again."
      })
      expect(saveSettingsMock).not.toHaveBeenCalled()
    })

    it('clears the pending challenge after a successful verify (cannot replay it)', async () => {
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: null })
      const started = (await startLink('zlakin')) as { code: string }
      fetchPlayerProfileMock.mockResolvedValueOnce({ username: 'zlakin', location: started.code })
      await verifyLink()

      const result = await verifyLink()
      expect(result).toEqual({ error: 'Start linking your account first.' })
    })
  })

  describe('disconnectAccount', () => {
    it('clears the linked account', () => {
      disconnectAccount()
      expect(saveSettingsMock).toHaveBeenCalledWith({ linkedAccount: null })
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/chesscom/accountLink.test.ts`
Expected: FAIL — `Cannot find module './accountLink'` (the module doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `src/main/chesscom/accountLink.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { fetchPlayerProfile } from './chessComClient'
import { saveSettings } from '../settings/settingsStore'

interface PendingChallenge {
  username: string
  code: string
}

let pendingChallenge: PendingChallenge | null = null

function generateCode(): string {
  return `CHESSANALYZER-${randomBytes(4).toString('hex').toUpperCase()}`
}

export async function startLink(username: string): Promise<{ code: string } | { error: string }> {
  try {
    const profile = await fetchPlayerProfile(username)
    const code = generateCode()
    pendingChallenge = { username: profile.username, code }
    return { code }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function verifyLink(): Promise<
  { verified: true; username: string; verifiedAt: number } | { error: string }
> {
  if (!pendingChallenge) {
    return { error: 'Start linking your account first.' }
  }

  const { username, code } = pendingChallenge

  try {
    const profile = await fetchPlayerProfile(username)
    const location = profile.location ?? ''
    if (!location.toUpperCase().includes(code)) {
      return { error: `Didn't find the code in ${username}'s profile location yet. Try again.` }
    }

    pendingChallenge = null
    const verifiedAt = Date.now()
    saveSettings({ linkedAccount: { username, verifiedAt } })
    return { verified: true, username, verifiedAt }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export function disconnectAccount(): void {
  pendingChallenge = null
  saveSettings({ linkedAccount: null })
}

// Exposed only so tests can reset module-level state between cases without
// relying on import order/caching tricks.
export function __resetPendingChallengeForTests(): void {
  pendingChallenge = null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/chesscom/accountLink.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/chesscom/accountLink.ts src/main/chesscom/accountLink.test.ts
git commit -m "Add the accountLink profile-code verification module"
```

---

### Task 4: Wire up the account-linking and external-link IPC channels

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `startLink`, `verifyLink`, `disconnectAccount` (Task 3).
- Produces: `window.chessAPI.startAccountLink(username: string): Promise<{ code: string } | { error: string }>`, `window.chessAPI.verifyAccountLink(): Promise<{ verified: true; username: string; verifiedAt: number } | { error: string }>`, `window.chessAPI.disconnectAccount(): Promise<void>`, `window.chessAPI.openChessComProfileSettings(): Promise<void>` — all consumed by Task 5.

No dedicated unit test for this task, consistent with this codebase's existing convention: `handlers.ts` and `preload/index.ts` have no tests anywhere (see `fetchChessComGames`/`openPgnFile`/`getSettings` — none are unit-tested). Verified by a clean typecheck; end-to-end behavior is verified manually in Task 5.

- [ ] **Step 1: Add the new IPC channel names**

In `src/shared/ipc.ts`, add three account channels and one app channel so the file reads:

```ts
export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  startAccountLink: 'account:start-link',
  verifyAccountLink: 'account:verify-link',
  disconnectAccount: 'account:disconnect',
  openChessComProfileSettings: 'app:open-chesscom-profile-settings',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
} as const
```

- [ ] **Step 2: Extend the `ChessAPI` interface**

In `src/shared/types.ts`, add the four new members to `ChessAPI` (after `getSettings`, before `scanChessComGames`) so it reads:

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
  startAccountLink(username: string): Promise<{ code: string } | { error: string }>
  verifyAccountLink(): Promise<
    { verified: true; username: string; verifiedAt: number } | { error: string }
  >
  disconnectAccount(): Promise<void>
  openChessComProfileSettings(): Promise<void>
  scanChessComGames(): Promise<ScanOutcome>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  cancelScan(): void
  getInsightsReport(): Promise<InsightsReport>
}
```

- [ ] **Step 3: Register the four IPC handlers**

In `src/main/ipc/handlers.ts`, change the electron import from:

```ts
import { ipcMain, dialog } from 'electron'
```

to:

```ts
import { ipcMain, dialog, shell } from 'electron'
```

Add this import alongside the existing ones:

```ts
import { startLink, verifyLink, disconnectAccount } from '../chesscom/accountLink'
```

Then add, right after the existing `ipcMain.handle(IPC_CHANNELS.getSettings, ...)` block:

```ts
  ipcMain.handle(IPC_CHANNELS.startAccountLink, async (_event, username: string) => {
    return startLink(username)
  })

  ipcMain.handle(IPC_CHANNELS.verifyAccountLink, async () => {
    return verifyLink()
  })

  ipcMain.handle(IPC_CHANNELS.disconnectAccount, async () => {
    disconnectAccount()
  })

  ipcMain.handle(IPC_CHANNELS.openChessComProfileSettings, async () => {
    await shell.openExternal('https://www.chess.com/settings/profile')
  })
```

- [ ] **Step 4: Expose the four methods from preload**

In `src/preload/index.ts`, add these lines right after `getSettings` and before `scanChessComGames`:

```ts
  startAccountLink: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.startAccountLink, username),
  verifyAccountLink: () => ipcRenderer.invoke(IPC_CHANNELS.verifyAccountLink),
  disconnectAccount: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectAccount),
  openChessComProfileSettings: () => ipcRenderer.invoke(IPC_CHANNELS.openChessComProfileSettings),
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/types.ts src/main/ipc/handlers.ts src/preload/index.ts
git commit -m "Expose account-linking and open-external-profile over IPC"
```

---

### Task 5: Build the connect-account UI and wire it into App

**Files:**
- Modify: `src/renderer/src/components/NavBar.tsx`
- Create: `src/renderer/src/components/ConnectAccountModal.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/app.css`

**Interfaces:**
- Consumes: `window.chessAPI.getSettings/startAccountLink/verifyAccountLink/disconnectAccount/openChessComProfileSettings` (Task 4); `LinkedAccount` (Task 1).

No unit test: this repo has no component-level tests for any renderer component (`Board.tsx`, `ImportModal.tsx`, etc. are all verified manually via `run-desktop`, not unit tests) — same convention applies here.

- [ ] **Step 1: Add the account chip to `NavBar`**

Replace `src/renderer/src/components/NavBar.tsx` with:

```tsx
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
      ? `✓ ${linkedAccount.username}`
      : `${linkedAccount.username} (unverified)`
    : 'Connect chess.com account'

  return (
    <header className="nav-bar">
      <span className="nav-brand">Chess Analyzer</span>
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'analyze' ? 'active' : ''}`}
          onClick={() => onSelectTab('analyze')}
        >
          Analyze{isAnalyzing ? ' ⏳' : ''}
        </button>
        <button
          className={`nav-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => onSelectTab('insights')}
        >
          Insights{isScanning ? ' ⏳' : ''}
        </button>
      </nav>
      <button className="account-chip" onClick={onOpenConnectModal}>
        {chipLabel}
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Create `ConnectAccountModal`**

Create `src/renderer/src/components/ConnectAccountModal.tsx`:

```tsx
import { useState } from 'react'
import type { LinkedAccount } from '../../../shared/types'

interface ConnectAccountModalProps {
  linkedAccount: LinkedAccount | null
  onClose: () => void
  onLinked: (account: LinkedAccount) => void
  onDisconnected: () => void
}

type Step = 'status' | 'enter-username' | 'awaiting-code'

export function ConnectAccountModal({
  linkedAccount,
  onClose,
  onLinked,
  onDisconnected
}: ConnectAccountModalProps): JSX.Element {
  const [step, setStep] = useState<Step>(linkedAccount ? 'status' : 'enter-username')
  const [username, setUsername] = useState(linkedAccount?.username ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const startLinkFor = async (targetUsername: string): Promise<void> => {
    const trimmed = targetUsername.trim()
    if (trimmed.length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsBusy(true)
    const result = await window.chessAPI.startAccountLink(trimmed)
    setIsBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setUsername(trimmed)
    setCode(result.code)
    setStep('awaiting-code')
  }

  const handleVerify = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    const result = await window.chessAPI.verifyAccountLink()
    setIsBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onLinked({ username: result.username, verifiedAt: result.verifiedAt })
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.chessAPI.disconnectAccount()
    onDisconnected()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="connect-account-modal" onClick={(e) => e.stopPropagation()}>
        {error && <div className="import-error">{error}</div>}

        {step === 'status' && linkedAccount && (
          <>
            <p>
              Connected as <strong>{linkedAccount.username}</strong>
              {linkedAccount.verifiedAt ? ' — Verified' : ' — Unverified'}
            </p>
            <div className="modal-actions">
              {!linkedAccount.verifiedAt && (
                <button onClick={() => void startLinkFor(linkedAccount.username)} disabled={isBusy}>
                  Verify it&apos;s you
                </button>
              )}
              <button onClick={() => void handleDisconnect()} disabled={isBusy}>
                Disconnect
              </button>
              <button onClick={onClose}>Close</button>
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
              <button onClick={() => void startLinkFor(username)} disabled={isBusy}>
                {isBusy ? 'Checking...' : 'Start'}
              </button>
            </div>
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
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
              <button onClick={() => void window.chessAPI.openChessComProfileSettings()}>
                Open chess.com profile
              </button>
              <button onClick={() => void handleVerify()} disabled={isBusy}>
                {isBusy ? 'Checking...' : "I've pasted it — Verify"}
              </button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `App.tsx`**

In `src/renderer/src/App.tsx`, add these two imports alongside the existing component imports:

```tsx
import { ConnectAccountModal } from './components/ConnectAccountModal'
import type { LinkedAccount } from '../../shared/types'
```

Add this state and effect right after the existing `const [activeTab, setActiveTab] = useState<AppTab>('analyze')` line:

```tsx
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccount | null>(null)
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)

  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => setLinkedAccount(settings.linkedAccount))
  }, [])
```

Then change:

```tsx
      <NavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAnalyzing={state.status === 'analyzing'}
        isScanning={insightsScan.state.status === 'scanning'}
      />
```

to:

```tsx
      <NavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAnalyzing={state.status === 'analyzing'}
        isScanning={insightsScan.state.status === 'scanning'}
        linkedAccount={linkedAccount}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
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
```

- [ ] **Step 4: Add the CSS**

In `src/renderer/src/app.css`, add at the end of the file:

```css
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
  border-radius: var(--radius);
  box-shadow: var(--shadow);
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
  border-radius: calc(var(--radius) * 0.5);
  padding: 0.5rem 0.75rem;
  margin: 0.5rem 0;
  font-size: 1rem;
  letter-spacing: 0.03em;
  text-align: center;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Build for the driver**

Run: `npm run build`
Expected: writes `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 7: Manually verify the chip reflects real state on launch**

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-chip-a.txt`:

```
launch
text .account-chip
ss chip-initial
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-chip-a.txt`
Expected: prints `zlakin (unverified)` — Task 1's migration already put an unverified `zlakin` link in the real settings file.

- [ ] **Step 8: Manually verify disconnect and relink through the modal**

Create `/tmp/claude-1000/-home-zacharyl-chess/verify-chip-b.txt`:

```
launch
click .account-chip
wait .connect-account-modal 5000
click-text Disconnect
sleep 300
text .account-chip
ss chip-disconnected
click .account-chip
wait .connect-account-modal 5000
fill input zlakin
click-text Start
wait .verification-code 15000
text .verification-code
ss chip-code-shown
click-text I've pasted it
sleep 500
text .import-error
ss chip-verify-not-found
```

Run: `node .claude/skills/run-desktop/driver.mjs /tmp/claude-1000/-home-zacharyl-chess/verify-chip-b.txt`
Expected:
- After disconnect: chip reads `Connect chess.com account`.
- After starting a new link for `zlakin` (a real chess.com account): a `CHESSANALYZER-XXXXXXXX`-shaped code appears.
- Clicking Verify without having actually pasted anything into a real chess.com profile in this automated run: an error containing `Didn't find the code in zlakin's profile location yet` appears, and the modal stays open (the negative path works correctly).

This step disconnects the real dev-machine's linked account as part of verifying the flow — that's expected and is restored (with real verification, this time) in the next step.

- [ ] **Step 9: Hand off the real ownership-proof step to the user**

This step needs an actual chess.com login and cannot be scripted or done by an agent. Tell the user:

> Run the app for real (`npm run dev`, or launch the packaged build), click the account chip, connect `zlakin`, copy the generated code, log into chess.com as `zlakin` in a browser, paste the code into Settings → Profile → Location, save it, then come back and click "I've pasted it — Verify." Confirm the chip flips to `✓ zlakin`, confirm the Insights tab still scans successfully, and optionally revert the Location field afterward.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/NavBar.tsx src/renderer/src/components/ConnectAccountModal.tsx src/renderer/src/App.tsx src/renderer/src/app.css
git commit -m "Add the connect-account chip and verification modal"
```

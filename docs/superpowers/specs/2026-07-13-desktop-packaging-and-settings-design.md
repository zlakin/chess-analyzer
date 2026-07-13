# Desktop Packaging + Settings Persistence — Design Spec

Date: 2026-07-13

## Purpose

Two related quality-of-life gaps in the current app:

1. Chess Analyzer can only be launched from a terminal (`npm run dev` /
   `npm start`). It should be installable and launchable like any other
   desktop app on the user's machine (CachyOS, KDE, pacman-based).
2. The chess.com username typed into the import flow is thrown away every
   time the app restarts — it should be remembered.

Both are foundational for the game-insights engine (a separate spec),
which needs a persisted username to know whose games to scan, and needs
the app to be a normal long-lived install rather than a dev server.

## Scope

- Package the app as a native `pacman` package via `electron-builder`,
  with an app icon and a `.desktop` entry so it appears in the KDE
  application launcher.
- Fix Stockfish binary resolution so it works from inside a packaged app
  (not just `npm run dev`).
- Persist the chess.com username locally and pre-fill it on the import
  screen. No settings UI — this is silent, automatic remembering, not a
  user-facing preferences panel.

Out of scope: Windows/macOS packaging (this machine is Linux-only), a
settings screen/panel, auto-update.

## Architecture

### Packaging

- Add `electron-builder` as a devDependency, configured via a `build` key
  in `package.json`:
  - `appId: com.chessanalyzer.app`, `productName: Chess Analyzer`.
  - `linux.target: pacman`, plus an icon (`build/icon.png`, 512×512 —
    created as part of implementation; a simple stylized chess piece).
  - `directories.output: release/`.
- New npm script: `build:linux` → `electron-vite build && electron-builder --linux pacman`.
- **Stockfish binary bundling.** `getStockfishBinaryPath()`
  (`src/main/engine/stockfishPath.ts`) currently resolves via
  `app.getAppPath()`, which returns a path inside `app.asar` once
  packaged — a binary cannot be executed directly from inside an asar
  archive. Fix:
  - electron-builder config adds `vendor/stockfish/**` as `extraResources`,
    landing it at `process.resourcesPath/vendor/stockfish/` in the
    installed package.
  - `getStockfishBinaryPath()` branches on `app.isPackaged`: packaged →
    `join(process.resourcesPath, 'vendor', 'stockfish', binaryName)`;
    dev → existing `app.getAppPath()`-based resolution.
- End users of the packaged app do not run `npm run setup:stockfish`
  themselves — the binary ships inside the package, downloaded once at
  build time on the developer's machine (the existing setup script is
  reused for this, just run before `electron-builder` packs
  `extraResources`).

### Settings persistence

- A small hand-rolled module, `src/main/settings/settingsStore.ts`:
  reads/writes a single JSON file at
  `join(app.getPath('userData'), 'settings.json')`.
  - Shape: `interface AppSettings { chessComUsername: string | null }`
    (deliberately minimal; the insights spec will extend this file with
    its own scan-metadata fields, additively).
  - `loadSettings(): AppSettings` — returns defaults
    (`{ chessComUsername: null }`) if the file is missing or fails to
    parse; never throws.
  - `saveSettings(patch: Partial<AppSettings>): void` — merges and
    writes synchronously (the file is tiny; async adds no real benefit
    and complicates startup ordering).
- No new dependency (e.g. `electron-store`) — one string today doesn't
  justify it, and the read/write logic is a handful of lines.
- New IPC, added to `src/shared/ipc.ts` / `handlers.ts` /
  `preload/index.ts` following the existing pattern:
  - `settings:get` → returns `AppSettings`.
  - `settings:set-chesscom-username` → persists a username.
- Renderer: `App.tsx` loads settings once on mount via
  `window.chessAPI.getSettings()` and passes `chessComUsername` down as
  the initial value for `ImportModal`'s username field (instead of the
  current hardcoded `''`). `ImportModal` calls
  `setChessComUsername` after a successful `Find Games` fetch.

## Error handling

- Settings file missing, unreadable, or containing invalid JSON →
  treated as empty defaults; never crashes app startup.
- Stockfish path resolution failure in the packaged app surfaces through
  the same existing "Could not start Stockfish: ..." error message
  (`handlers.ts`) — no new error path needed, just a different
  underlying path.

## Testing

- Unit tests for `settingsStore.ts`: load with missing file, load with
  corrupt JSON, save-then-load round trip (mocked `fs` /
  temp directory).
- Unit test for the `app.isPackaged` branch in `stockfishPath.ts` (both
  branches, mocked `electron.app`).
- Packaging is verified manually: `npm run build:linux`, `sudo pacman -U`
  the resulting package, confirm it appears in the KDE application
  launcher, launches, and successfully runs a Stockfish analysis.

## Future ideas (explicitly deferred)

- A real settings panel (if more preferences accumulate later).
- Windows/macOS packaging.
- Auto-update.

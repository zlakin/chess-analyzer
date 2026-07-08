# Chess Analyzer — Design Spec

Date: 2026-07-08

## Purpose

A free, local desktop chess analyzer that reproduces the core of chess.com's
paid "Game Review" feature: engine evaluation, move-quality classification,
accuracy scoring, and a visual eval-over-time report — without a
subscription.

## Scope (v1)

- Engine evaluation + best move/line for any position in a game.
- Move classification (Book / Best / Excellent / Good / Inaccuracy /
  Mistake / Blunder / Brilliant / Great).
- Per-player accuracy % and end-of-game summary.
- Game import via: paste PGN text, upload a `.pgn` file, fetch from
  chess.com (by username → recent games, or by game URL).

Out of scope for v1: mobile/web hosting, opening-explorer/book database
beyond a minimal move list, puzzle generation, multi-engine comparison,
lichess import (may be added later — chess.com's public API covers the
user's primary need).

## Architecture

- **Electron** desktop app, **TypeScript** throughout, scaffolded with
  `electron-vite` (React + TS template).
- **Main process** (Node.js):
  - Owns and manages a Stockfish subprocess, communicating via the UCI
    protocol.
  - Handles chess.com API fetches (keeps CORS out of the renderer).
  - Handles native "open file" dialogs for PGN upload.
- **Renderer process** (React):
  - Board UI (`react-chessboard`), eval bar, move list, eval-over-time
    graph, game summary panel, import modal.
  - Talks to main exclusively over a `contextBridge` IPC layer —
    `nodeIntegration` stays off in the renderer.
- **chess.js** handles PGN parsing, move legality, and FEN generation —
  no hand-rolled chess rules.
- Stockfish binary is **not committed to git**. A setup script downloads
  the right prebuilt binary for the developer's OS/arch on first run.

## Core analysis pipeline

1. User imports a game (paste / upload / chess.com fetch). Renderer
   parses the PGN with chess.js into an ordered list of positions (one
   FEN per ply).
2. Renderer asks main to analyze the full game. Main runs Stockfish over
   every position sequentially at a fixed depth (default depth 18–20,
   tunable), streaming each move's evaluation back over IPC as it
   completes — the UI fills in progressively instead of blocking on the
   whole game.
3. From the eval sequence, compute per move:
   - **Classification**, from centipawn-loss thresholds (the standard
     public approximation of chess.com/lichess-style labeling): "Best"
     when the played move matches the engine's top choice; "Brilliant"
     layers a sacrifice-that's-still-winning check on top of a near-best
     move; early moves matched against a small opening book are tagged
     "Book."
   - **Accuracy %**, via the same centipawn-loss decay-curve formula
     lichess/chess.com use, averaged (weighted) into a per-player
     game accuracy score.
4. UI: eval bar synced to the current board position, move list
   color-coded by classification, an eval-over-time graph across the
   game, click-any-move-to-jump navigation, and a best-line arrow
   overlay on the board.

## Game import & error handling

- **Paste PGN**: text box, parsed immediately with chess.js.
- **Upload PGN**: native OS file dialog (via main process) for a
  `.pgn` file.
- **Chess.com fetch**: enter a username to list recent games, or paste a
  direct game URL; pulled via chess.com's public read-only API (no auth
  required).
- **Error handling**:
  - Stockfish binary missing or crashes → clear in-app message; app
    keeps running.
  - Malformed/invalid PGN → inline parse error, no crash.
  - Chess.com fetch failures (not found, rate-limited, offline) →
    user-facing error message.
  - Long games run analysis in the background with a progress bar and a
    cancel button, rather than blocking the UI thread.

## Testing

- Unit tests (Vitest) for:
  - PGN parsing edge cases.
  - Accuracy formula.
  - Move classification logic.
  - Engine manager, tested against a mocked UCI process (no real
    Stockfish binary required in CI).
- No end-to-end tests in v1. Manual verification is done by running the
  actual app against real games.

## Repo setup

- GitHub repo: `chess-analyzer`, **public**, MIT license.
- Initialized locally with `git init`, scaffolded via `electron-vite`
  (React + TS template), pushed via `gh repo create`.
- `.gitignore` excludes `node_modules/`, build output, and the
  downloaded Stockfish binary.

## Future ideas (explicitly deferred)

- lichess import.
- Opening explorer / book database.
- Packaged installers (electron-builder) for distribution beyond the
  developer's own machine.

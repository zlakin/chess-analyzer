# Chess Analyzer

A free, local desktop chess analyzer that reproduces the core of
chess.com's paid "Game Review" feature — engine evaluation, move-quality
classification, and accuracy scoring — without a subscription.

Runs entirely on your machine using a locally-run Stockfish engine.

See [`docs/superpowers/specs/2026-07-08-chess-analyzer-design.md`](docs/superpowers/specs/2026-07-08-chess-analyzer-design.md)
for the full design.

## Status

Functional: game import (paste PGN, upload file, or search chess.com by
username), full engine analysis with move classification and accuracy
scoring, and the board/eval-bar/move-list/eval-graph UI are all implemented
per the [implementation plan](docs/superpowers/plans/2026-07-08-chess-analyzer-implementation.md).

Dependency installs require `--legacy-peer-deps` (enforced via the
committed `.npmrc`) because `electron-vite@5`'s `vite` peer range
(`^5 || ^6 || ^7`) lags the `vite@^8` this project pins for
`@vitejs/plugin-react@6`; plain `npm install` / `npm ci` otherwise fail
with an ERESOLVE conflict.

## Getting started

```bash
npm install
npm run setup:stockfish   # downloads the Stockfish binary into vendor/stockfish/
npm run dev                # launches the Electron app
```

`npm test` runs the Vitest suite; `npm run typecheck` runs `tsc -b` across
the project references.

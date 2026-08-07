# Study Room

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

Move classification and accuracy scoring are computed from win
probability rather than raw centipawn loss, so a mistake is judged by how
much it actually hurt your chances of winning, not just by the engine's
raw score swing. Accuracy follows Lichess's published volatility-weighted
aggregation, which reads lower than a plain average of per-move
accuracy — that's expected, not a regression. When an app update changes
the analysis rules, existing cached games are kept and the Insights
header prompts a rescan instead of the cache being wiped and every game
needing to be reanalyzed from scratch.

## Getting started

```bash
npm install
npm run setup:stockfish   # downloads the Stockfish binary into vendor/stockfish/
npm run dev                # launches the Electron app
```

`setup:stockfish` picks the fastest Stockfish build your CPU actually
supports (e.g. avx2, bmi2) rather than always grabbing the generic SSE2
build, trying candidates best-first and falling back to the next one if a
downloaded binary doesn't run. On one development machine the matched
build ran at 1,929,267 nodes/second versus 1,146,986 for the generic
build — the gain will vary by CPU. The chosen build is recorded in
`vendor/stockfish/version.json`; a later run reuses it as long as that
file still matches and the binary still executes, so delete
`version.json` to force a fresh best-first pick (the short-circuit never
upgrades you to a faster build on its own).

Packaged builds can't use a CPU-matched binary, since the machine that
runs `electron-builder` isn't the machine that runs the app — shipping
whatever build happens to match the build machine's CPU could crash on
an end user's older hardware. `npm run build:linux` therefore runs
`npm run setup:stockfish:dist` first, which downloads the generic build
into a separate `vendor/stockfish-dist/` that packaging reads via
`extraResources`. `build:linux` is the only supported way to package:
`extraResources` warns and carries on when a source path is missing, so
invoking `electron-builder` directly with no `vendor/stockfish-dist`
present exits 0 and produces an installer with no engine in it — the app
then fails with "Stockfish is not installed at …" the first time a user
asks for an analysis. Nothing checks for you.

`npm test` runs the Vitest suite; `npm run typecheck` runs `tsc -b` across
the project references.

## Website

A static marketing/waitlist site lives in `website/` (deployed via Netlify,
config at the repo-root `netlify.toml`) — see
[`docs/superpowers/specs/2026-07-25-marketing-website-design.md`](docs/superpowers/specs/2026-07-25-marketing-website-design.md)
for the design.

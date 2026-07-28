# Analysis foundation: correct classification, honest accuracy, faster engine

Date: 2026-07-28
Status: direction approved; spec pending review

## Problem

Study Room's headline outputs — the move classification badges, the
"Brilliant!"/"Great" labels, and the accuracy percentages — are computed
in units that contradict each other. The app also runs its engine at a
small fraction of the available hardware. Both are foundational: the
Insights scan, the mistake records on disk, and every SRS puzzle answer
are all derived from the classifier, and every tab waits on the engine.

Four defects, each verified against the code:

1. **A move can be a "Blunder" and 98.5% accurate simultaneously.**
   `classification.ts` tiers on raw centipawn loss; `accuracy.ts` scores
   on win percentage. An evaluation moving +2000 → +1500 is
   `cpLoss = 500` → `blunder`, but only a 0.34-point win-percent drop →
   `moveAccuracy` ≈ 98.5.

2. **Mate distance is treated as material.** `effectiveCp` maps mate to
   `±(100000 − 100·|mate|)`, and that value feeds the centipawn tiers.
   Mate-in-3 → mate-in-8 reads as a 500 cp `blunder` despite both being
   forced wins.

3. **"Brilliant!" fires on ordinary moves.** `pgn.ts` defines a sacrifice
   as `capturedValue < movedValue && isAttacked(to, opponent)`. For any
   non-capturing pawn move that reduces to `0 < 1 && attacked`, so every
   pawn push to a defended square qualifies. The team already hit this
   with 3...a6 in the Ruy Lopez and worked around it by padding
   `openingBook.ts` with extra theory moves — a fix that covers only the
   70 booked lines. `great` has the mirror problem: it fires on any best
   move with a ≥150 cp gap to second-best, which every recapture clears.

4. **Accuracy reads systematically high.** `gameAccuracy` is a plain
   arithmetic mean. Both Lichess and chess.com penalise volatility, so
   this over-reports on the one number users will directly cross-check
   against the chess.com game review the app is positioned against.

Separately, measured on a Ryzen 7700X:

| Stockfish build | nodes/sec | vs. current |
| --- | ---: | ---: |
| generic SSE2 (`stockfish-ubuntu-x86-64.tar`, what ships) | 1,106,154 | 1.00x |
| avx2 / bmi2 | 1,749,838 | 1.58x |
| avx512 | 1,844,254 | 1.67x |
| vnni512 | 1,864,373 | 1.69x |

| config (avx512 build) | nodes/sec |
| --- | ---: |
| 16 MB hash / 1 thread — today's defaults | 1,849,243 |
| 256 MB hash / 1 thread | 1,779,859 |
| 256 MB hash / 8 threads | 14,045,294 |

`setoption` appears exactly once in the entire codebase (`MultiPV`), so
every engine runs Stockfish's defaults of one thread and 16 MB. Hash size
barely matters for short searches; threads are worth ~7.6x raw nodes/sec
on the interactive engine. And the Insights scan — the longest operation
in the app — wraps a *single* engine in `serialized()` while
`createEnginePool` sits unused two files away.

## Goals

- Classification and accuracy expressed in one unit: win probability.
- "Brilliant" and "Great" mean what a player thinks they mean.
- Accuracy computed by a published, defensible method.
- Every engine sized to the hardware it runs on.
- No user data destroyed by any of the above.

## Non-goals

- Exact numerical parity with chess.com. CAPS2 is proprietary; we match
  Lichess's published method instead and say so.
- Changing the per-move accuracy curve. `moveAccuracy`'s Lichess
  formulation is already correct; only aggregation changes.
- Any UI work beyond the one rescan banner in Migration below.
- Engine streaming, infinite analysis, PV panels, threat detection.
  These are real gaps but belong to a later, separate piece of work.

---

## Part 1 — Correctness

### 1.1 Win probability as the classification unit

`src/shared/engineMath.ts` gains:

```ts
export function winPercent(line: EngineLine): number
```

Mate saturates to 100 / 0 rather than riding the ±100000 cp ramp;
otherwise it is `cpToWinPercent(line.scoreCp ?? 0)`. This is what fixes
defect 2: any two mating lines are both 100, so trading one forced mate
for another is a zero-point loss.

`MoveEvalDelta` gains `winPercentLoss: number`, computed from the mover's
perspective. Note the ordering — the raw loss must be computed *before*
`isBestMove`, because 1.5 below makes `isBestMove` depend on it:

```ts
const rawWinPercentLoss = Math.max(0, winPercentBefore - winPercentAfter)
const isBestMove = bestLineBefore.moveUci === playedMoveUci
  || rawWinPercentLoss <= BEST_MOVE_TOLERANCE   // see 1.5
const winPercentLoss = isBestMove ? 0 : rawWinPercentLoss
```

`cpLoss` keeps its existing `isBestMove ? 0 : ...` shape and therefore
picks up the widened `isBestMove` for free.

`cpLoss` and `effectiveCp` are unchanged and keep their existing
consumers: the eval bar, `formatScore`, `cpLossToQuality`, and the
`cpLoss` field persisted on every stored mistake.

### 1.2 Retier `classifyMove`

`src/main/analysis/classification.ts` replaces `CP_LOSS_TIERS` with tiers
on `winPercentLoss`:

| win% loss | label |
| --- | --- |
| < 2 | excellent |
| < 5 | good |
| < 10 | inaccuracy |
| < 20 | mistake |
| otherwise | blunder |

These are not new thresholds. They are the *existing* thresholds
re-expressed in the correct unit — at an evaluation of 0, the current
centipawn boundaries convert almost exactly onto them:

| current cp boundary | win% loss at eval 0 | new tier |
| ---: | ---: | --- |
| 20 | 1.84 | excellent |
| 50 | 4.59 | good |
| 100 | 9.10 | inaccuracy |
| 200 | 17.62 | mistake |
| 300 | 25.11 | blunder |

The consequence is that near-equal positions — the overwhelming majority
of real moves — classify identically to today. Behaviour changes only in
decided positions and mate sequences, which is precisely where the
current output is wrong. This property should be asserted by a test.

### 1.3 Static exchange evaluation

New module `src/shared/analysis/see.ts`:

```ts
export function staticExchangeEval(fen: string, from: Square, to: Square): number
```

Standard SEE swap-off, implemented over `chess.js@1.4.0`'s
`attackers(square, color)` (verified present) plus `remove()` / `put()`
on a scratch `Chess` instance. Because attackers are re-queried after
each simulated capture, x-ray attackers behind a captured piece are
handled naturally. Piece values in centipawns: `p 100, n 320, b 330,
r 500, q 900, k 20000`.

Two details the implementation must get right:

- **King captures.** A king may only take on the target square if the
  opposing side has no attacker left. Stop the swap-off before an illegal
  king recapture rather than counting it.
- **Promotion and en passant.** A promoting capture gains the promoted
  piece's value less a pawn; an en-passant capture removes a pawn from a
  square that is not the destination.

`AnalyzedPosition` (`src/shared/types.ts`) then changes:

- `isPotentialSacrifice: boolean` is **removed**.
- `seeCp: number` is added — the SEE of the played move.
- `isCapture: boolean` is added — needed for recapture detection in 1.4.
- `legalMoveCount: number` is added — needed for only-move detection.

All three are computed in `parsePgn`, which already has each move's
`before` FEN and chess.js's verbose move object in hand.

`pgn.test.ts` currently pins the 3...a6 false positive as documented
behaviour. That test inverts: 3...a6 must now report a non-sacrificial
SEE.

### 1.4 Gate `brilliant` and `great`

`brilliant` requires all of:

- `isBestMove`
- `seeCp <= -150` — a real material sacrifice, not a defended pawn push
- `|evalBeforeMoverCp| < 600` — position not already decided (unchanged)
- `evalAfterMoverCp >= -50` — the sacrifice actually works
- `secondBestMoverCp !== null && evalBeforeMoverCp - secondBestMoverCp >= 100`
  — the sacrifice is *necessary*. If a quiet move holds the position just
  as well, the sacrifice is a good move, not a brilliant one.

`great` keeps its existing conditions and adds:

- `!isRecapture` — the move is a capture on the square the opponent's
  previous move landed on. `gameAnalyzer` has the full `positions` array
  in scope, so the previous ply's destination is
  `positions[k - 1].moveUci.slice(2, 4)`.
- `legalMoveCount > 1` — a forced move is not a great one.

Both extra inputs are threaded into `ClassifyMoveInput`. A move that
fails these gates falls through to `best`, which is the correct label.

### 1.5 `isBestMove` tolerance

Today `isBestMove` is exact string equality against `lines[0].moveUci`,
so a move that *ties* the engine's top line is demoted to `excellent`.
Accept a move as best when the UCI matches **or** when the raw
win-percent loss is within `BEST_MOVE_TOLERANCE = 0.2`. See 1.1 for the
required evaluation order. The tolerance is deliberately tight; this is
the lowest-confidence change in Part 1 and should ship with a test
pinning that a clearly-inferior move is still not `best`.

### 1.6 Accuracy aggregation

`gameAccuracy` is replaced with Lichess's published method:

1. Build the white-perspective win percent for every position in the
   game, starting position first (length `moves.length + 1`).
2. `windowSize = clamp(floor(n / 10), 2, 8)`.
3. Windows are `windowSize - 2` copies of the first window, followed by
   every sliding window of that size.
4. Each move's weight is the standard deviation of its window's win
   percents, clamped to `[0.5, 12]`.
5. Per colour, the result is the mean of the weighted mean and the
   harmonic mean of that colour's move accuracies.

The signature changes to carry the data this needs:

```ts
export interface AccuracyInput {
  /** White-POV win percent per position, starting position first. */
  winPercents: number[]
  /** Per-move accuracy and mover colour, in ply order. */
  moves: Array<{ accuracy: number; color: 'w' | 'b' }>
}
export function gameAccuracy(input: AccuracyInput): { white: number; black: number }
```

`analyzeGame` already holds both `evalBefore`/`evalAfter` per move and
the accuracy it computed, so it can build this without extra engine work.

The harmonic mean pulls the result down when a game contains a few very
bad moves, which is the behaviour a plain mean lacks and the reason the
current number reads high. This will make reported accuracies *lower*
than they are today — that is the intended correction, and the release
note should say so plainly.

---

## Part 2 — Speed

### 2.1 CPU-matched Stockfish, with a smoke test as the safety net

`scripts/downloadStockfish.mjs` changes from one hardcoded asset per
platform to an **ordered candidate list**, verified against the actual
`sf_18` release:

- `linux-x64`: `vnni512`, `avx512`, `bmi2`, `avx2`, `sse41-popcnt`, generic
- `darwin-x64`: `bmi2`, `avx2`, `sse41-popcnt`, generic
- `darwin-arm64`: `m1-apple-silicon` (single asset)
- `win32-x64`: `vnni512`, `avx512`, `bmi2`, `avx2`, `sse41-popcnt`, generic

CPU feature detection (`/proc/cpuinfo` on Linux, `sysctl machdep.cpu` on
macOS) picks the starting candidate. **Detection is only an
optimisation.** The guarantee comes from a smoke test: each candidate is
downloaded, extracted, and run with `uci` / `quit`; if it does not print
`uciok` — because it crashed with SIGILL on an unsupported instruction,
or for any other reason — the script falls to the next candidate. This
means Windows needs no CPUID parsing at all, and a wrong detection is
self-correcting rather than fatal.

A stamp at `vendor/stockfish/version.json` records
`{ releaseTag, asset, sha256 }`. The current `existsSync` early-return is
replaced by a stamp comparison, so bumping `STOCKFISH_RELEASE_TAG`
actually replaces the binary — today it silently does nothing. The
recorded sha256 is verified on every subsequent run, giving tamper
detection across runs. It does **not** authenticate the first download;
that relies on HTTPS to github.com, and the spec should not claim
otherwise.

**Packaging safety.** `electron-builder` ships `vendor/stockfish` as
`extraResources`, so a packaged build would otherwise carry whatever the
build machine downloaded and SIGILL on a user's older CPU. To prevent
this, the optimised binary stays at `vendor/stockfish/` for local use,
and a new `setup:stockfish:dist` script fetches the **generic** asset to
`vendor/stockfish-dist/`. `extraResources` and `build:linux` point at
`vendor/stockfish-dist`. Distribution correctness never depends on the
developer's CPU.

`getStockfishBinaryPath` gains an `existsSync` check so a user who
skipped setup gets a remediation hint instead of a raw
`spawn ... ENOENT`.

### 2.2 Configure Threads and Hash

`StockfishManager`'s constructor accepts `{ threads?: number; hash?: number }`.
`start()` sends `setoption name Threads` / `setoption name Hash` after
`uciok` and before `isready`, which is the correct UCI ordering.

Budgets, following the measurements above (threads matter, hash does not
much):

- **Pool engines** (whole-game analysis, Insights scan): `threads: 1` —
  parallelism already comes from running N engines across N positions.
  Hash sized to fit a total budget of ~1 GB across the pool, clamped to
  `[16, 256]` MB each.
- **Exploration singleton** (interactive board, puzzle and mistake
  grading): `threads: max(1, floor(cpus / 2))`, `hash: 256`. This is the
  7.6x case — a single position, currently on a single thread.

`poolSize` is raised from `min(6, cpus - 2)` to `clamp(cpus - 2, 1, 12)`,
leaving headroom for the UI. Its existing test updates accordingly.

### 2.3 Insights scan on the engine pool

`ScanRunnerOptions.createEngine` becomes a pool factory; the `serialized()`
wrapper is deleted. `analyzeGame` already dispatches every position in a
game concurrently and `EnginePool` already enforces one call per engine,
so this change is mostly deletion.

`ScanProgress` gains `etaMs: number | null`, computed from a rolling mean
of per-game wall time times games remaining, and `InsightsTab` renders it
next to the existing counter. An hour-long job with no ETA is the single
biggest barrier to a user ever seeing an Insights report.

---

## Migration — no data loss

Changing the classifier invalidates every cached `GameInsightRecord`.
They cannot be reclassified in place: `GameInsightMistake` stores
`cpLoss` but not the absolute evaluations, and win-percent loss depends
on the absolute evaluation, not just the delta.

The obvious move — bump `CURRENT_SCHEMA_VERSION` — is a trap.
`ensureSchemaVersion()` unlinks every file in `games/` on any version
mismatch, and it is called from four **read** paths
(`handlers.ts:174,184,204,212` — `getInsightsReport`, `getMistakeDetail`,
`getMasteryTree`, `getNodeQueue`). Bumping the version means that merely
opening the Insights or Puzzles tab silently destroys hours of engine
work, with no warning and no backup. It also orphans every SRS card,
since `srs-state.json` is keyed by `${gameUrl}#${ply}`.

Instead:

1. `ensureSchemaVersion()` stops deleting. On a version mismatch it
   records the stale version and returns; records stay readable and the
   existing report keeps rendering.
2. `isGameScanned(url)` returns `false` for a record written under an
   older schema version, so a rescan re-analyses it. `saveGameRecord`
   already overwrites per game, so the library is rebuilt incrementally
   and a cancelled rescan loses nothing.
3. `getInsightsReport` returns a `staleSchema: boolean`. `InsightsTab`
   renders "Analysis improved — rescan to update your report" using the
   existing stale-scan banner styling, next to the existing Rescan
   button.
4. `GameInsightMistake` gains `evalBeforeMoverCp` and `winPercentLoss`,
   so the *next* classifier change can be applied in place with no
   rescan at all.

The per-record schema version needs to be readable per file for step 2;
today only `scan-meta.json` carries one. Records gain a `schemaVersion`
field, and a record without one is treated as version 1.

## Testing

The suite is currently 350 tests across 48 files, all green, with
`tsc -b` clean. That is the bar to hold.

New test files:

- `see.test.ts` — the substantial one. Simple recapture chains, x-ray
  attackers behind a rook, defended vs. undefended pieces, the illegal
  king recapture, promotion captures, en passant, and specifically that
  a pawn push to a defended square is **not** a sacrifice.
- `winPercent` cases in `engineMath.test.ts` — mate saturation both
  signs, mate-to-mate is a zero loss, mate-to-non-mate.

Updated:

- `classification.test.ts` — re-expressed in win-percent loss. Add
  regressions for each defect: `+2000 → +1500` is not a blunder;
  mate-3 → mate-8 is not a blunder; a recapture is not `great`; a
  forced move is not `great`; a defended pawn push is not `brilliant`.
- `accuracy.test.ts` — weighted/harmonic aggregation, including that a
  game with one catastrophic move scores below the arithmetic mean.
- `pgn.test.ts` — the 3...a6 expectation inverts.
- `enginePool.test.ts` — new `poolSize` bounds.
- `scanRunner.test.ts` — pool factory instead of `createEngine`.
- `insightsStore.test.ts` — the non-destructive migration: a stale
  record survives `ensureSchemaVersion`, is reported `staleSchema`, and
  is treated as unscanned.

A calibration test should assert the 1.2 property directly: across a
table of centipawn losses at evaluation 0, old and new classifiers agree.

## Risks

- **Accuracy numbers move.** Every displayed accuracy drops somewhat.
  This is intended, but it is user-visible on a headline number and
  should be called out in the commit message.
- **SEE is easy to get subtly wrong.** It is the one genuinely intricate
  algorithm here. It is isolated in a pure module with no I/O, which is
  why it gets the heaviest test file.
- **`AnalyzedPosition` changes shape**, and it crosses the IPC boundary.
  Renderer, main, and the scan all construct it via `parsePgn`, so there
  is a single source, but the type change will surface as compile errors
  across several files — which is the desired behaviour.
- **The candidate-list download does more work on failure.** A machine
  where detection is wrong downloads ~114 MB per rejected candidate.
  Detection should be right on the common paths; the smoke test is the
  fallback, not the primary mechanism.

## Rejected

- **Bumping the schema version and letting the wipe run.** Fastest to
  implement, destroys user data from a read path. Covered above.
- **Shipping two binaries and choosing at runtime.** Safe and fast for
  everyone, but the binary is 113 MB and doubling the package is a poor
  trade for ~1.7x.
- **Adding Lichess's `+1` bonus to `moveAccuracy`.** It would nudge
  reported accuracy toward chess.com's numbers, but it is an arbitrary
  fudge factor and the current per-move curve is already correct.
  Aggregation is where the real bias is.
- **Retuning the tier thresholds to "feel right".** The thresholds are
  deliberately calibrated to reproduce today's behaviour at evaluation 0.
  Changing the unit and the thresholds at once would make it impossible
  to tell which change caused a given difference.

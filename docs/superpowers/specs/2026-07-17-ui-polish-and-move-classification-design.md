# UI Polish & Move Classification — Design Spec

Date: 2026-07-17

## Purpose

The [2026-07-13 UI redesign](2026-07-13-ui-redesign-design.md) gave the app
a navigation shell and a first pass at dark styling, but it deliberately
copied chess.com's green (`#7fa650`) and kept the system-font stack, and
its "classification badges" ended up as plain text-color changes with a
suffix glyph (`app.css:306-340`). The result reads as a generic,
templated dark-mode dashboard rather than a crafted tool — and move
quality is hard to read at a glance (color alone, no icon, no board
annotation, a bare counts table in the summary).

This spec redesigns the app's visual identity end-to-end and makes move
classification the centerpiece: an icon+color language used consistently
in the move list, on the board itself, and in the game summary, plus a
plain-language move-detail readout.

## Scope

Everything in `src/renderer/src/**` — every component and `app.css`. No
changes to analysis logic, IPC surface, or the underlying
`MoveClassification` data (`src/main/analysis/classification.ts` is
untouched; this is a rendering-layer change over data that already
exists).

Out of scope (explicitly deferred): light theme/toggle, a settings panel,
board themes/piece sets, engine-line (PV) display, PGN export, any change
to classification thresholds.

## Visual identity — "Walnut & Ivory"

Replaces the current neutral-gray/olive-green token set in `app.css:1-12`.

```css
--bg: #191512;              /* app background, warm near-black */
--panel: #221d18;           /* card/panel surface */
--panel-elevated: #2b241d;  /* nested surfaces: inputs, hovered rows */
--border: #3a312a;
--border-strong: #4a3f35;
--text: #f1e9dd;            /* ivory */
--text-muted: #a69a88;
--text-faint: #7a6f60;
--accent: #c98a3e;           /* brass — primary interactive color */
--accent-hover: #dda255;
--accent-contrast: #1a1410;  /* text placed on brass backgrounds */
--radius-panel: 10px;
--radius-control: 7px;
--shadow-modal: 0 8px 24px rgba(0, 0, 0, 0.45);
```

`--radius` and `--shadow` (`app.css:10-11`) are removed; every rule that
currently references them (`.import-modal`, `.move-list`, `.eval-graph`,
`.game-summary`, `.insights-tab`, `.time-control-section`, buttons,
inputs, `.connect-account-modal`, etc.) is migrated to `--radius-panel`
or `--radius-control` as appropriate, and `--shadow` usage is dropped
except where `--shadow-modal` now applies (`.connect-account-modal`,
`.modal-backdrop`'s child, and the `NavBar` sticky header).

Brass (`--accent`) replaces chess.com-green as the *only* brand/interactive
color: active nav tab, primary buttons, links, focus rings, selected-move
row highlight. It is used sparingly, not as a fill color for large areas.

Elevation is conveyed primarily by the `bg → panel → panel-elevated`
background steps; `--shadow-modal` is reserved for genuinely elevated
surfaces (modals, the sticky nav bar) — not applied uniformly to every
panel like today's single `--shadow` (`app.css:11`, used on 5+ unrelated
elements).

Radius is no longer one uniform 12px: panels get `--radius-panel` (10px),
buttons/chips/inputs get the tighter `--radius-control` (7px). Uniform
rounding on both large panels and small chips is part of what reads as
templated today.

### Typography

Three self-hosted font families via `@fontsource` (new dependencies:
`@fontsource/manrope`, `@fontsource/fraunces`, `@fontsource/ibm-plex-mono`),
imported once in `main.tsx` alongside `app.css`. Self-hosted means no
network dependency at runtime — safe for an offline-capable Electron app.

- **Fraunces** (serif, weights 500/600) — the `Chess Analyzer` wordmark in
  `NavBar` and section headers (`Insights` bucket titles). Used sparingly;
  never body text.
- **Manrope** (weights 400/500/600/700) — all UI body text, replacing the
  `system-ui, -apple-system, 'Segoe UI', sans-serif` stack in `app.css:22`.
- **IBM Plex Mono** (weights 400/500) — evaluation scores (`EvalBar`,
  move-detail readout), accuracy percentages, centipawn deltas, and the
  chess.com verification code (`ConnectAccountModal`'s `.verification-code`,
  currently inheriting the UI font).

## Move classification system

### Color ramp (semantic — unchanged in meaning, new hex values)

```css
--mq-brilliant: #22d3ee;   /* cyan */
--mq-great: #2dd4bf;       /* teal */
--mq-best: #4ade80;        /* green */
--mq-excellent: #86d99a;   /* soft green */
--mq-good: #9fb08c;        /* sage */
--mq-book: #a8a29e;        /* neutral tan-gray */
--mq-inaccuracy: #fbbf24;  /* amber */
--mq-mistake: #fb923c;     /* orange */
--mq-blunder: #f0554a;     /* red, warmed slightly to sit next to brass */
```

These replace the current ad hoc hex values in `app.css:306-324` and the
hardcoded `fill="#7fa650"` / `stroke="#9a9ea8"` strings in
`TimeControlSection.tsx:61-64,95` and `EvalGraph.tsx:29-30,41-43` — chart
fills switch to `var(--mq-best)` / `var(--accent)` / `var(--text-muted)`
so there's a single source of truth for these colors.

### Icon set

New dependency: `lucide-react` (tree-shakeable, named imports only — no
bundle-size concern for a desktop app). One icon per classification,
defined once as a `Record<MoveClassification, LucideIcon>` next to
`CLASSIFICATION_LABELS` in `MoveList.tsx` so `MoveList`, the board badge,
and `GameSummary` all reference the same map instead of re-deriving it:

| Classification | Icon | Color |
|---|---|---|
| brilliant | `Sparkles` | `--mq-brilliant` |
| great | `Star` | `--mq-great` |
| best | `CircleCheck` | `--mq-best` |
| excellent | `Check` | `--mq-excellent` |
| good | `Check` | `--mq-good` |
| book | `BookOpen` | `--mq-book` |
| inaccuracy | `TriangleAlert` | `--mq-inaccuracy` |
| mistake | `CircleAlert` | `--mq-mistake` |
| blunder | `CircleX` | `--mq-blunder` |

This map moves to a new `src/renderer/src/lib/moveClassificationStyle.ts`
(icon component + color + label per `MoveClassification`) since it's now
shared by three components rather than living inline in `MoveList.tsx`.

### Move list (`MoveList.tsx`)

Each move renders as an icon badge + SAN + the existing NAG suffix
(`!!`/`!`/`?!`/`?`/`??`, `app.css:326-340`) — the icon is additive, not a
replacement for the chess-literate NAG convention. The selected row gets a
`--accent`-tinted background instead of today's `outline: 2px solid`
(`app.css:302-304`), consistent with the "background steps convey state"
approach used elsewhere.

### On-board badge (new)

Uses `react-chessboard`'s `squareRenderer` prop (confirmed present on the
installed v5 `ChessboardOptions` type) to overlay a small circular icon
badge, colored per `--mq-*`, pinned to the corner of the destination
square of the **currently-viewed move only** — it travels as the user
steps through the game via `goToPly`. Because only one badge is ever shown
at a time, there's no clutter concern with showing it for every
classification including `book`. Independent of the existing best-move
`arrows` prop; both can render together.

### Move-detail readout (new)

A new line in the `board-column`, below the board, showing the selected
move in plain language, e.g. *"Qh5 — Blunder, -38% win chance. Best was
Nf3."* Built from data already on `AnalyzedMove`/`AnalyzedPosition`
(`classification`, `evalBefore`/`evalAfter` via the existing
`whiteWinPercent`/`formatScore` helpers in `displayEval.ts`,
`bestMoveUci` already passed to `Board`) — no new IPC or analysis data
needed. Omitted for `book` moves (nothing useful to say) and for the
initial position (ply 0, no move played yet).

### Legend

A small always-visible key (icon + color + label for all 9 classes) added
to `GameSummary`, above the redesigned breakdown — addresses that 9
categories is too many to expect users to memorize from color alone.

### Game summary (`GameSummary.tsx`)

Replaces the plain `<table>` (`app.css:359-377`) with:
1. Two accuracy "scorecards" (large number + username), replacing
   `.accuracy-row`.
2. A horizontal stacked bar per player — one `recharts` `BarChart` with a
   single horizontal bar, segments colored by `--mq-*`, one per
   classification with `count > 0` — giving an immediate visual read of
   the game's move-quality distribution. Uses the `recharts` dependency
   already in the app; no new charting library.
3. The classification legend described above, doubling as the bar chart's
   key.

## Rest of the app

- **`NavBar.tsx`**: Fraunces wordmark; `.nav-tabs` becomes a segmented
  control (shared `.segmented-control` class, reused by `ImportModal`'s
  tabs) with a brass active state; `.account-chip` becomes a pill with
  distinct verified (brass check) vs. unverified (muted outline) styles
  instead of today's plain-text conditional label.
- **Board controls (`App.tsx:141-165`)**: the ⏮◀▶⏭ Unicode glyphs become
  `lucide-react` icons (`ChevronsLeft`, `ChevronLeft`, `ChevronRight`,
  `ChevronsRight`); the `⏳` suffix in `NavBar` becomes an animated
  `Loader2` icon. Unicode glyphs render inconsistently across platforms/
  fonts — small thing, but it's a "generated by AI" tell.
- **`EvalBar.tsx`**: rounded end caps, a soft gradient at the black/white
  boundary instead of a hard cut, score label restyled with
  `--accent-contrast`/Plex Mono.
- **`EvalGraph.tsx`**: area fill switches from raw `#ececec` to
  `var(--text)`/`var(--accent)`; reference line switches from raw
  `#7fa650` to `var(--accent)`.
- **`ImportModal.tsx`**: `.import-tabs` reuses the new
  `.segmented-control`; `.chesscom-game-list` rows become cards (player
  names, ratings, a color-coded result indicator, right-aligned date)
  instead of plain left-aligned buttons; inputs get the brass focus ring.
- **`ConnectAccountModal.tsx`**: consistent modal panel treatment (shared
  with `ImportModal`'s panel styling); `.verification-code` uses Plex
  Mono; button hierarchy becomes explicit (one brass-filled primary
  action per step, ghost/secondary for Cancel/Close).
- **`InsightsTab.tsx` / `TopFindingsList.tsx` / `TimeControlSection.tsx`**:
  section headers in Fraunces; `TopFindingsList`'s bare `<ul>` becomes a
  card list with a small icon per finding; `TimeControlSection` charts
  recolored per the shared-token change noted above.

## Error handling

No new error paths — presentational change only. Existing error states
(`import-error`, analysis cancelled/error, scan cancelled/error) keep
their current triggers, restyled to the new palette (`--mq-blunder`
background tint instead of the current hardcoded `#3a1c1c`/`#a33`).

## Testing

- Existing Vitest component/unit tests are unaffected (no logic or prop
  contract changes) and must keep passing.
- Verified visually via the `run-desktop` skill: screenshots of the
  Analyze tab (import state, mid-analysis, done state with a game that
  has at least one of each notable classification), the on-board badge
  while stepping through moves, and the Insights tab, checked against
  this design direction.

## Future ideas (explicitly deferred)

- Light theme / theme toggle.
- Board themes / piece sets.
- Engine-line (PV) panel, PGN export.

# UI Redesign — Design Spec

Date: 2026-07-13

## Purpose

The current UI is a functional prototype: plain system font, flat panel
colors, no visual hierarchy, a single blocking import screen, and no
navigation structure. This redesign gives the app a polished, cohesive
look (dark, chess.com-inspired) and adds the navigation shell that the
upcoming game-insights feature (a separate spec) needs to live somewhere.

## Scope

- A persistent app shell with top-level navigation between an **Analyze**
  tab (today's single-game flow) and an **Insights** tab (new — its
  content is specified separately, this spec only reserves the tab and
  its empty state).
- A refreshed visual system: color, typography, spacing, elevation,
  classification badges.
- Un-blocking the import flow so the nav bar is always visible.

Out of scope: any change to analysis logic, IPC surface, or the
board/eval-bar/move-list/eval-graph components' underlying data — this
is styling, layout, and navigation only. Light theme / theme toggle is
explicitly out of scope (dark-only, refined, per decision).

## Architecture

### App shell

- `App.tsx` gains a top bar: `Chess Analyzer` wordmark left-aligned, two
  nav buttons (`Analyze`, `Insights`) right-aligned. Active tab is local
  `useState<'analyze' | 'insights'>` — two tabs don't warrant a router
  dependency.
- No settings affordance in the shell (no settings UI exists per the
  packaging/settings spec's minimal-persistence decision).

### Analyze tab

- Contains exactly what `App.tsx` renders today: `ImportModal` when no
  game is loaded, then the board/eval-bar/move-list/eval-graph/summary
  layout once one is. The only structural change is that this content
  now sits *below* the persistent top bar instead of being the entire
  screen — `ImportModal` stops being a modal-styled full-page blocker and
  becomes an inline panel within the tab.

### Insights tab

- New tab, empty state only in this spec: a centered message ("Scan your
  games to see patterns in your play") with a placeholder for the
  "Scan my games" entry point the insights spec will wire up. This spec
  only needs the tab to exist and render *something* — the report
  contents are the insights spec's responsibility.

### Visual system

All changes live in `src/renderer/src/app.css` (and component-level
class additions where needed), no new styling library:

- **Color**: accent shifts from the current blue (`#4b9fff`) to a
  chess.com-style green (`#7fa650`-family) for buttons, active nav/tab
  state, and positive indicators. Panel background gets a second,
  slightly lighter tone than the page background to read as "elevated"
  rather than flat-bordered.
- **Elevation**: panels (`import-modal`, `move-list`, `eval-graph`,
  `game-summary`, the new top bar) get a subtle `box-shadow` in addition
  to their existing border, giving real depth instead of a flat outline.
- **Corners**: standardize on 12px radius across panels/buttons/inputs
  (currently an inconsistent mix of 4–8px).
- **Typography**: keep the system-font stack (no web-font loading in an
  Electron app), but introduce an actual type scale — larger, bolder
  headings (app title, accuracy numbers), a distinct secondary/muted text
  size for metadata (move numbers, timestamps) — versus today's near-uniform
  1rem everywhere.
- **Classification badges**: `.move.brilliant`, `.move.blunder` etc.
  (`app.css:220-234`) keep their color coding but gain a small icon glyph
  (e.g. star for brilliant, check for best, double-question for blunder)
  alongside the text, matching chess.com's visual language for move
  quality.
- **Layout fluidity**: `.analysis-layout`'s fixed
  `40px minmax(300px, 480px) 320px` grid template becomes more fluid
  (relative sizing with sane min/max bounds) so the board/side-panel
  split adapts better across window sizes instead of being rigid.

## Error handling

No new error paths — this is a presentational change. Existing error
states (`import-error`, analysis cancelled/error) keep their current
triggers, just restyled to match the new visual system.

## Testing

- Existing Vitest component/unit tests are unaffected (no logic changes)
  and must keep passing.
- Verified visually via the `run-desktop` skill: screenshots of the
  Analyze tab (empty/import state, and mid-analysis/done state) and the
  Insights tab (empty state), checked against the design direction above.

## Future ideas (explicitly deferred)

- Light theme / theme toggle.
- Settings panel in the shell.
- Board themes / piece sets.

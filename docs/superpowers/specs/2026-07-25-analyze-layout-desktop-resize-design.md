# Analyze Layout Desktop-Resize Design Spec

Date: 2026-07-25

## Purpose

Sub-project 2 of the performance/polish initiative. Audit found zero
`@media` queries anywhere in the app, a `BrowserWindow` with no
`minWidth`/`minHeight` at all, and `.analysis-layout`'s 3-column grid
paired with an eval bar whose height is hardcoded to `480px` in CSS,
completely independent of the board's actual size — they only agree
today because both happen to equal 480 at the default 1280px window
width.

Scope, already agreed with the user: desktop window resizing/tiling
only. No phone-sized breakpoints, no touch input — this is a Linux-only
desktop app with no mobile distribution story.

## Non-goals

- No new breakpoint-driven redesign of `.analysis-layout`'s column
  structure. CSS Grid's existing `grid-template-columns: minmax(32px,
  44px) minmax(280px, 1fr) minmax(280px, 380px)` already distributes
  space elastically on its own — verified analytically (not empirically
  re-derived; this is standard, well-documented `minmax()` behavior) —
  down to its own stated floor (~692px content width). The real gaps
  are the missing window-size floor and the eval-bar/board coupling,
  not the grid's column logic itself.
- The Insights tab's `.insights-buckets` grid already uses
  `repeat(auto-fit, minmax(320px, 1fr))`, which is inherently responsive
  without a media query — left untouched.
- `NavBar` is a simple `justify-content: space-between` flex row with no
  fixed-width children — not touched; nothing indicated it as a real
  problem.

## Architecture

1. **`src/main/index.ts`**: add `minWidth: 760, minHeight: 700` to the
   `BrowserWindow` constructor. Values derived from the grid's own
   stated minimums (44 + 280 + 280 + gaps + `.app-content` padding ≈
   740px) plus margin, and from the board-column's vertical chrome (nav
   bar + padding + board-nav buttons + MoveDetail) at the board's
   default max size.
2. **`.board-container`'s `max-width`** becomes `min(480px, calc(100vh -
   260px))` instead of a flat `480px` — caps the (square) board by
   available *height* too, not just width, so a short-but-wide window
   can't push it past the bottom edge.
3. **Eval bar height** stops being a hardcoded constant and starts
   tracking the board's real rendered size: a `ResizeObserver` in
   `Board.tsx` (on its own `.board-container` div, already the right
   place since react-chessboard doesn't expose its own resize hook)
   reports measured height up via a new optional `onHeightChange` prop.
   `App.tsx` holds it in state (`boardHeight`, set via a
   `useCallback`-stabilized handler so `Board`'s `React.memo` boundary
   from sub-project 1 isn't defeated by a fresh function reference every
   render) and passes it to `EvalBar` as a new optional `height` prop,
   applied via inline `style` (CSS's `480px` stays as the pre-measurement
   fallback for first paint, not a competing source of truth).

## Testing

No new automated tests (rendering-layer/native-window behavior, same
category as sub-project 1 — this codebase's test suite is logic-only).
Verified two different ways, chosen for what's actually reliable in
this environment:

- **`minWidth`/`minHeight`**: Electron's native enforcement of these
  `BrowserWindow` options is well-established, standard behavior — not
  independently re-verified beyond confirming the built output actually
  contains the configured values (`grep` on `out/main/index.js`).
- **Eval-bar/board height coupling**: driving the actual app via
  `run-desktop` and measuring `.board-container`/`.eval-bar`'s real
  `getBoundingClientRect().height` before and after injecting a
  temporary stylesheet that forces `.board-container` to `280px`. Both
  measured `480` initially and both measured `280` after the injected
  override — confirmed dynamically tracking, not coincidentally equal.

Programmatically resizing the actual native `BrowserWindow` (via both
Playwright's `page.setViewportSize()` and via `app.evaluate()` calling
`BrowserWindow.setSize()` in the main process) was attempted first and
abandoned — both approaches crashed the renderer in this specific
Wayland/X11 environment, consistent with the other native-window quirks
already documented in the `run-desktop` skill. The CSS-injection
approach above tests the same underlying layout logic (how the app
responds to the board having less available space) without depending on
a native window-resize operation that isn't reliable here.

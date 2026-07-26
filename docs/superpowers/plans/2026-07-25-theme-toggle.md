# Theme Toggle Implementation Plan

> Executed directly in-session (not via subagent-driven-development),
> matching sub-projects 1 and 2 of the same performance/polish
> initiative. Design already presented and approved in-conversation;
> written up here for the record per this repo's practice.

**Goal:** Add a dark theme (default) alongside the existing Study Room
light theme, with a toggle in `NavBar`, persisted across launches.

## What was done

**Palette** (`src/renderer/src/app.css`): a `:root[data-theme='dark']`
override block. Neutral scale and the 9 `--mq-*` move-classification
colors are adapted from this project's own prior "Walnut & Ivory" dark
theme (`docs/superpowers/specs/2026-07-17-ui-polish-and-move-classification-design.md`)
— real prior art, already proven to read well on this exact near-black
background, not invented from scratch. One deliberate deviation from
that old theme: `--accent` uses a brightened green (`#4f9d68`) instead
of Walnut & Ivory's brass, so the accent color that's now the Study Room
brand's signature color (the website, the wishlist email, the product
name) stays the same hue in both light and dark rather than switching
per theme. Shape (`--radius-panel`/`--radius-control`), fonts, and
`--eval-white`/`--eval-black` (the chessboard's own two sides, unrelated
to the surrounding UI theme) are intentionally *not* overridden — they
stay identical in both themes, inherited from the base `:root` block.

**Persistence**: extended the existing `settingsStore`/`AppSettings`
pattern (already used for the linked chess.com account) rather than
inventing a new mechanism.
- `src/shared/types.ts`: new `Theme = 'light' | 'dark'` type,
  `AppSettings.theme: Theme` (now required, not optional), new
  `ChessAPI.setTheme(theme)` method.
- `src/shared/ipc.ts`: new `setTheme: 'settings:set-theme'` channel.
- `src/main/settings/settingsStore.ts`: `DEFAULT_SETTINGS.theme = 'dark'`,
  a `parseTheme()` validator (anything other than the literal string
  `'light'` becomes `'dark'` — handles missing field, wrong type, and
  garbage values uniformly). Fixed a real bug found while wiring this
  up: the original fallthrough return path (`parsed.linkedAccount` and
  `parsed.chessComUsername` both absent) returned a hardcoded
  `{ ...DEFAULT_SETTINGS }` rather than the actually-parsed `theme` —
  meaning a settings file containing *only* a saved theme (no linked
  account ever set) would have silently lost that theme preference on
  every load. Fixed to return the parsed `theme` on that path too, and
  added a regression test for exactly this case.
- `src/main/ipc/handlers.ts` / `src/preload/index.ts`: new
  `setTheme` handler/bridge method, matching the existing narrow,
  single-purpose channel style already used for `openChessComProfileSettings`
  etc. (not a generic "save any settings patch" channel).

**Renderer wiring**:
- `src/renderer/src/hooks/useTheme.ts` (new): loads the persisted theme
  via `getSettings()` on mount (defaulting to `'dark'` before that
  resolves, matching the settings-store default so there's no
  dark→light flash in the common case), applies it via
  `document.documentElement.setAttribute('data-theme', theme)`, and a
  `toggleTheme()` that flips the value, applies it, and persists it via
  `setTheme()`.
- `src/renderer/src/App.tsx`: calls `useTheme()`, passes `theme`/
  `toggleTheme` down to `NavBar`.
- `src/renderer/src/components/NavBar.tsx`: new sun/moon icon-only
  button (`lucide-react`'s `Sun`/`Moon`, already a dependency — no new
  package) inside a new `.nav-bar-actions` wrapper alongside the
  existing account chip. Icon shows the destination, not the current
  state (dark mode shows a sun, meaning "click for light," and vice
  versa) — the common convention for this control.

## Testing

`src/main/settings/settingsStore.test.ts`: extended every existing
assertion for the now-required `theme` field, plus four new cases:
round-tripping a saved theme, defaulting to dark when a saved file
predates the theme field entirely, preserving a saved theme when the
file has no `linkedAccount`/`chessComUsername` field at all (the
regression test for the bug described above), and rejecting an invalid
theme value.

No new renderer-level automated tests (same reasoning as sub-projects 1
and 2 — this codebase's test suite is logic-only). Verified visually via
`run-desktop`:
- Fresh launch defaults to dark (`document.documentElement.getAttribute('data-theme')`
  read as `"dark"` before any interaction).
- Clicking `.theme-toggle` flips the `data-theme` attribute both
  directions and the rendered colors actually change accordingly
  (screenshotted both states).
- The full Analyze view (board, eval bar, move list, eval graph,
  accuracy scorecards, move-quality bar chart, classification legend) in
  dark mode: all `--mq-*` colors render correctly and legibly, nothing
  left over from the light palette.
- Persistence confirmed by reading `~/.config/chess-analyzer/settings.json`
  directly after toggling and seeing the saved value match the last
  toggle action, then confirming a fresh launch picks up that persisted
  value rather than the in-memory default.

`npm run verify`: 217/217 tests pass (213 existing + 4 new theme tests
in `settingsStore.test.ts`).

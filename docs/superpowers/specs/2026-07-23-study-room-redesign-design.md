# Study Room Redesign — Design Spec

Date: 2026-07-23

## Purpose

The current "Walnut & Ivory" identity (`docs/superpowers/specs/2026-07-17-ui-polish-and-move-classification-design.md`)
gave the app a coherent dark theme, but the user now wants a different look
entirely: different colors, a different button/control language, and an
overall more "finished, publish-ready" feel. This spec replaces the visual
identity end-to-end with **"Study Room"** — a warm-paper light theme built
around the deep green of an actual chessboard, evaluated and approved
against a live mockup (published artifact, "Chess Analyzer — Redesign
Directions," Direction B of three) built from the app's real screens and
real data (nav bar, the verified Chess.com profile tab, recent games).

This is a rendering-layer change only. No analysis logic, IPC surface, or
data model changes. Continues directly from the Chess.com auto-load fix
(`ImportModal.tsx`/`useChessComProfile.ts`, same session) — that work
already gave the Chess.com tab its final *structure* (profile header +
rating badges + game list); this spec only changes how that structure is
*painted*.

## Scope decision: replace, not toggle

The prior spec explicitly deferred "light theme / theme toggle" as future
work. This spec resolves that, but as a **replacement** of the single dark
theme with a single light theme — not a toggle. The app has never had a
theme switch, has no settings UI to put one in, and the user asked for an
overhaul of the current look, not an additional mode. `color-scheme` in
`:root` changes from `dark` to `light`.

## Visual identity — "Study Room"

Replaces the token block in `app.css:1-32`.

```css
:root {
  color-scheme: light;
  --bg: #f3f0e6;              /* warm paper */
  --panel: #fffdf8;
  --panel-elevated: #eae4d2;
  --border: #ddd4bc;
  --border-strong: #c7bc9d;
  --text: #231f17;
  --text-muted: #6d6353;
  --text-faint: #948a74;
  --accent: #33553a;           /* felt-board green — primary interactive color */
  --accent-hover: #3f6647;
  --accent-contrast: #f6f3ea;  /* text placed on accent-filled surfaces */
  --radius-panel: 4px;
  --radius-control: 3px;
  --shadow-modal: 0 8px 24px rgba(35, 31, 23, 0.16);

  /* NEW: the eval bar represents chess "white"/"black", not the theme's
     text/background — it must stay legible regardless of theme. See
     "EvalBar" below for why this is a real bug fix, not just a rename. */
  --eval-white: #faf8f2;
  --eval-black: #1c1712;

  --mq-brilliant: #0f8fa3;
  --mq-great: #0f8f7c;
  --mq-best: #2f7a4c;
  --mq-excellent: #4f8f5f;
  --mq-good: #767a5a;
  --mq-book: #8a8272;
  --mq-inaccuracy: #a8720e;
  --mq-mistake: #b5591f;
  --mq-blunder: #b3392f;

  --font-ui: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Lora', Georgia, serif;
  --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
}
```

Same semantic hues as the dark ramp (cyan→teal→green→…→red), values
individually darkened/deepened to hold contrast against `--panel`
(`#fffdf8`) and `--panel-elevated` (`#eae4d2`) instead of near-black
surfaces — exact values verified visually during implementation via the
`run-desktop` screenshots called for below, not treated as final-final.

**Typography**: swap `@fontsource/fraunces` for `@fontsource/lora`
(new dependency; `manrope` and `ibm-plex-mono` are unchanged and already
self-hosted — `package.json`, `main.tsx:1-8`). Lora is the display face
(wordmark, section headers) in place of Fraunces — a quieter book/study
serif instead of Fraunces' more decorative display character, matching
the "printed page" concept. Manrope stays the body face; Plex Mono stays
reserved for evals/ratings/accuracy/the verification code.

**Shape**: radius shrinks from the current 10px/7px pair to 4px/3px —
Study Room reads as printed cards and page tabs, not soft dark-mode
chrome. `--shadow-modal` gets warmer (paper-toned rgba, not pure black)
and stays reserved for genuinely elevated surfaces (modals, sticky nav) —
not applied uniformly.

## Component-by-component

- **`app.css` root/base rules** (`button`, `input`/`textarea`, `.app`,
  `.nav-bar`): recolor to new tokens; no structural change.

- **`.segmented-control` / `.segmented-control-option`** (`app.css:610-633`,
  shared by `NavBar`'s Analyze/Insights tabs and `ImportModal`'s
  Paste/Upload/Chess.com tabs — keep that sharing): becomes a **book-tab**
  treatment instead of a filled pill. Tabs sit flush against the panel
  below them; the active tab gets `background: var(--panel)`,
  `border: 1px solid var(--border)`, and `box-shadow: inset 0 2px 0
  var(--accent)` (a top accent rule, like a bookmark), inactive tabs stay
  transparent. Container background/border/padding that currently makes
  it look like a pill (`app.css:613-616`) is dropped.

- **Buttons** (`.button-primary`/`.button-secondary`, `app.css:71-85`):
  primary keeps solid `--accent` fill + `--accent-contrast` text, but adds
  `box-shadow: inset 0 -2px 0 rgba(35, 31, 23, 0.18)` — a pressed-felt
  look distinct from the flat brass button it replaces. Radius follows the
  new `--radius-control` (3px). Secondary stays transparent + border, no
  other change.

- **`NavBar.tsx`**: wordmark switches font only (Lora). The verified
  account chip's icon changes from `lucide-react`'s `CircleCheck` to
  `BadgeCheck` — visually closer to a wax seal/stamp than a plain
  checkmark, while staying a real icon (not a raw Unicode glyph, which
  renders inconsistently across platforms/fonts — this was flagged as an
  "AI-generated tell" concern in the prior spec and applies here too).
  `.account-chip.verified` border/text color moves from `--mq-best` to
  `--accent` so the verified state reads as "branded," not "correct move."
  The rating badge added in the Chess.com auto-load fix
  (`.account-chip-rating`) keeps its structure, recolored to tokens.

- **`ImportModal.tsx` Chess.com panel** (built this session in
  `useChessComProfile.ts`/`ImportModal.tsx:87-165`): no structural
  changes — the profile-header + rating-badges + "Search another player"
  layout stays. `.chesscom-profile`, `.chesscom-rating-badge`,
  `.chesscom-game-card`, `.chesscom-game-result.*` (`app.css`, added this
  session) recolor to the new tokens; `.chesscom-verified-icon` swaps
  `CircleCheck` for `BadgeCheck` to match the NavBar chip.

- **`EvalBar.tsx`/`app.css:200-248`**: real bug fix, not just a repaint.
  `.eval-bar-white` currently reads `background: var(--text)` and
  `.eval-bar-black` reads `var(--eval-black)` — this only worked because
  the old dark theme's `--text` happened to be light (ivory). In Study
  Room, `--text` is dark, which would silently turn the bar's "white"
  half black. Fix: both halves reference the new dedicated
  `--eval-white`/`--eval-black` tokens instead of `--text`, decoupling
  "which side of the board" from "the current theme's text color."

- **`Board.tsx:19`**: the best-move arrow's hardcoded `'rgb(21, 128, 61)'`
  switches to `'var(--accent)'` for token consistency (react-chessboard
  accepts any CSS color string for `Arrow.color`). Board square/piece
  styling itself is unchanged — out of scope, same as the prior spec's
  deferral of board themes.

- **`GameSummary.tsx` / `MoveList.tsx` / `moveClassificationStyle.ts`**:
  no code changes — classification colors/icons are already 100%
  `var(--mq-*)`-driven (confirmed via grep; no hardcoded hex remain
  outside `app.css`), so the new ramp above is the entire fix.

- **`EvalGraph.tsx` / `TimeControlSection.tsx`**: same — already reference
  `var(--accent)`/`var(--text)`/`var(--text-muted)` for chart strokes/
  fills, so recharts picks up the new palette automatically. No code
  change.

- **`ConnectAccountModal.tsx`**: recolor only (modal panel, verification
  code block, button hierarchy) — no structural change.

- **`InsightsTab.tsx` / `TopFindingsList.tsx`**: recolor only; section
  headers follow the NavBar's font swap to Lora.

## Error handling

None — presentational change only. Existing error states restyle to the
new `--mq-blunder`-tinted background per current `.import-error` pattern
(`app.css:156-162`), no new triggers.

## Testing

- Existing Vitest suite is unaffected (no prop/logic changes) and must
  keep passing (`npm run verify`).
- Verified visually via the `run-desktop` skill: NavBar with a verified
  account (rating chip + seal icon), the Chess.com tab auto-loaded profile
  view, EvalBar mid-analysis (confirming the white/black fix actually
  holds — this is the one change with real regression risk), GameSummary
  with the classification legend, and the Insights tab.

## Future ideas (explicitly deferred)

- A theme toggle (this spec replaces the only theme; it does not add a
  second one).
- Board/piece theming, to match Study Room's board-adjacent motifs.
- Any copy/wording changes — out of scope, this is colors/type/shape only.

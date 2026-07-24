# Study Room Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's "Walnut & Ivory" dark theme with the approved "Study Room" light theme (paper background, felt-board green accent, book-tab controls, Lora display font) across every screen.

**Architecture:** This is a rendering-layer-only change. All classification/eval colors already flow through CSS custom properties (`var(--mq-*)`, `var(--accent)`, `var(--text)`, etc.) defined once in `app.css:1-32` — confirmed via `grep -rn "#[0-9a-fA-F]\{3,6\}" src/renderer/src --include="*.tsx"` returning zero hardcoded hex outside `app.css`. So most of this plan is one token-block rewrite plus a handful of targeted structural tweaks (book-tab control shape, two icon swaps, one hardcoded `rgb()` in `Board.tsx`, and a real bug fix in the eval bar that the token swap would otherwise expose).

**Tech Stack:** React 19 + TypeScript, Electron (electron-vite), `@fontsource/*` self-hosted webfonts, `lucide-react` icons, plain CSS custom properties (no CSS-in-JS, no Tailwind).

## Global Constraints

- Design spec of record: `docs/superpowers/specs/2026-07-23-study-room-redesign-design.md` — every task below implements a specific section of it.
- Presentational change only — no changes to analysis logic, IPC surface, or any `.ts`/`.tsx` file under `src/main/` or `src/shared/`.
- `color-scheme` goes from `dark` to `light`; this **replaces** the only theme, it does not add a toggle (no settings UI exists for one, none is being added).
- One new dependency: `@fontsource/lora@^5.3.0` (confirmed on npm with 400/500/600/700 weights), replacing `@fontsource/fraunces`.
- The existing Vitest suite (`npm test`, 193 tests as of this session) and `tsc -b` (`npm run typecheck`) must keep passing after every task — run `npm run verify` before each commit.
- Follow this repo's git workflow: commit directly to `main`, no branches/PRs.

---

### Task 1: Swap the display webfont from Fraunces to Lora

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/renderer/src/main.tsx:1-8`

**Interfaces:**
- Produces: `--font-display` in `app.css` will reference `'Lora'` (set in Task 2) — this task only makes the font files available and loaded.

- [ ] **Step 1: Install the new font package and remove the old one**

Run: `npm install @fontsource/lora@^5.3.0 && npm uninstall @fontsource/fraunces`

Expected: `package.json` dependencies now list `@fontsource/lora` and no longer list `@fontsource/fraunces`.

- [ ] **Step 2: Update the font imports**

In `src/renderer/src/main.tsx`, replace:

```ts
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
```

with:

```ts
import '@fontsource/lora/500.css'
import '@fontsource/lora/600.css'
```

(The `@fontsource/manrope/*` and `@fontsource/ibm-plex-mono/*` imports above/below this block are unchanged.)

- [ ] **Step 3: Verify it builds**

Run: `npm run typecheck`
Expected: no errors (this task touches no `.ts`/`.tsx` logic, only an import path — a typo here would show up as a Vite/build failure, not a `tsc` error, so also run `npm run build` and confirm it ends with `✓ built in`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx
git commit -m "Swap Fraunces for Lora as the display webfont"
```

---

### Task 2: Rewrite the root token block — the core of the redesign

**Files:**
- Modify: `src/renderer/src/app.css:1-32`

**Interfaces:**
- Produces: every token referenced by name in Tasks 3–7 below (`--bg`, `--panel`, `--panel-elevated`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`, `--accent-contrast`, `--radius-panel`, `--radius-control`, `--shadow-modal`, `--eval-white`, `--eval-black`, `--mq-*` ×9, `--font-ui`, `--font-display`, `--font-mono`).

- [ ] **Step 1: Replace the `:root` block**

Replace `app.css:1-32` (the entire existing `:root { ... }` block) with:

```css
:root {
  color-scheme: light;
  --bg: #f3f0e6;
  --panel: #fffdf8;
  --panel-elevated: #eae4d2;
  --border: #ddd4bc;
  --border-strong: #c7bc9d;
  --text: #231f17;
  --text-muted: #6d6353;
  --text-faint: #948a74;
  --accent: #33553a;
  --accent-hover: #3f6647;
  --accent-contrast: #f6f3ea;
  --radius-panel: 4px;
  --radius-control: 3px;
  --shadow-modal: 0 8px 24px rgba(35, 31, 23, 0.16);
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

This removes the old `--eval-black: #15110d;` single token (the black side of the eval bar previously borrowed `var(--text)` for its white side — that coupling is fixed in Task 5) and adds `--eval-white` alongside a renamed-in-place `--eval-black`.

- [ ] **Step 2: Verify it builds**

Run: `npm run typecheck && npm run build`
Expected: both succeed. (This step alone will make most of the app render with light colors but a few things will look broken — the eval bar's white side, the segmented control's now-invisible pill background, verified-chip green vs. the old bright green — that's expected and fixed by the remaining tasks.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Replace Walnut & Ivory tokens with the Study Room light palette"
```

---

### Task 3: Book-tab segmented control

**Files:**
- Modify: `src/renderer/src/app.css:610-633` (the `.segmented-control` / `.segmented-control-option` rules — line numbers shifted by Task 2's edit; locate by selector, not line number)

**Interfaces:**
- Consumes: `--radius-control`, `--panel`, `--border`, `--text`, `--text-muted`, `--accent` from Task 2.
- No prop/markup changes — `NavBar.tsx` and `ImportModal.tsx` already render `.segmented-control` / `.segmented-control-option` / `.active`, unchanged by this task.

- [ ] **Step 1: Replace the three rules**

Find (by selector — Task 2 shifts exact line numbers):

```css
.segmented-control {
  display: flex;
  gap: 0.2rem;
  background: var(--panel-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  padding: 0.2rem;
}

.segmented-control-option {
  background: transparent;
  border: 1px solid transparent;
  border-radius: calc(var(--radius-control) - 2px);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.segmented-control-option.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}
```

Replace with:

```css
.segmented-control {
  display: flex;
  gap: 0.15rem;
  border-bottom: 1px solid var(--border);
}

.segmented-control-option {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-control) var(--radius-control) 0 0;
  padding: 0.45rem 0.9rem;
  margin-bottom: -1px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
  font-weight: 600;
}

.segmented-control-option.active {
  background: var(--panel);
  border-color: var(--border);
  border-bottom-color: var(--panel);
  color: var(--text);
  box-shadow: inset 0 2px 0 var(--accent);
}
```

The `margin-bottom: -1px` + `border-bottom-color: var(--panel)` pair makes the active tab's bottom edge visually "erase" the container's `border-bottom` beneath it — this only reads correctly because both places this class is used (`NavBar`'s `<nav>` and `ImportModal`'s `<div>`) sit directly on a `--panel`-colored surface (`.nav-bar` and `.import-modal` both set `background: var(--panel)`). If either of those two rules' background ever changes, this rule's `border-bottom-color: var(--panel)` must move with it.

- [ ] **Step 2: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Restyle segmented control tabs as book tabs"
```

---

### Task 4: Primary button gets a pressed-felt shadow

**Files:**
- Modify: `src/renderer/src/app.css` (the `.button-primary` rule)

**Interfaces:**
- Consumes: `--accent` from Task 2. Radius already flows from the shared `button { border-radius: var(--radius-control); }` base rule (`app.css:45-55`, unmodified) — Task 2's 3px value applies automatically, no separate edit needed here.

- [ ] **Step 1: Add the shadow**

Find:

```css
.button-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}
```

Replace with:

```css
.button-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
  box-shadow: inset 0 -2px 0 rgba(35, 31, 23, 0.18);
}
```

(`.button-primary:hover:not(:disabled)` and `.button-secondary` immediately below are unchanged.)

- [ ] **Step 2: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Give primary buttons a pressed-felt shadow"
```

---

### Task 5: Fix the eval bar's white/black coupling to `--text`

**Files:**
- Modify: `src/renderer/src/app.css` (the `.eval-bar-white` rule)

**Interfaces:**
- Consumes: `--eval-white` (new token from Task 2). `.eval-bar-black` already correctly references `--eval-black` and needs no change.

This is the one change in this plan with real regression risk, per the design spec: `.eval-bar-white` currently reads `background: var(--text)`, which only produced a light color because the old dark theme's `--text` happened to be light (ivory). After Task 2, `--text` is dark (`#231f17`), which would silently turn the "White" side of the evaluation bar black — visually indistinguishable from the "Black" side, breaking the bar's entire purpose. `--eval-white`/`--eval-black` decouple "which side of the chess board" from "the current theme's text color."

- [ ] **Step 1: Fix the rule**

Find:

```css
.eval-bar-white {
  background: var(--text);
}
```

Replace with:

```css
.eval-bar-white {
  background: var(--eval-white);
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run typecheck`
Expected: no errors. (Visual confirmation that the two halves are actually distinguishable happens in Task 8 — a `tsc`/build pass can't catch a "both halves render as the same color" bug since both are valid CSS.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/app.css
git commit -m "Decouple eval bar white/black from --text so it survives the light theme"
```

---

### Task 6: Verified-account icon becomes a seal, not a checkmark

**Files:**
- Modify: `src/renderer/src/components/NavBar.tsx`
- Modify: `src/renderer/src/components/ImportModal.tsx`
- Modify: `src/renderer/src/app.css` (`.account-chip.verified`, `.chesscom-verified-icon`)

**Interfaces:**
- Consumes: `--accent` from Task 2 (replaces `--mq-best` as the verified-state color in both places — verified is a "branded" state, not a move-quality judgment, so it should no longer borrow the move-classification ramp).

- [ ] **Step 1: Swap the icon import and usage in `NavBar.tsx`**

In `src/renderer/src/components/NavBar.tsx`, change the import:

```ts
import { Loader2, CircleCheck } from 'lucide-react'
```

to:

```ts
import { Loader2, BadgeCheck } from 'lucide-react'
```

and change the usage:

```tsx
{linkedAccount?.verifiedAt && <CircleCheck size={14} className="account-chip-icon" />}
```

to:

```tsx
{linkedAccount?.verifiedAt && <BadgeCheck size={14} className="account-chip-icon" />}
```

- [ ] **Step 2: Swap the icon import and usage in `ImportModal.tsx`**

Change the import:

```ts
import { CircleCheck } from 'lucide-react'
```

to:

```ts
import { BadgeCheck } from 'lucide-react'
```

and change the usage:

```tsx
<CircleCheck size={16} className="chesscom-verified-icon" />
```

to:

```tsx
<BadgeCheck size={16} className="chesscom-verified-icon" />
```

- [ ] **Step 3: Recolor both in `app.css`**

Find:

```css
.account-chip.verified {
  border-color: var(--mq-best);
  color: var(--mq-best);
}
```

Replace with:

```css
.account-chip.verified {
  border-color: var(--accent);
  color: var(--accent);
}
```

Find:

```css
.chesscom-verified-icon {
  color: var(--mq-best);
  flex-shrink: 0;
}
```

Replace with:

```css
.chesscom-verified-icon {
  color: var(--accent);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run typecheck`
Expected: no errors (an unused `CircleCheck` import or a typo'd `BadgeCheck` would fail here since `lucide-react` ships types for its exports).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NavBar.tsx src/renderer/src/components/ImportModal.tsx src/renderer/src/app.css
git commit -m "Give verified accounts a seal icon in the app accent color"
```

---

### Task 7: Board arrow color follows the token, not a hardcoded RGB

**Files:**
- Modify: `src/renderer/src/components/Board.tsx:19`

**Interfaces:**
- Consumes: `--accent` from Task 2. `react-chessboard`'s `Arrow.color` field accepts any CSS color string, including `var(...)`.

- [ ] **Step 1: Replace the hardcoded color**

In `src/renderer/src/components/Board.tsx`, find:

```ts
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'rgb(21, 128, 61)'
        }
      ]
    : []
```

Replace with:

```ts
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'var(--accent)'
        }
      ]
    : []
```

Board square/piece colors themselves are unmodified (react-chessboard's own defaults) — out of scope per the design spec.

- [ ] **Step 2: Verify it builds**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Board.tsx
git commit -m "Route the best-move arrow color through --accent"
```

---

### Task 8: Full visual verification pass

**Files:** none (verification only)

**Interfaces:** none — this task consumes the completed app from Tasks 1–7 and checks it against the design spec's "Testing" section.

- [ ] **Step 1: Run the full check**

Run: `npm run verify`
Expected: `tsc -b` succeeds, all Vitest tests pass (193+ tests, same count as session start — no test was skipped or deleted).

- [ ] **Step 2: Build for the driver**

Run: `npm run build`
Expected: ends with `✓ built in`.

- [ ] **Step 3: Screenshot every major screen**

Use the `run-desktop` skill. Write a commands file (e.g. to the scratchpad directory) with:

```
launch
ss navbar-and-idle
click-text Chess.com
sleep 1500
ss chesscom-tab
click-text Paste PGN
fill textarea 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3 Nb8 10.d4 Nbd7 1-0
click-text Load Game
wait .game-summary 90000
ss analysis-done
click-text Insights
sleep 500
ss insights-tab
```

Run: `node .claude/skills/run-desktop/driver.mjs <path-to-commands-file>`

- [ ] **Step 4: Check each screenshot against the spec**

- `navbar-and-idle`: paper background, Lora wordmark, book-tab Analyze/Insights tabs with a green top-accent on the active tab, verified chip shows the seal (`BadgeCheck`) icon and rating in `--accent` green (not the old bright move-quality green).
- `chesscom-tab`: same book-tab treatment on Paste PGN/Upload File/Chess.com, profile header and rating badges legible on the paper/panel colors, "Search another player" button readable.
- `analysis-done`: **the eval bar's white and black halves must be visibly distinct** (this is the Task 5 regression check) — if both halves look the same color, Task 5's fix didn't take effect; re-check the built CSS, not just the source file (stale `out/` build is the most likely cause). Move list icons and the classification legend in `GameSummary` should be legible against the new light panel background.
- `insights-tab`: finding cards and any charts (bar/line via `recharts`) should be using the new `--accent`/`--mq-*` colors, not default recharts colors.

If anything is illegible (contrast) or a token clearly didn't apply, fix it in the relevant task's file and re-run `npm run build` + re-screenshot before moving on — do not proceed to declaring the redesign done with a known visual defect.

- [ ] **Step 5: Final commit (only if Step 4 required fixes)**

```bash
git add -A
git commit -m "Fix contrast/token issues found in Study Room visual verification"
```

(If Step 4 found nothing to fix, there is no commit for this task — Tasks 1–7 already committed everything.)

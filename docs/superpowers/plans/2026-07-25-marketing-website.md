# Marketing/Wishlist Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-page static marketing site (`website/`) that pitches Chess Analyzer and collects wishlist emails via Netlify Forms, ready to connect to Netlify.

**Architecture:** Plain static HTML/CSS, no framework, no build step, no npm dependency for the site — deployed as raw files. Real screenshots are captured from the actual running Electron app via the `run-desktop` skill's driver rather than mocked up.

**Tech Stack:** HTML5, CSS3 (custom properties, no preprocessor), Netlify Forms (zero JS backend), Google Fonts CDN for Lora/Manrope.

## Global Constraints

- Plain static HTML/CSS/vanilla JS only — no framework, no build step, no npm dependency added for `website/`.
- No real "Download" button anywhere on the site — wishlist email capture is the only CTA (per spec's non-goals: the only existing build is Linux/pacman-only and not a general-audience download).
- Single page only, plus `success.html` as the form's redirect target — no additional pages.
- Netlify Forms is the only backend (`data-netlify="true"` + `netlify-honeypot="bot-field"`); no third-party form service, no custom domain, no analytics.
- Visual identity must reuse the app's exact "Study Room" tokens verbatim (from `src/renderer/src/app.css:38-74`):
  ```css
  --bg: #f3f0e6; --panel: #fffdf8; --panel-elevated: #eae4d2;
  --border: #ddd4bc; --border-strong: #c7bc9d;
  --text: #231f17; --text-muted: #6d6353; --text-faint: #948a74;
  --accent: #33553a; --accent-hover: #3f6647; --accent-contrast: #f6f3ea;
  --radius-panel: 4px; --radius-control: 3px;
  --shadow-modal: 0 8px 24px rgba(35, 31, 23, 0.16);
  --font-ui: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Lora', Georgia, serif;
  ```
- `netlify.toml` lives at the **repo root** (not inside `website/`) with `base = "website"`, `publish = "website"`, `command = ""`.
- This repo's git workflow: commit straight to `main`, no branches/worktrees/PRs.
- No automated test suite for the site (static content — YAGNI); verification is build success + structural checks + manual browser QA.

---

### Task 1: Assets — real app screenshots, icon files, netlify.toml

**Files:**
- Create: `website/images/hero.png`
- Create: `website/images/feature-classify.png`
- Create: `website/images/feature-import.png`
- Create: `website/images/feature-insights.png`
- Create: `website/images/icon.png` (copy of `build/icon.png`)
- Create: `website/images/icon.svg` (copy of `build/icon.svg`)
- Create: `netlify.toml` (repo root)

**Interfaces:**
- Consumes: the built app (`out/`, via `npm run build`), the driver at `.claude/skills/run-desktop/driver.mjs` (commands: `launch`, `fill`, `click-text`, `wait`, `eval`, `sleep`, `ss` — see `.claude/skills/run-desktop/SKILL.md`), and this dev machine's **already-linked chess.com account**: `~/.config/chess-analyzer/settings.json` has `linkedAccount.username: "zlakin"` with `verifiedAt` set, and `~/.config/chess-analyzer/scan-meta.json` already holds a populated insights scan cache. No new account linking or live scan is needed or should be triggered.
- Produces: `website/images/*.png` (1280×800 PNGs) and `website/images/icon.{png,svg}`, consumed by Task 2's `<img>`/favicon references. `netlify.toml` is consumed by Netlify at deploy time (no code dependency on it from other tasks).

- [ ] **Step 1: Build the app**

```bash
cd /home/zacharyl/chess
npm run build
```

Expected: exits 0, writes/updates `out/main`, `out/preload`, `out/renderer`. The driver launches this build, not `npm run dev` — screenshots must reflect current `main`, not whatever was last built.

- [ ] **Step 2: Capture the Analyze-tab screenshots (hero + classification legend)**

```bash
mkdir -p website/images
cat > /tmp/shots-analyze.txt <<'EOF'
launch
fill textarea 1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0
click-text Load Game
wait .game-summary 150000
sleep 800
ss hero
eval document.querySelector('.classification-legend').scrollIntoView({block: 'center'})
sleep 300
ss feature-classify
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/shots-analyze.txt
```

Expected: no `FATAL` lines in the driver's output; `/tmp/shots/hero.png` and `/tmp/shots/feature-classify.png` exist afterward (the PGN is the historic "Immortal Game," Anderssen–Kieseritzky 1851 — 23 moves/45 plies, ends in checkmate, chosen for a visually rich, dramatic eval swing).

- [ ] **Step 3: Capture the Chess.com import screenshot**

```bash
cat > /tmp/shots-import.txt <<'EOF'
launch
click-text Chess.com
wait .chesscom-game-card 30000
sleep 300
ss feature-import
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/shots-import.txt
```

Expected: `/tmp/shots/feature-import.png` exists, showing the auto-loaded "zlakin" profile (verified badge, rating badges, game list) — this works with **no typed input** because a verified account is already linked on this machine. If `.chesscom-game-card` times out, check `~/.config/chess-analyzer/settings.json` still has `linkedAccount.verifiedAt` set before assuming an app regression.

- [ ] **Step 4: Capture the Insights screenshot**

```bash
cat > /tmp/shots-insights.txt <<'EOF'
launch
click-text Insights
wait .insights-report 20000
eval document.querySelector('.tactic-chip-row')?.scrollIntoView({block: 'center'})
sleep 300
ss feature-insights
EOF
node .claude/skills/run-desktop/driver.mjs /tmp/shots-insights.txt
```

Expected: `/tmp/shots/feature-insights.png` exists. This machine's insights cache is already populated, so `.insights-report` should render from cache within a few seconds — **do not** click "Scan my games"/"Rescan" as a workaround if this step fails; that triggers a live chess.com fetch + fresh Stockfish analysis of every game, which can run for many minutes. If it times out, stop and report it rather than letting a scan run inside this step.

- [ ] **Step 5: Copy screenshots and icon assets into the site**

```bash
cp /tmp/shots/hero.png /tmp/shots/feature-classify.png /tmp/shots/feature-import.png /tmp/shots/feature-insights.png website/images/
cp build/icon.png build/icon.svg website/images/
```

- [ ] **Step 6: Verify the screenshots are real captures, not blank/failed files**

```bash
file website/images/*.png
```

Expected: all four report `PNG image data, 1280 x 800` (the app's fixed `BrowserWindow` size per `src/main/index.ts`). If any file is missing, or reports a size/dimensions that look wrong, re-run the relevant capture step above before continuing — don't proceed to Task 2 with a placeholder or broken image.

- [ ] **Step 7: Write `netlify.toml` at the repo root**

```toml
[build]
  base = "website"
  publish = "website"
  command = ""
```

- [ ] **Step 8: Commit**

```bash
git add website/images netlify.toml
git commit -m "Add website assets: app screenshots, icons, Netlify config"
```

---

### Task 2: Page markup — index.html + success.html

**Files:**
- Create: `website/index.html`
- Create: `website/success.html`

**Interfaces:**
- Consumes: `website/images/{hero,feature-classify,feature-import,feature-insights,icon}.{png,svg}` from Task 1 (referenced by exact filename in `<img>`/`<link rel="icon">` tags below).
- Produces: the `wishlist` Netlify form (two instances, same `name="wishlist"`, same field `name="email"`) and CSS class names (`site-header`, `wordmark`, `hero`, `hero-grid`, `hero-copy`, `hero-media`, `hero-subhead`, `hero-note`, `wishlist-form`, `hp-field`, `visually-hidden`, `button-primary`, `features`, `feature-grid`, `feature-card`, `why-local`, `cta-repeat`, `success`, `site-footer`, `footer-sep`) that Task 3's `style.css` must style.

- [ ] **Step 1: Write `website/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Chess Analyzer — Free, Local Game Review</title>
<meta name="description" content="Chess Analyzer runs a real Stockfish engine locally to grade every move, score your accuracy, and surface the patterns costing you games. No subscription, no upload." />
<link rel="icon" type="image/png" href="images/icon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="css/style.css" />
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="wordmark" href="/">
      <img src="images/icon.png" alt="" class="wordmark-icon" width="28" height="28" />
      Chess Analyzer
    </a>
  </div>
</header>

<main>
  <section class="hero">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <h1>The Game Review chess.com wants you to pay for — free, and it never leaves your machine.</h1>
        <p class="hero-subhead">Chess Analyzer runs a real Stockfish engine locally to grade every move, score your accuracy, and surface the patterns costing you games. No subscription, no upload.</p>

        <form name="wishlist" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/success.html" class="wishlist-form">
          <input type="hidden" name="form-name" value="wishlist" />
          <p class="hp-field"><label>Don't fill this out: <input name="bot-field" /></label></p>
          <label class="visually-hidden" for="email">Email address</label>
          <input type="email" id="email" name="email" required placeholder="you@example.com" />
          <button type="submit" class="button-primary">Join the wishlist</button>
        </form>
        <p class="hero-note">In active development — a Linux build already exists today; Windows and Mac are next. I'll email you the moment there's a build for your platform.</p>
      </div>
      <div class="hero-media">
        <img src="images/hero.png" alt="Chess Analyzer showing a fully analyzed game: board, evaluation bar, move list, and evaluation graph" loading="eager" />
      </div>
    </div>
  </section>

  <section class="features">
    <div class="wrap">
      <h2>What it actually does</h2>
      <div class="feature-grid">
        <article class="feature-card">
          <img src="images/hero.png" alt="Move-by-move engine evaluation and per-game accuracy score" />
          <h3>Full engine analysis &amp; accuracy scoring</h3>
          <p>Every move graded against Stockfish, with a per-game accuracy score — the same idea chess.com's paid tier uses, running entirely on your machine.</p>
        </article>
        <article class="feature-card">
          <img src="images/feature-classify.png" alt="Move-quality classification legend: brilliant, best, good, inaccuracy, mistake, blunder" />
          <h3>Move-quality classification</h3>
          <p>Brilliant, best, good, inaccuracy, mistake, blunder — see exactly where a game turned, move by move.</p>
        </article>
        <article class="feature-card">
          <img src="images/feature-import.png" alt="Importing games directly from a chess.com profile" />
          <h3>Import from chess.com</h3>
          <p>Paste a PGN, upload a file, or search your chess.com username directly.</p>
        </article>
        <article class="feature-card">
          <img src="images/feature-insights.png" alt="Insights tab showing recurring tactical patterns and a recent-mistakes list" />
          <h3>Tactical insights</h3>
          <p>Recurring forks, pins, hung pieces — Insights tracks the patterns actually costing you rating, not just single-game noise.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="why-local">
    <div class="wrap">
      <h2>No subscription. No cloud. No games uploaded anywhere.</h2>
      <p>Chess Analyzer runs entirely on your machine using a local Stockfish engine — your games stay yours, and there's nothing to pay for, ever.</p>
    </div>
  </section>

  <section class="cta-repeat">
    <div class="wrap">
      <h2>Want in?</h2>
      <form name="wishlist" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="/success.html" class="wishlist-form">
        <input type="hidden" name="form-name" value="wishlist" />
        <p class="hp-field"><label>Don't fill this out: <input name="bot-field" /></label></p>
        <label class="visually-hidden" for="email-2">Email address</label>
        <input type="email" id="email-2" name="email" required placeholder="you@example.com" />
        <button type="submit" class="button-primary">Join the wishlist</button>
      </form>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <a href="https://github.com/zlakin/chess-analyzer">Source on GitHub</a>
    <span class="footer-sep">&middot;</span>
    <span>MIT licensed</span>
    <span class="footer-sep">&middot;</span>
    <a href="mailto:zacharylakin0@gmail.com">zacharylakin0@gmail.com</a>
  </div>
</footer>
</body>
</html>
```

- [ ] **Step 2: Write `website/success.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>You're on the list — Chess Analyzer</title>
<link rel="icon" type="image/png" href="images/icon.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="css/style.css" />
</head>
<body>
<header class="site-header">
  <div class="wrap">
    <a class="wordmark" href="/">
      <img src="images/icon.png" alt="" class="wordmark-icon" width="28" height="28" />
      Chess Analyzer
    </a>
  </div>
</header>
<main>
  <section class="success">
    <div class="wrap">
      <h1>You're on the list.</h1>
      <p>I'll email you the moment Chess Analyzer is ready for your platform.</p>
      <a class="button-primary" href="/">Back to the site</a>
    </div>
  </section>
</main>
<footer class="site-footer">
  <div class="wrap">
    <a href="https://github.com/zlakin/chess-analyzer">Source on GitHub</a>
    <span class="footer-sep">&middot;</span>
    <span>MIT licensed</span>
    <span class="footer-sep">&middot;</span>
    <a href="mailto:zacharylakin0@gmail.com">zacharylakin0@gmail.com</a>
  </div>
</footer>
</body>
</html>
```

- [ ] **Step 3: Verify structure**

```bash
grep -c 'name="wishlist"' website/index.html    # expect 2
grep -c 'type="email"' website/index.html       # expect 2
grep -c '<img' website/index.html               # expect 6
grep -c 'netlify-honeypot="bot-field"' website/index.html   # expect 2
```

Expected: exact counts shown in the comments above. A mismatch means a section was dropped or duplicated while writing the file — fix before moving on.

- [ ] **Step 4: Commit**

```bash
git add website/index.html website/success.html
git commit -m "Add website markup: landing page and wishlist success page"
```

---

### Task 3: Styles — Study Room theme + responsive layout

**Files:**
- Create: `website/css/style.css`

**Interfaces:**
- Consumes: the class names and `:root` token names defined in Task 2's HTML and in this plan's Global Constraints section.
- Produces: final visual styling for both pages — no other task depends on this file's internals beyond its filename (`website/css/style.css`, already referenced by both HTML files).

- [ ] **Step 1: Write `website/css/style.css`**

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
  --font-ui: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-display: 'Lora', Georgia, serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  line-height: 1.5;
}

.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.hp-field {
  position: absolute;
  left: -9999px;
}

/* Header */
.site-header {
  padding: 24px 0;
  border-bottom: 1px solid var(--border);
}
.wordmark {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}
.wordmark-icon {
  border-radius: var(--radius-control);
}

/* Hero */
.hero {
  padding: 72px 0;
}
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  align-items: center;
}
.hero-copy h1 {
  font-family: var(--font-display);
  font-size: 2.5rem;
  line-height: 1.15;
  margin: 0 0 20px;
}
.hero-subhead {
  font-size: 1.125rem;
  color: var(--text-muted);
  margin: 0 0 32px;
}
.hero-note {
  font-size: 0.875rem;
  color: var(--text-faint);
  margin: 12px 0 0;
  max-width: 46ch;
}
.hero-media img {
  width: 100%;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-modal);
  display: block;
}

/* Wishlist form */
.wishlist-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.wishlist-form input[type="email"] {
  flex: 1 1 260px;
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 1rem;
}
.wishlist-form input[type="email"]:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.button-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 22px;
  background: var(--accent);
  color: var(--accent-contrast);
  border: none;
  border-radius: var(--radius-control);
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: 1rem;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 rgba(35, 31, 23, 0.18);
  text-decoration: none;
}
.button-primary:hover {
  background: var(--accent-hover);
}

/* Features */
.features {
  padding: 72px 0;
  border-top: 1px solid var(--border);
}
.features h2,
.why-local h2,
.cta-repeat h2 {
  font-family: var(--font-display);
  font-size: 1.75rem;
  margin: 0 0 36px;
  text-align: center;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}
.feature-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  padding: 16px;
}
.feature-card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  object-position: top;
  border-radius: var(--radius-control);
  border: 1px solid var(--border);
  margin-bottom: 16px;
  display: block;
}
.feature-card h3 {
  font-size: 1.0625rem;
  margin: 0 0 8px;
}
.feature-card p {
  color: var(--text-muted);
  font-size: 0.9375rem;
  margin: 0;
}

/* Why local */
.why-local {
  padding: 64px 0;
  text-align: center;
  background: var(--panel-elevated);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.why-local p {
  max-width: 60ch;
  margin: 0 auto;
  color: var(--text-muted);
  font-size: 1.0625rem;
}

/* CTA repeat */
.cta-repeat {
  padding: 72px 0;
  text-align: center;
}
.cta-repeat .wishlist-form {
  justify-content: center;
  max-width: 480px;
  margin: 0 auto;
}

/* Success page */
.success {
  padding: 96px 0;
  text-align: center;
}
.success h1 {
  font-family: var(--font-display);
  font-size: 2rem;
  margin: 0 0 16px;
}
.success p {
  color: var(--text-muted);
  margin: 0 0 32px;
}

/* Footer */
.site-footer {
  padding: 32px 0 48px;
  text-align: center;
  color: var(--text-faint);
  font-size: 0.875rem;
}
.site-footer a {
  color: var(--text-muted);
}
.footer-sep {
  margin: 0 8px;
}

/* Responsive */
@media (max-width: 800px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
  .hero-media {
    order: -1;
  }
  .hero-copy h1 {
    font-size: 2rem;
  }
}
@media (max-width: 640px) {
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .wishlist-form {
    flex-direction: column;
  }
  .wishlist-form .button-primary {
    width: 100%;
  }
}
```

- [ ] **Step 2: Verify the token values match the app's exactly**

```bash
grep -c -- "--accent: #33553a;" website/css/style.css   # expect 1
grep -c -- "--bg: #f3f0e6;" website/css/style.css        # expect 1
```

Expected: both `1`. This is a direct copy from `src/renderer/src/app.css:38-74` — a mismatch means a typo crept in while transcribing.

- [ ] **Step 3: Commit**

```bash
git add website/css/style.css
git commit -m "Style the website with the app's Study Room theme"
```

---

### Task 4: Manual QA in a real browser

**Files:** none created — verification only; may produce fix commits to `website/index.html`, `website/success.html`, or `website/css/style.css` if issues are found.

**Interfaces:**
- Consumes: the complete `website/` tree from Tasks 1–3.
- Produces: nothing new — this is the final gate before the site is considered done.

- [ ] **Step 1: Serve the site locally**

```bash
cd /home/zacharyl/chess/website
python3 -m http.server 5050 &
```

Note the backgrounded PID (or `jobs -p`) so it can be killed in Step 5.

- [ ] **Step 2: Load the site in a real browser and check the desktop layout**

Invoke the `claude-in-chrome` skill, then navigate to `http://localhost:5050/` and take a screenshot. Confirm:
- Header shows the wordmark + icon.
- Hero shows the headline, subheadline, working-looking email field + "Join the wishlist" button, the hero screenshot (not a broken-image icon), and the small-print status note.
- All four feature cards show a loaded image (not broken) with their heading/body text.
- "Why free & local" section renders with the elevated panel background.
- The repeated "Want in?" CTA section renders.
- Footer shows the GitHub link, "MIT licensed", and the email link.

- [ ] **Step 3: Check the narrow/mobile layout**

Resize the browser (or emulate a ~375px-wide viewport) and re-screenshot. Confirm the hero stacks to a single column (copy above image), and the feature grid drops to one column per row, per the `@media` rules in `style.css`.

- [ ] **Step 4: Check native form validation**

On the desktop view, click "Join the wishlist" with the email field empty. Confirm the browser blocks submission and shows its native "fill out this field" validation bubble (no custom JS is involved — this is the browser's built-in `required` handling). Do not attempt to test an actual Netlify submission here — Netlify Forms only processes submissions on Netlify's own infrastructure, not a local static file server; that check happens after the real deploy (see "Deployment" below).

- [ ] **Step 5: Stop the local server**

```bash
kill %1
```

- [ ] **Step 6: Fix anything QA turned up, then commit**

If Steps 2–4 found a real issue (broken image path, layout break, missing validation), fix it in the relevant file and commit:

```bash
git add website/
git commit -m "Fix website QA issues"
```

If nothing was found, confirm the tree is clean instead:

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Deployment (not part of this plan's tasks — requires the user's own Netlify account)

Once Task 4 is done, the site is ready to go live, but the remaining steps need the user's own Netlify login and can't be done from an agent session:

1. In the Netlify dashboard: "Add new site" → import from GitHub → select `zlakin/chess-analyzer`. Netlify reads the root `netlify.toml` automatically (`base`/`publish` = `website`, no build command) — no manual config needed.
2. Netlify auto-detects the `data-netlify="true"` form on first deploy and enables Forms. Optionally add an email notification: Site settings → Forms → Notifications, so submissions land in an inbox, not just the dashboard.
3. Site goes live at the generated `*.netlify.app` URL.
4. Submit one real test entry through the **live** form and confirm it appears in the Netlify Forms dashboard and redirects to `success.html` — this is the one behavior that genuinely can't be verified before a real deploy.

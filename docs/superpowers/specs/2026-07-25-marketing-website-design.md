# Marketing/Wishlist Website — Design Spec

Date: 2026-07-25

## Purpose

Chess Analyzer is functional (engine analysis, accuracy scoring, move
classification, tactical insights) but only packaged today as a Linux
(Arch/pacman) build — no Windows or Mac build exists yet. The user wants
to start building an audience ahead of a real cross-platform launch: a
public single-page website that pitches the product and collects emails
from people who want to be notified when it's ready to download, rather
than promising a download that doesn't broadly exist yet.

This is a new, separate subsystem from the Electron app — a static
marketing page, not app code. It lives alongside the app in this repo but
shares none of its runtime.

## Non-goals

- No real "Download" button. The Linux/pacman build is not linked from
  the site — it's a niche artifact (Arch-family distros only), not a
  general-audience download, and offering it would contradict the
  wishlist-first framing the user chose.
- No blog, docs, changelog, or multi-page site. One page.
- No custom domain setup (no domain owned yet) — ships on Netlify's free
  `*.netlify.app` subdomain; a custom domain can be pointed at it later
  with no code changes.
- No analytics/tracking scripts.
- No account system, auth, or dynamic backend — Netlify Forms is the only
  "backend."

## Architecture

Plain static HTML/CSS + minimal vanilla JS. No framework, no build step,
no npm dependency for the site itself — deliberately not reusing the
app's Vite/React toolchain, which would add a build pipeline for what is
fundamentally one page. Netlify serves the raw files directly.

New folder at repo root:

```
website/
  index.html
  success.html          # Netlify Forms redirect target after signup
  css/style.css
  images/
    icon.png            # copied from build/icon.png
    hero.png            # captured screenshot: main analysis view
    feature-classify.png    # captured: move classification / GameSummary
    feature-insights.png    # captured: Insights tab
    feature-import.png      # captured: chess.com import modal
netlify.toml             # repo root — base/publish = website/, no build command
```

`netlify.toml` lives at the repo root (not inside `website/`) so Netlify
auto-detects the config the moment the repo is connected, with no manual
"set base directory" step in the dashboard:

```toml
[build]
  base = "website"
  publish = "website"
  command = ""
```

## Content & sections

Single page, top to bottom. Copy below is the actual draft copy to ship
with, not placeholder text — refine wording during implementation if it
reads awkwardly in context, but the substance/claims stay as-is.

1. **Header** — "Chess Analyzer" wordmark (Lora, matches app) + small
   icon mark (`build/icon.svg`). No nav links; nothing else on the page
   to navigate to.

2. **Hero**
   - Headline: "The Game Review chess.com wants you to pay for — free,
     and it never leaves your machine."
   - Subheadline: "Chess Analyzer runs a real Stockfish engine locally to
     grade every move, score your accuracy, and surface the patterns
     costing you games. No subscription, no upload."
   - Primary CTA: email field + "Join the wishlist" button (Netlify
     Forms; see below).
   - Small print under the form: "In active development — a Linux build
     already exists today; Windows and Mac are next. I'll email you the
     moment there's a build for your platform."
   - Hero screenshot (`hero.png`): the main analysis view (board +
     eval bar + move list + eval graph), placed beside or behind the
     copy.

3. **Features** — four callouts, each with a captured screenshot:
   - **Full engine analysis & accuracy scoring** — "Every move graded
     against Stockfish, with a per-game accuracy score — the same idea
     chess.com's paid tier uses, running entirely on your machine."
   - **Move-quality classification** — "Brilliant, best, good,
     inaccuracy, mistake, blunder — see exactly where a game turned,
     move by move." (`feature-classify.png`)
   - **Import from chess.com** — "Paste a PGN, upload a file, or search
     your chess.com username directly." (`feature-import.png`)
   - **Tactical insights** — "Recurring forks, pins, hung pieces —
     Insights tracks the patterns actually costing you rating, not just
     single-game noise." (`feature-insights.png`)

4. **Why free & local**
   - Headline: "No subscription. No cloud. No games uploaded anywhere."
   - Body: "Chess Analyzer runs entirely on your machine using a local
     Stockfish engine — your games stay yours, and there's nothing to
     pay for, ever."

5. **Wishlist CTA (repeat)** — same form as the hero, shorter framing:
   "Want in?" + email field + button. Repeating the exact same form
   markup is fine (Netlify treats same-named forms as one form).

6. **Footer** — link to the MIT-licensed GitHub repo
   (`github.com/zlakin/chess-analyzer`), license line, contact
   (`zacharylakin0@gmail.com`).

## Visual design

Reuses the app's "Study Room" palette and fonts verbatim, from
`src/renderer/src/app.css:38-74`
(`docs/superpowers/specs/2026-07-23-study-room-redesign-design.md`) —
same warm-paper background, felt-board green accent, Lora/Manrope/IBM
Plex Mono pairing — so the site reads as a continuation of the product,
not a separate brand:

```css
--bg: #f3f0e6;
--panel: #fffdf8;
--border: #ddd4bc;
--text: #231f17;
--text-muted: #6d6353;
--accent: #33553a;
--accent-hover: #3f6647;
--accent-contrast: #f6f3ea;
--font-ui: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-display: 'Lora', Georgia, serif;
```

Fonts load from Google Fonts (or a small self-hosted subset) rather than
the app's `@fontsource` npm packages, since the site has no npm build —
CDN `<link>` tags in `index.html`'s `<head>`.

Layout: single column, generous whitespace, screenshots in framed cards
(`--panel` background, `--border` outline, matching the app's panel
treatment). Responsive: stack hero copy above the screenshot below
~800px; features go from a 3-column grid to single column below ~640px.

## Wishlist form (Netlify Forms)

Plain HTML form, no JS required for the core flow:

```html
<form name="wishlist" method="POST" data-netlify="true"
      netlify-honeypot="bot-field" action="/success.html">
  <input type="hidden" name="form-name" value="wishlist" />
  <p class="hidden"><label>Don't fill this out: <input name="bot-field" /></label></p>
  <input type="email" name="email" required placeholder="you@example.com" />
  <button type="submit">Join the wishlist</button>
</form>
```

- `netlify-honeypot` gives spam protection with zero extra service.
- Submitting redirects to `success.html` (styled consistently: "You're on
  the list — I'll email you when Chess Analyzer is ready for your
  platform." + link back to `/`). This is a plain redirect, not an AJAX
  intercept, so it works with zero JS and zero extra failure modes.
- Both the hero and repeated bottom form use `name="wishlist"` — Netlify
  merges same-named forms into one dataset in the dashboard.
- Browser-native `required`/`type="email"` covers input validation; no
  custom JS validation needed.

## Assets

Screenshots are captured live from the running app via the `run-desktop`
skill rather than mocked up, so the site shows the real UI:
- Main analysis view (board/eval-bar/move-list/eval-graph) → `hero.png`
- GameSummary with the move-classification legend → `feature-classify.png`
- Insights tab → `feature-insights.png`
- Import modal (chess.com tab) → `feature-import.png`

`build/icon.png` and `build/icon.svg` are copied into `website/images/`
and reused for the header mark and favicon — no new icon work.

## Error handling

- Netlify Forms handles submission failures itself (network errors surface
  as normal browser form-submission failures — no custom handling needed).
- No client-side JS in the critical path means no JS-error failure mode
  for the form itself.

## Deployment

Steps 1–2 are code (this session does them); steps 3+ require the user's
own Netlify account and can't be done from this session:

1. Build `website/` and root `netlify.toml` in this repo, commit to
   `main` (per this repo's existing git workflow — no branches/PRs).
2. Verify the page locally (open `website/index.html` directly, or serve
   the folder with any static file server) before deploy.
3. **User action:** in the Netlify dashboard, "Add new site" → import
   from GitHub → select `zlakin/chess-analyzer`. Netlify reads the root
   `netlify.toml` automatically (base/publish = `website`, no build
   command) — no manual config needed.
4. **User action:** Netlify auto-detects the `data-netlify="true"` form
   on first deploy and enables Forms; optionally add an email
   notification (Site settings → Forms → Notifications) so submissions
   land in an inbox, not just the dashboard.
5. Site is live at the generated `*.netlify.app` URL. A custom domain can
   be attached later with no code changes.

## Testing

No automated test suite — static content, nothing to unit-test, and
adding one would be pure overhead for a one-page marketing site (YAGNI).
Manual QA instead:
- Open the page locally at desktop and mobile widths (~375px, ~800px,
  ~1280px), confirm layout doesn't break and images load.
- Confirm the email field rejects empty/invalid input via native
  validation before submit.
- After the real Netlify deploy (user-driven, per above), submit one
  real test entry through the live form and confirm it appears in the
  Netlify dashboard and redirects to `success.html`.

## Future ideas (explicitly deferred)

- Real "Download" button once Windows/Mac builds exist — replaces or
  supplements the wishlist CTA.
- Custom domain.
- A changelog/blog if the user wants to post progress updates.
- Analytics, if the user wants signup-conversion visibility later.

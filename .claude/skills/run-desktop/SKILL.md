---
name: run-desktop
description: Build, run, and drive the Chess Analyzer Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI.
---

Chess Analyzer is an Electron desktop app. This dev machine has a real X11
display (`DISPLAY=:0`, XWayland under KDE) — no xvfb needed. Drive it via
the Playwright `_electron` batch driver at `driver.mjs` in this directory.

There is no `tmux` on this machine, so the driver is **batch mode**, not a
REPL: write a newline-separated list of commands to a file and pass that
file as the one argument. The driver launches the app, runs each command
in order, and closes the app when the file is exhausted (or after any
FATAL error).

## Build

```bash
cd /home/zacharyl/chess
npm install
npm run build   # writes out/main, out/preload, out/renderer -- driver launches this build, not `npm run dev`
```

Re-run `npm run build` after any renderer/main/preload change before
driving the app — the driver launches `out/`, which `npm run dev` does not
write to.

## Run

```bash
node .claude/skills/run-desktop/driver.mjs /path/to/commands.txt
```

Example `commands.txt`:

```
launch
fill textarea 1.e4 e5 2.Nf3 Nc6 3.Bb5 1-0
click-text Load Game
wait .game-summary 90000
ss done
click .board-nav button:nth-child(2)
press ArrowRight
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the built app, wait for the window |
| `ss [name]` | screenshot -> `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()` (not coordinates) |
| `click-text <text>` | click the button/link whose text matches |
| `fill <css-sel> <value>` | set an input/textarea's value through React's native value setter, then dispatch `input` (a plain `el.value = v` is invisible to React's change detection) |
| `press <key>` | keyboard key press (e.g. `ArrowRight`, `Home`) |
| `wait <css-sel> [timeoutMs]` | wait for a selector, default 10s timeout |
| `sleep <ms>` | pause |
| `eval <js-expr>` | evaluate a JS expression in the page, print JSON |
| `text [css-sel]` | print `innerText` of a selector (or `body`) |

Note: `fill`'s first space splits selector from value, so the selector
itself can't contain a space — use a tag/id/class selector like `textarea`
rather than a descendant combinator like `.import-panel textarea`.

## Gotchas

- **Driver must live under the project's `node_modules` resolution
  scope** (i.e. inside `/home/zacharyl/chess`, not `/tmp`) — Node's ESM
  resolver looks for `playwright-core` relative to the importing file's
  own `node_modules` ancestry, not the CWD.
- **`fill` needs React's native value setter**, not a plain
  `el.value = v` — React patches the value property to detect real
  input, so a naive assignment + `dispatchEvent(new Event('input'))`
  is silently ignored and `onChange` never fires.
- **Analysis takes real wall-clock time** (~1s/ply at the app's default
  depth 18) — `wait .game-summary` needs a timeout long enough for the
  full game (e.g. 90000 for a ~30-ply game), not the 10s default.
- **A stray Recharts tooltip can appear in screenshots** even without an
  explicit hover/click on the chart — this is a real X11 display, so the
  OS mouse cursor's actual on-screen position can rest over the chart
  between driver commands. Not an app bug; move the mouse or click
  elsewhere first if it's in the way of what you're checking.
- **The session runs under native Wayland** (`XDG_SESSION_TYPE=wayland`),
  not X11 directly — Electron's Ozone platform auto-detection picks native
  Wayland when it's available, and in this environment that hangs
  indefinitely before ever creating a GPU or renderer process (`ps` shows
  only the browser process, spinning at ~40-45% CPU with no children of
  type `gpu-process`/`renderer`, even after 90s). `driver.mjs` already
  passes `--ozone-platform=x11` to force XWayland, which launches normally
  in a few seconds — if you ever see the driver's `launch` step time out
  again, check `ps aux | grep electron` for this exact symptom (CPU-spinning
  parent, no gpu-process/renderer children) before assuming it's an app
  bug.

## Run (human path)

```bash
npm run dev   # opens a window with hot reload; fine for a human, not for the driver (see Build above)
```

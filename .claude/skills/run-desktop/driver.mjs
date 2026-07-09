// Batch driver for Chess Analyzer (Electron). Real X11 display available (DISPLAY=:0), no xvfb needed.
// Usage: node driver.mjs commands.txt
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = '/home/zacharyl/chess'
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron')

let app = null
let page = null

const COMMANDS = {
  async launch() {
    app = await electron.launch({
      executablePath: electronBin,
      args: ['--no-sandbox', APP_DIR],
      timeout: 30_000
    })
    await new Promise((r) => setTimeout(r, 2_000))
    page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow())
    console.log('launched.', app.windows().length, 'windows:')
    for (const w of app.windows()) console.log(' ', w.url())
  },
  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },
  async click(sel) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '->', r)
  },
  async 'click-text'(text) {
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '->', r)
  },
  async fill(args) {
    const spaceIdx = args.indexOf(' ')
    const sel = args.slice(0, spaceIdx)
    const value = args.slice(spaceIdx + 1)
    // React tracks the native value setter to detect real user input; a plain
    // `el.value = v` is invisible to it, so onChange never fires. Go through
    // the prototype's setter instead, matching how React's own instrumentation expects it.
    const r = await page.evaluate(
      ({ s, v }) => {
        const el = document.querySelector(s)
        if (!el) return 'NOT_FOUND'
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return 'OK'
      },
      { s: sel, v: value }
    )
    console.log('fill', sel, '->', r)
  },
  async wait(args) {
    const [sel, timeoutMs] = args.split(' ')
    try {
      await page.waitForSelector(sel, { timeout: Number(timeoutMs) || 10_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },
  async sleep(ms) {
    await new Promise((r) => setTimeout(r, Number(ms)))
  },
  async press(key) {
    await page.keyboard.press(key)
    console.log('pressed', key)
  },
  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },
  async text(sel) {
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)
    )
  }
}

async function main() {
  const scriptFile = process.argv[2]
  const lines = fs
    .readFileSync(scriptFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  for (const line of lines) {
    const spaceIdx = line.indexOf(' ')
    const cmd = spaceIdx === -1 ? line : line.slice(0, spaceIdx)
    const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1)
    const fn = COMMANDS[cmd]
    if (!fn) {
      console.log('unknown command:', cmd)
      continue
    }
    console.log('>>>', line)
    try {
      await fn(rest)
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  }

  if (app) await app.close().catch(() => {})
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})

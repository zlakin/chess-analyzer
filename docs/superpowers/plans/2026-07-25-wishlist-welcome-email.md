# Wishlist Welcome Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Netlify Function that sends a plain-text "thanks for joining" email to each wishlist signup, invoked automatically by Netlify's `formSubmitted` event-function mechanism.

**Architecture:** One Netlify event-triggered Function (`netlify/functions/send-welcome-email.mjs`, `export default { formSubmitted(event) {...} }`) calling Resend's REST API directly via `fetch` — no new npm dependency. `netlify.toml` gets an explicit `[functions]` block. No database, no HTML template, no test suite (matches the site's existing build-step-free approach) — verification is a real end-to-end send after manual Netlify/Resend dashboard setup.

**Revision note (2026-07-25):** this plan originally specified a Netlify Forms "Outgoing webhook" (a publicly-POST-able HTTP endpoint, `exports.handler`/`{statusCode, body}` contract). The final whole-branch review found Netlify's built-in event-triggered function mechanism was strictly better (no public endpoint — Netlify verifies invocations internally — one less manual dashboard step, and a clearly-documented payload shape where the webhook's was ambiguous), and the repo owner chose to adopt it. This revision reflects that.

**Tech Stack:** Node.js (Netlify Functions runtime, ES modules), Resend REST API (plain HTTP, no SDK).

## Global Constraints

- No new npm dependency added anywhere in the repo — the function uses only the global `fetch` and Node built-ins.
- No HTML email — plain text only, exact copy given in this plan (verbatim, not paraphrased).
- No cryptographic webhook signature verification code — moot: Netlify verifies `formSubmitted` invocations internally before calling the handler, so there is no public endpoint left to protect (see the design spec's "Security" section).
- The handler's return value is unused by the platform (`void`/`Promise<void>`) — there is no HTTP status-code contract to satisfy. Every branch (malformed/missing email, wrong form, a failed Resend call) logs via `console.log`/`console.error` and returns, nothing more.
- Config is entirely via Netlify environment variables — `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SITE_URL` — never hardcoded or committed. `SITE_URL` falls back to Netlify's own `URL` env var, then a hardcoded placeholder, if unset.
- Reply-to is hardcoded to `zacharylakin0@gmail.com` (already public in the site footer) — not an env var, matching how the footer itself hardcodes it.
- This repo's git workflow: commit straight to `main`, no branches/worktrees/PRs.

---

### Task 1: Welcome-email Netlify Function

**Files:**
- Create: `netlify/functions/send-welcome-email.mjs` (this task supersedes
  and replaces `netlify/functions/send-welcome-email.js` from the
  original webhook-based implementation — delete the `.js` file as part
  of this task, see Step 1)
- Modify: `netlify.toml` (repo root) — no change needed beyond what's
  already there (the `[functions]` block from the original
  implementation is unchanged; event-triggered functions live in and
  are bundled from the same `netlify/functions/` directory)

**Interfaces:**
- Consumes: Netlify's `FormSubmittedEvent` — `event.data` is "an object
  keyed by field name with string values, capturing the verified
  submission exactly as received" (Netlify's own documented, current
  API for this purpose — this resolves what was previously an
  undocumented, ambiguous payload shape).
- Consumes: `process.env.RESEND_API_KEY`, `process.env.RESEND_FROM_EMAIL`,
  `process.env.SITE_URL`, `process.env.URL` at runtime (set by Netlify
  itself or the dashboard, not by this task — the function must not
  throw if they're unset locally, since there's no local test harness
  that provides them; see Step 3's mock-based verification, which
  doesn't require real values).
- Produces: nothing consumed by other tasks — this is the only task in
  this plan.

- [ ] **Step 1: Replace `netlify/functions/send-welcome-email.js` with `netlify/functions/send-welcome-email.mjs`**

```bash
rm -f netlify/functions/send-welcome-email.js
```

Then write `netlify/functions/send-welcome-email.mjs`:

```js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default {
  async formSubmitted(event) {
    const data = event.data ?? {}
    const formName = data['form-name']
    const email = typeof data.email === 'string' ? data.email.trim() : ''

    if (formName !== 'wishlist' || !email || email.length > 254 || !EMAIL_RE.test(email)) {
      // Netlify only invokes this handler for submissions it already
      // verified as non-spam - this check is just "is this our
      // wishlist form with a plausible email," not spam filtering.
      console.log('Ignoring non-wishlist or malformed submission', { formName, hasEmail: !!email })
      return
    }

    const siteUrl = process.env.SITE_URL || process.env.URL
    const fromAddress = process.env.RESEND_FROM_EMAIL
    const apiKey = process.env.RESEND_API_KEY

    if (!apiKey || !fromAddress) {
      console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL - skipping welcome email')
      return
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: email,
          reply_to: 'zacharylakin0@gmail.com',
          subject: "You're on the Chess Analyzer wishlist",
          text: [
            'Thanks for joining the Chess Analyzer wishlist.',
            '',
            "Chess Analyzer is real and working today — engine analysis, accuracy",
            'scoring, move classification, and tactical insights are all built.',
            "Right now there's a Linux build; Windows and Mac are next. I'll email",
            "you the moment there's a build for your platform.",
            '',
            `In the meantime: ${siteUrl || 'https://chessanalyzer.app'}`,
            '',
            '— Zachary',
          ].join('\n'),
        }),
      })

      if (res.ok) {
        console.log('Welcome email sent')
      } else {
        console.error('Resend API error', res.status, await res.text())
      }
    } catch (err) {
      console.error('Failed to send welcome email', err)
    }
  },
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check netlify/functions/send-welcome-email.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 3: Write and run a throwaway verification script (not committed) exercising all branches**

This project has no automated test suite for the website/functions layer
(a deliberate design decision — see the design spec), so this is a
one-off smoke test to prove the logic before committing, not a permanent
test file. The handler's return value is always `undefined` now (no
HTTP status contract), so these assertions check `fetchCalls` (did it
call Resend?) and the sent body's contents instead of a status code.

```bash
cat > /tmp/verify-welcome-email.mjs <<'EOF'
import assert from 'node:assert/strict'
import fn from '/home/zacharyl/chess/netlify/functions/send-welcome-email.mjs'

let fetchCalls = []
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'test-message-id' }) }
}

function makeEvent(data) {
  return { data }
}

// Case 1: valid wishlist submission -> calls Resend
process.env.RESEND_API_KEY = 'test-key'
process.env.RESEND_FROM_EMAIL = 'Chess Analyzer <wishlist@example.com>'
process.env.SITE_URL = 'https://example.netlify.app'

await fn.formSubmitted(makeEvent({ 'form-name': 'wishlist', email: 'person@example.com' }))
assert.equal(fetchCalls.length, 1)
assert.equal(fetchCalls[0].url, 'https://api.resend.com/emails')
const body = JSON.parse(fetchCalls[0].opts.body)
assert.equal(body.to, 'person@example.com')
assert.equal(body.reply_to, 'zacharylakin0@gmail.com')
assert.equal(body.subject, "You're on the Chess Analyzer wishlist")
assert.ok(body.text.includes('https://example.netlify.app'))
console.log('Case 1 (valid submission) passed')

// Case 2: wrong form name -> no fetch call
fetchCalls = []
await fn.formSubmitted(makeEvent({ 'form-name': 'not-wishlist', email: 'person@example.com' }))
assert.equal(fetchCalls.length, 0)
console.log('Case 2 (wrong form name) passed')

// Case 3: malformed email -> no fetch call
fetchCalls = []
await fn.formSubmitted(makeEvent({ 'form-name': 'wishlist', email: 'not-an-email' }))
assert.equal(fetchCalls.length, 0)
console.log('Case 3 (malformed email) passed')

// Case 4: missing data entirely -> no throw, no fetch call
fetchCalls = []
await fn.formSubmitted({})
assert.equal(fetchCalls.length, 0)
console.log('Case 4 (missing data) passed')

// Case 5: SITE_URL unset -> falls back, doesn't send literal "undefined"
fetchCalls = []
delete process.env.SITE_URL
delete process.env.URL
await fn.formSubmitted(makeEvent({ 'form-name': 'wishlist', email: 'person2@example.com' }))
assert.equal(fetchCalls.length, 1)
const body2 = JSON.parse(fetchCalls[0].opts.body)
assert.ok(!body2.text.includes('undefined'))
console.log('Case 5 (missing SITE_URL) passed')

// Case 6: missing RESEND_API_KEY -> no fetch call
fetchCalls = []
delete process.env.RESEND_API_KEY
await fn.formSubmitted(makeEvent({ 'form-name': 'wishlist', email: 'person3@example.com' }))
assert.equal(fetchCalls.length, 0)
console.log('Case 6 (missing RESEND_API_KEY) passed')

// Case 7: form-name key absent but a valid email present -> DOES call Resend
// now (this is the Critical fix - a missing form-name must not silently
// suppress every send, since this site has only one form anyway)
process.env.RESEND_API_KEY = 'test-key'
fetchCalls = []
await fn.formSubmitted({ data: { email: 'person4@example.com' } })
assert.equal(fetchCalls.length, 1)
console.log('Case 7 (form-name absent, valid email) passed')

console.log('All cases passed')
EOF
node /tmp/verify-welcome-email.mjs
```

Expected output: `Case 1 (valid submission) passed` through `Case 7
(form-name absent, valid email) passed`, then `All cases passed`, exit
code 0. If any assertion fails, fix `send-welcome-email.mjs` and re-run —
do not proceed to Step 4 until all seven cases pass.

- [ ] **Step 4: Confirm `netlify.toml` already has the `[functions]` block**

```bash
cat netlify.toml
```

Expected:
```toml
[build]
  publish = "website"

[functions]
  directory = "netlify/functions"
```

This was already added by the original implementation and needs no
change — event-triggered functions are bundled from the same directory
as webhook-style ones. If it's missing for any reason, add it.

- [ ] **Step 5: Confirm the rest of the repo's test suite still passes**

```bash
npm run verify
```

Expected: same as before this change — all existing tests pass, typecheck
clean (this task doesn't touch `src/`, so this is a regression check, not
expected to reveal anything new).

- [ ] **Step 6: Clean up the throwaway script and commit**

```bash
rm -f /tmp/verify-welcome-email.mjs
git add netlify/ netlify.toml
git status  # confirm this stages both the new .mjs file AND the .js deletion from Step 1
git commit -m "Switch wishlist welcome email to an event-triggered function"
```

# Wishlist Welcome Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Netlify Function that sends a plain-text "thanks for joining" email to each wishlist signup, triggered by a Netlify Forms outgoing webhook.

**Architecture:** One Netlify Function (`netlify/functions/send-welcome-email.js`) calling Resend's REST API directly via `fetch` — no new npm dependency. `netlify.toml` gets an explicit `[functions]` block. No database, no HTML template, no test suite (matches the site's existing build-step-free approach) — verification is a real end-to-end send after manual Netlify/Resend dashboard setup.

**Tech Stack:** Node.js (Netlify Functions runtime, CommonJS), Resend REST API (plain HTTP, no SDK).

## Global Constraints

- No new npm dependency added anywhere in the repo — the function uses only the global `fetch` and Node built-ins.
- No HTML email — plain text only, exact copy given in this plan (verbatim, not paraphrased).
- No cryptographic webhook signature verification — a deliberate, already-approved tradeoff (see the design spec's "Security" section). Validation is payload-shape only: correct `form_name`, plausible `email`.
- The function must return HTTP 200 in every case (malformed payload, wrong form, invalid email, or a failed Resend call) — there is no caller waiting on a meaningful error response, and nothing should be retried.
- Config is entirely via Netlify environment variables — `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SITE_URL` — never hardcoded or committed.
- Reply-to is hardcoded to `zacharylakin0@gmail.com` (already public in the site footer) — not an env var, matching how the footer itself hardcodes it.
- This repo's git workflow: commit straight to `main`, no branches/worktrees/PRs.

---

### Task 1: Welcome-email Netlify Function

**Files:**
- Create: `netlify/functions/send-welcome-email.js`
- Modify: `netlify.toml` (repo root)

**Interfaces:**
- Consumes: a Netlify Forms outgoing-webhook POST body shaped like
  `{ "payload": { "form_name": "wishlist", "data": { "email": "...", ... } } }`
  (Netlify's documented outgoing-webhook payload shape for form
  submissions — the `data` object holds the raw submitted field values).
- Consumes: `process.env.RESEND_API_KEY`, `process.env.RESEND_FROM_EMAIL`,
  `process.env.SITE_URL` at runtime (set in the Netlify dashboard, not
  by this task — the function must not throw if they're unset locally,
  since there's no local test harness that provides them; see Step 3's
  mock-based verification, which doesn't require real values).
- Produces: nothing consumed by other tasks — this is the only task in
  this plan.

- [ ] **Step 1: Write `netlify/functions/send-welcome-email.js`**

```js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let submission
  try {
    submission = JSON.parse(event.body).payload
  } catch {
    // Malformed body - nothing to parse, nothing to send. Same 200
    // no-op as the shape-validation branch below (see "Error handling"):
    // there's no caller reacting to our status code either way.
    return { statusCode: 200, body: 'Invalid payload' }
  }

  const email = submission?.data?.email
  const formName = submission?.form_name

  if (formName !== 'wishlist' || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Not a real wishlist submission (wrong form, missing/malformed
    // email) - acknowledge and do nothing. Not an error: Netlify Forms
    // notifications aren't ours to reject, we just have nothing to send.
    return { statusCode: 200, body: 'Ignored' }
  }

  const siteUrl = process.env.SITE_URL
  const fromAddress = process.env.RESEND_FROM_EMAIL
  const apiKey = process.env.RESEND_API_KEY

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
          `In the meantime: ${siteUrl}`,
          '',
          '— Zachary',
        ].join('\n'),
      }),
    })

    if (!res.ok) {
      console.error('Resend API error', res.status, await res.text())
    }
  } catch (err) {
    console.error('Failed to send welcome email', err)
  }

  // Always 200: the signup itself already succeeded via Netlify Forms
  // before this function ever runs. A failed confirmation email is a
  // logged, non-fatal side effect - there's no one waiting on this
  // response and nothing to retry.
  return { statusCode: 200, body: 'OK' }
}
```

- [ ] **Step 2: Verify syntax**

```bash
node --check netlify/functions/send-welcome-email.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Write and run a throwaway verification script (not committed) exercising all three branches**

This project has no automated test suite for the website/functions layer
(a deliberate design decision — see the design spec), so this is a
one-off smoke test to prove the logic before committing, not a permanent
test file.

```bash
cat > /tmp/verify-welcome-email.mjs <<'EOF'
import assert from 'node:assert/strict'
import { handler } from '../home/zacharyl/chess/netlify/functions/send-welcome-email.js'

let fetchCalls = []
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts })
  return { ok: true, status: 200, text: async () => '' }
}

function makeEvent(payload) {
  return { httpMethod: 'POST', body: JSON.stringify({ payload }) }
}

// Case 1: valid wishlist submission -> calls Resend, returns 200
process.env.RESEND_API_KEY = 'test-key'
process.env.RESEND_FROM_EMAIL = 'Chess Analyzer <wishlist@example.com>'
process.env.SITE_URL = 'https://example.netlify.app'

let res = await handler(makeEvent({ form_name: 'wishlist', data: { email: 'person@example.com' } }))
assert.equal(res.statusCode, 200)
assert.equal(fetchCalls.length, 1)
assert.equal(fetchCalls[0].url, 'https://api.resend.com/emails')
const body = JSON.parse(fetchCalls[0].opts.body)
assert.equal(body.to, 'person@example.com')
assert.equal(body.reply_to, 'zacharylakin0@gmail.com')
assert.equal(body.subject, "You're on the Chess Analyzer wishlist")
assert.ok(body.text.includes('https://example.netlify.app'))
console.log('Case 1 (valid submission) passed')

// Case 2: wrong form name -> no fetch call, still 200
fetchCalls = []
res = await handler(makeEvent({ form_name: 'not-wishlist', data: { email: 'person@example.com' } }))
assert.equal(res.statusCode, 200)
assert.equal(fetchCalls.length, 0)
console.log('Case 2 (wrong form name) passed')

// Case 3: malformed email -> no fetch call, still 200
fetchCalls = []
res = await handler(makeEvent({ form_name: 'wishlist', data: { email: 'not-an-email' } }))
assert.equal(res.statusCode, 200)
assert.equal(fetchCalls.length, 0)
console.log('Case 3 (malformed email) passed')

// Case 4: malformed JSON body -> 200 no-op (same as other invalid
// shapes - see the Global Constraints note on always returning 200),
// no fetch call
fetchCalls = []
res = await handler({ httpMethod: 'POST', body: 'not json' })
assert.equal(res.statusCode, 200)
assert.equal(fetchCalls.length, 0)
console.log('Case 4 (malformed JSON) passed')

console.log('All cases passed')
EOF
node /tmp/verify-welcome-email.mjs
```

Expected output: `Case 1 (valid submission) passed` through `Case 4
(malformed JSON) passed`, then `All cases passed`, exit code 0. If any
assertion fails, fix `send-welcome-email.js` and re-run — do not proceed
to Step 4 until all four cases pass.

- [ ] **Step 4: Add the `[functions]` block to `netlify.toml`**

Current content:
```toml
[build]
  publish = "website"
```

New content:
```toml
[build]
  publish = "website"

[functions]
  directory = "netlify/functions"
```

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
git add netlify/functions/send-welcome-email.js netlify.toml
git commit -m "Add wishlist welcome-email Netlify Function"
```

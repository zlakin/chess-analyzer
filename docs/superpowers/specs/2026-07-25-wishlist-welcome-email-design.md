# Wishlist Welcome Email — Design Spec

Date: 2026-07-25

## Purpose

The marketing/wishlist website (`docs/superpowers/specs/2026-07-25-marketing-website-design.md`)
is live and collecting signups via Netlify Forms, but submitters get no
confirmation that it worked — Netlify Forms only notifies the site owner,
it has no built-in autoresponse-to-submitter feature. This spec adds a
"thanks for joining" email sent automatically to each wishlist signup.

## Non-goals

- No HTML email template — plain text only, matching the site's plain,
  honest tone. No email design system to build/maintain for one email.
- No welcome *sequence* (drip campaign, multiple emails over time) — one
  confirmation email per signup, nothing more.
- No admin UI, database, or unsubscribe mechanism — this is a single
  transactional send per signup, not a mailing-list product. (A future
  "here's the Windows build" announcement email to the whole list is
  explicitly out of scope here — this spec only covers the immediate
  per-signup confirmation.)
- No cryptographic webhook signature verification code — moot under the
  revised architecture (see "Security" below): Netlify verifies
  event-function invocations internally, so there's no public endpoint
  left for a signature scheme to protect.
- No code-level handling of domain purchase/verification — those are
  manual account-level actions outside this repo.

## Architecture

**Revision note (2026-07-25, same day):** the first version of this spec
used a Netlify Forms "Outgoing webhook" notification (a dashboard-
configured, publicly-POST-able HTTP endpoint). The final review of the
implementation surfaced a better option — Netlify's built-in
**event-triggered function** mechanism — and it was adopted instead.
Rationale below supersedes the original webhook-based design.

A single Netlify Function, using Netlify's `formSubmitted` event-handler
convention, is invoked automatically and directly by Netlify's platform
whenever a form submission is verified — no dashboard notification to
configure, and (per Netlify's own docs) these event functions are not
publicly invokable over HTTP at all: Netlify verifies the request
originated from its own platform before ever calling the handler. It
calls Resend's REST API directly via `fetch` — no npm dependency added,
since Resend's API is a single plain HTTP POST with a JSON body and a
bearer token.

```
signup on the live site
  -> Netlify Forms (existing, unchanged) verifies the submission (spam-filters it)
  -> Netlify invokes the formSubmitted handler directly (no public URL, no webhook config)
  -> netlify/functions/send-welcome-email.mjs
       - light shape validation (see Security)
       - POSTs to https://api.resend.com/emails
  -> Resend delivers the email
```

This also resolves what was previously an open ambiguity: the outgoing-
webhook payload shape wasn't clearly documented anywhere, while
`formSubmitted`'s `event.data` (an object keyed by field name, string
values, "capturing the verified submission exactly as received") is
Netlify's own documented, current API surface for this exact purpose.

New file:

```
netlify/functions/send-welcome-email.mjs
```

(`.mjs`, not `.js` — self-describing as an ES module rather than relying
on the repo root `package.json`'s `"type": "module"`, which this
function has no real relationship to, that field being there for the
unrelated Electron app.)

`netlify.toml` (repo root) still needs the same explicit `[functions]`
block added to the existing `[build]` block — event-triggered functions
still live in and are bundled from this directory, this part is
unchanged by the revision:

```toml
[build]
  publish = "website"

[functions]
  directory = "netlify/functions"
```

(Explicit rather than relying on Netlify's default-directory
auto-detection — this project has twice already hit surprises from
Netlify dashboard/build defaults silently overriding what the repo's
config implies.)

## The function

`netlify/functions/send-welcome-email.mjs` — ES module, Node 18+
(matches this repo's `engines.node` floor), using the global `fetch`
(no `node-fetch`/`resend` package needed). Uses Netlify's modern
event-handler export (`export default { formSubmitted(event) {...} }`)
rather than the classic `exports.handler`/`{statusCode, body}` HTTP
contract — there's no HTTP response semantics here at all (return value
is unused by the platform), which is why there's no "always return 200"
rule in this revision: that concern only existed for the old
publicly-POST-able webhook model.

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

`siteUrl` falls back to Netlify's own auto-injected `URL` env var, then
to a hardcoded placeholder, so a missing/misnamed `SITE_URL` can't ship
an email containing the literal text "undefined" — final review finding.

## Security

Netlify's own platform verifies that a `formSubmitted` invocation
genuinely originated from a real, spam-filtered form submission on this
site before ever calling the handler (per Netlify's docs: event
functions are not publicly invokable — Netlify signs and verifies these
internally). This is a strictly better security posture than the
original webhook-based design's "light validation only" compromise,
achieved with *less* code, not more — so the earlier discussion of
skipping JWS verification (previously accepted as a deliberate tradeoff)
is now moot: there is no public endpoint left to protect. The in-code
`formName`/`email` check that remains is not a security boundary, just a
"this is the form we care about" filter, kept for the same defense-in-
depth reasons as before but at effectively zero remaining risk.

## Configuration (Netlify environment variables — none committed to the repo)

- `RESEND_API_KEY` — from the Resend dashboard, after domain verification.
- `RESEND_FROM_EMAIL` — e.g. `Chess Analyzer <wishlist@yourdomain.com>`,
  using the verified domain.
- `SITE_URL` — the site's real URL (the Netlify subdomain today, or the
  custom domain once/if one is pointed at the site). Falls back to
  Netlify's own `URL` env var, then a hardcoded placeholder, if unset.

## Manual setup (outside this repo — cannot be done from an agent session)

1. Buy a domain (any registrar).
2. In Resend: add the domain, add the DNS records it gives you at your
   registrar, wait for verification.
3. In Resend: create an API key.
4. In Netlify: Site configuration -> Environment variables -> add
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SITE_URL`.
5. Redeploy (a fresh deploy is needed to pick up the new function and
   env vars) and submit one real test signup on the live site to
   confirm the email arrives.

(No dashboard Forms-notification step, unlike the original design — the
event-triggered function wires itself up automatically once deployed.)

## Error handling

Covered inline in "The function" above: a malformed/missing email or a
non-wishlist form submission is logged and skipped, not an error state
— there is no return value the platform inspects, so "error handling"
here means "log enough to debug it, then stop," not signaling failure
to any caller. Resend failures are logged (visible in Netlify's
function logs) and swallowed for the same reason: nothing retries based
on this function's outcome.

## Testing

No automated test suite (matches the rest of the website's static,
build-step-free approach) — verification is a real end-to-end send:
after the manual setup steps above, submit a real signup on the live
site and confirm the email actually arrives, using the address it was
sent to and the account it came from. Netlify's function logs
(Site -> Functions -> send-welcome-email) are the way to check what
happened if it doesn't.

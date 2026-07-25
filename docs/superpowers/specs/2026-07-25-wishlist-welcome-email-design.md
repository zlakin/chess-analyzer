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
- No cryptographic webhook signature verification (see "Security"
  below) — a deliberate, discussed tradeoff, not an oversight.
- No code-level handling of domain purchase/verification — those are
  manual account-level actions outside this repo.

## Architecture

A single Netlify Function, triggered by a Netlify Forms "Outgoing
webhook" notification (configured in the Netlify dashboard, not in
code), calls Resend's REST API directly via `fetch` — no npm dependency
added, since Resend's API is a single plain HTTP POST with a JSON body
and a bearer token.

```
signup on the live site
  -> Netlify Forms (existing, unchanged)
  -> Outgoing Webhook notification (dashboard config, this spec's setup)
  -> netlify/functions/send-welcome-email.js
       - validates the payload (see Security)
       - POSTs to https://api.resend.com/emails
  -> Resend delivers the email
```

New file:

```
netlify/functions/send-welcome-email.js
```

`netlify.toml` (repo root) gets an explicit `[functions]` block added
to the existing `[build]` block:

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

`netlify/functions/send-welcome-email.js` — CommonJS, Node 18+ (matches
this repo's `engines.node` floor; Netlify's function runtime supports
this), using the global `fetch` (no `node-fetch`/`resend` package
needed):

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

## Security

Discussed and deliberately chosen over full Netlify JWS webhook-signature
verification: this function is protected only by payload-shape
validation (right `form_name`, a plausible `email`), not cryptographic
verification of the request's origin. Rationale: the JWS mechanism
requires an added dependency and a subtle HMAC/serialization detail that
Netlify's own community docs flag as an easy way to silently break
verification (a mismatch between how the secret-holder re-serializes the
body and how Netlify originally hashed it) — for a low-traffic personal
project, a silently-broken "security" check that stops real emails from
sending is a worse failure mode than the bounded abuse it would prevent.

Residual risk, accepted: someone who discovers the function's public URL
could POST a fabricated payload and cause a "you're on the wishlist"
email to be sent to an arbitrary address. Bounded by Resend's free-tier
caps (100/day, 3,000/month) — abuse exhausts the day's quota rather than
scaling unboundedly. If this becomes a real problem (quota exhaustion,
Resend flagging the account), revisit with real JWS verification then.

## Configuration (Netlify environment variables — none committed to the repo)

- `RESEND_API_KEY` — from the Resend dashboard, after domain verification.
- `RESEND_FROM_EMAIL` — e.g. `Chess Analyzer <wishlist@yourdomain.com>`,
  using the verified domain.
- `SITE_URL` — the site's real URL (the Netlify subdomain today, or the
  custom domain once/if one is pointed at the site).

## Manual setup (outside this repo — cannot be done from an agent session)

1. Buy a domain (any registrar).
2. In Resend: add the domain, add the DNS records it gives you at your
   registrar, wait for verification.
3. In Resend: create an API key.
4. In Netlify: Site configuration -> Environment variables -> add
   `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SITE_URL`.
5. In Netlify: Site configuration -> Forms -> Notifications -> Add
   notification -> Outgoing webhook. Event: "New form submission".
   Form: "wishlist". URL: `https://<your-site>/.netlify/functions/send-welcome-email`.
6. Redeploy (env vars and new functions require a fresh deploy to take
   effect) and submit one real test signup on the live site to confirm
   the email arrives.

## Error handling

Covered inline in "The function" above: malformed JSON, wrong form
name, or a malformed email all short-circuit to a `200`/no-op rather
than an error — this endpoint has no caller waiting on a meaningful
response, so there's nothing to signal failure *to*. Resend failures are
logged (visible in Netlify's function logs) and swallowed for the same
reason.

## Testing

No automated test suite (matches the rest of the website's static,
build-step-free approach) — verification is a real end-to-end send:
after the manual setup steps above, submit a real signup on the live
site and confirm the email actually arrives, using the address it was
sent to and the account it came from. Netlify's function logs
(Site -> Functions -> send-welcome-email) are the way to check what
happened if it doesn't.

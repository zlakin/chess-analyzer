export const handler = async (event) => {
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

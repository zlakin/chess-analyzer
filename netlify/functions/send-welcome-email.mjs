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

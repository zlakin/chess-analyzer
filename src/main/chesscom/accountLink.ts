import { randomBytes } from 'node:crypto'
import { fetchPlayerProfile } from './chessComClient'
import { saveSettings } from '../settings/settingsStore'

interface PendingChallenge {
  username: string
  code: string
}

let pendingChallenge: PendingChallenge | null = null

function generateCode(): string {
  return `CHESSANALYZER-${randomBytes(4).toString('hex').toUpperCase()}`
}

export async function startLink(username: string): Promise<{ code: string } | { error: string }> {
  try {
    const profile = await fetchPlayerProfile(username)
    const code = generateCode()
    pendingChallenge = { username: profile.username, code }
    return { code }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function verifyLink(): Promise<
  { verified: true; username: string; verifiedAt: number } | { error: string }
> {
  if (!pendingChallenge) {
    return { error: 'Start linking your account first.' }
  }

  const { username, code } = pendingChallenge

  try {
    const profile = await fetchPlayerProfile(username)
    const location = profile.location ?? ''
    if (!location.toUpperCase().includes(code)) {
      return { error: `Didn't find the code in ${username}'s profile location yet. Try again.` }
    }

    pendingChallenge = null
    const verifiedAt = Date.now()
    saveSettings({ linkedAccount: { username, verifiedAt } })
    return { verified: true, username, verifiedAt }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export function disconnectAccount(): void {
  pendingChallenge = null
  saveSettings({ linkedAccount: null })
}

// Exposed only so tests can reset module-level state between cases without
// relying on import order/caching tricks.
export function __resetPendingChallengeForTests(): void {
  pendingChallenge = null
}

import type { Players } from './players'

// Deliberately returns null rather than defaulting to a color (unlike the
// similar-looking logic in src/main/insights/extractInsightRecord.ts, which
// can safely assume the game belongs to the linked account since it comes
// from that account's own fetched history) - a pasted/uploaded PGN here may
// belong to neither the linked account nor anyone recognizable at all, and
// guessing a color would be worse than the caller's own explicit fallback.
export function resolveUserColor(players: Players, username: string | null): 'w' | 'b' | null {
  if (!username) return null
  const normalized = username.trim().toLowerCase()
  if (players.white.trim().toLowerCase() === normalized) return 'w'
  if (players.black.trim().toLowerCase() === normalized) return 'b'
  return null
}

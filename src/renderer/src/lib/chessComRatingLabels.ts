import type { ChessComPlayerStats } from '../../../shared/types'

export const RATING_LABELS: Array<{ key: keyof ChessComPlayerStats; label: string }> = [
  { key: 'rapid', label: 'Rapid' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'bullet', label: 'Bullet' },
  { key: 'daily', label: 'Daily' }
]

/** Picks one headline rating to show in compact spots (nav chip): rapid,
 * falling back through blitz/bullet/daily for players who mainly play
 * those instead. */
export function primaryRating(stats: ChessComPlayerStats | null): number | null {
  if (!stats) return null
  for (const { key } of RATING_LABELS) {
    const value = stats[key]
    if (value != null) return value
  }
  return null
}

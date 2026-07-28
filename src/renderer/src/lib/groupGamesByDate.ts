import type { ChessComGameSummary } from '../../../shared/types'

export interface GameGroup {
  label: string
  games: ChessComGameSummary[]
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(endTimeSeconds: number, now: number): string {
  const gameMs = endTimeSeconds * 1000
  const diffDays = Math.round((startOfDay(now) - startOfDay(gameMs)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Date(gameMs).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })
}

// Consecutive-run grouping, not a full re-sort by day - the list is already
// ordered newest-first, so this only ever merges truly adjacent same-day
// games, matching how a chat app's date dividers work rather than bucketing
// the whole list by calendar date regardless of position.
export function groupGamesByDate(games: ChessComGameSummary[], now: number = Date.now()): GameGroup[] {
  const groups: GameGroup[] = []
  for (const game of games) {
    const label = dayLabel(game.endTime, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.games.push(game)
    } else {
      groups.push({ label, games: [game] })
    }
  }
  return groups
}

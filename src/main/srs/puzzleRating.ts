import type { PuzzleOutcome, PuzzleStats } from '../../shared/types'

const RATING_FLOOR = 400
const STARTING_RATING = 1200

const RATING_DELTA: Record<PuzzleOutcome, { blunder: number; mistake: number }> = {
  clean: { blunder: 15, mistake: 10 },
  retried: { blunder: 8, mistake: 6 },
  hinted: { blunder: 3, mistake: 3 },
  gaveUp: { blunder: -10, mistake: -8 }
}

export function defaultPuzzleStats(): PuzzleStats {
  return {
    rating: STARTING_RATING,
    currentStreak: 0,
    longestStreak: 0,
    totalResolved: 0,
    totalCleanSolves: 0,
    solvedToday: 0,
    lastSolvedDate: ''
  }
}

export function nextRating(
  current: number,
  outcome: PuzzleOutcome,
  classification: 'mistake' | 'blunder'
): number {
  const delta = RATING_DELTA[outcome][classification]
  return Math.max(RATING_FLOOR, current + delta)
}

/**
 * The app's canonical "which day is it" key, in the user's local timezone.
 * Exported because reads normalize against it too (getPuzzleStats zeroes a
 * stale solvedToday without writing), not just the write path below.
 */
export function localDateString(now: number): string {
  const d = new Date(now)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function nextPuzzleStats(
  current: PuzzleStats,
  outcome: PuzzleOutcome,
  classification: 'mistake' | 'blunder',
  now: number
): PuzzleStats {
  const rating = nextRating(current.rating, outcome, classification)
  const totalResolved = current.totalResolved + 1
  const totalCleanSolves = current.totalCleanSolves + (outcome === 'clean' ? 1 : 0)

  if (outcome === 'gaveUp') {
    // A give-up isn't a "solve" - it breaks the streak and moves the
    // rating/totals, but deliberately leaves solvedToday/lastSolvedDate
    // untouched, since those only ever count actual solves.
    return { ...current, rating, totalResolved, totalCleanSolves, currentStreak: 0 }
  }

  const today = localDateString(now)
  const solvedToday = (current.lastSolvedDate === today ? current.solvedToday : 0) + 1
  const currentStreak = current.currentStreak + 1

  return {
    rating,
    totalResolved,
    totalCleanSolves,
    currentStreak,
    longestStreak: Math.max(current.longestStreak, currentStreak),
    solvedToday,
    lastSolvedDate: today
  }
}

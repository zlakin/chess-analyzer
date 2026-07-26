import { describe, it, expect } from 'vitest'
import { defaultPuzzleStats, nextRating, nextPuzzleStats, localDateString } from './puzzleRating'
import type { PuzzleStats } from '../../shared/types'

const DAY_1 = new Date(2026, 0, 1, 10, 0).getTime()
const DAY_1_LATER = new Date(2026, 0, 1, 20, 0).getTime()
const DAY_2 = new Date(2026, 0, 2, 9, 0).getTime()

describe('defaultPuzzleStats', () => {
  it('starts at rating 1200 with everything else zeroed', () => {
    expect(defaultPuzzleStats()).toEqual({
      rating: 1200,
      currentStreak: 0,
      longestStreak: 0,
      totalResolved: 0,
      totalCleanSolves: 0,
      solvedToday: 0,
      lastSolvedDate: ''
    })
  })
})

describe('localDateString', () => {
  it('formats a local timestamp as zero-padded YYYY-MM-DD', () => {
    expect(localDateString(DAY_1)).toBe('2026-01-01')
    expect(localDateString(new Date(2026, 10, 9, 23, 59).getTime())).toBe('2026-11-09')
  })

  it('is stable across times within the same local day, and rolls at midnight', () => {
    expect(localDateString(DAY_1)).toBe(localDateString(DAY_1_LATER))
    expect(localDateString(DAY_1)).not.toBe(localDateString(DAY_2))
  })

  it('matches the lastSolvedDate that nextPuzzleStats records', () => {
    expect(nextPuzzleStats(defaultPuzzleStats(), 'clean', 'mistake', DAY_2).lastSolvedDate).toBe(
      localDateString(DAY_2)
    )
  })
})

describe('nextRating', () => {
  it('awards the largest gain for a clean blunder solve', () => {
    expect(nextRating(1200, 'clean', 'blunder')).toBe(1215)
  })

  it('awards a smaller gain for a clean mistake solve', () => {
    expect(nextRating(1200, 'clean', 'mistake')).toBe(1210)
  })

  it('awards a moderate gain for a retried solve', () => {
    expect(nextRating(1200, 'retried', 'blunder')).toBe(1208)
    expect(nextRating(1200, 'retried', 'mistake')).toBe(1206)
  })

  it('awards the same small gain for a hinted solve regardless of classification', () => {
    expect(nextRating(1200, 'hinted', 'blunder')).toBe(1203)
    expect(nextRating(1200, 'hinted', 'mistake')).toBe(1203)
  })

  it('penalizes giving up, more for a blunder than a mistake', () => {
    expect(nextRating(1200, 'gaveUp', 'blunder')).toBe(1190)
    expect(nextRating(1200, 'gaveUp', 'mistake')).toBe(1192)
  })

  it('floors at 400', () => {
    expect(nextRating(405, 'gaveUp', 'blunder')).toBe(400)
    expect(nextRating(400, 'gaveUp', 'blunder')).toBe(400)
  })
})

describe('nextPuzzleStats', () => {
  const fresh = defaultPuzzleStats()

  it('records a clean solve: rating, streak, today count, and clean-solve count all move', () => {
    const result = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    expect(result).toEqual({
      rating: 1210,
      currentStreak: 1,
      longestStreak: 1,
      totalResolved: 1,
      totalCleanSolves: 1,
      solvedToday: 1,
      lastSolvedDate: '2026-01-01'
    })
  })

  it('accumulates solvedToday across same-day solves, resets on a new day', () => {
    let state = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'retried', 'mistake', DAY_1_LATER)
    expect(state.solvedToday).toBe(2)
    expect(state.lastSolvedDate).toBe('2026-01-01')

    state = nextPuzzleStats(state, 'hinted', 'mistake', DAY_2)
    expect(state.solvedToday).toBe(1)
    expect(state.lastSolvedDate).toBe('2026-01-02')
  })

  it('resets currentStreak to 0 on gaveUp without touching solvedToday or lastSolvedDate', () => {
    let state = nextPuzzleStats(fresh, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'gaveUp', 'blunder', DAY_1_LATER)
    expect(state.currentStreak).toBe(0)
    expect(state.solvedToday).toBe(1)
    expect(state.lastSolvedDate).toBe('2026-01-01')
    expect(state.totalResolved).toBe(2)
    expect(state.totalCleanSolves).toBe(1)
  })

  it('tracks longestStreak across a streak that later breaks', () => {
    let state: PuzzleStats = fresh
    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    expect(state.longestStreak).toBe(2)

    state = nextPuzzleStats(state, 'gaveUp', 'mistake', DAY_1)
    expect(state.currentStreak).toBe(0)
    expect(state.longestStreak).toBe(2)

    state = nextPuzzleStats(state, 'clean', 'mistake', DAY_1)
    expect(state.currentStreak).toBe(1)
    expect(state.longestStreak).toBe(2)
  })
})

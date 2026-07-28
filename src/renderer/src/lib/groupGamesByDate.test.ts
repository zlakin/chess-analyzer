import { describe, it, expect } from 'vitest'
import { groupGamesByDate } from './groupGamesByDate'
import type { ChessComGameSummary } from '../../../shared/types'

function game(endTime: number): ChessComGameSummary {
  return {
    url: `https://example.com/${endTime}`,
    pgn: '',
    endTime,
    timeControl: '600',
    white: { username: 'a', rating: 1000, result: 'win' },
    black: { username: 'b', rating: 1000, result: 'checkmated' }
  }
}

describe('groupGamesByDate', () => {
  // 2026-07-27T18:00:00Z, a Monday - fixed "now" so relative labels are deterministic.
  const now = new Date('2026-07-27T18:00:00Z').getTime()

  it('labels a game from today as "Today"', () => {
    const groups = groupGamesByDate([game(now / 1000 - 3600)], now)
    expect(groups).toEqual([{ label: 'Today', games: [expect.anything()] }])
  })

  it('labels a game from yesterday as "Yesterday"', () => {
    const groups = groupGamesByDate([game(now / 1000 - 26 * 3600)], now)
    expect(groups[0].label).toBe('Yesterday')
  })

  it('labels an older game with a weekday and date', () => {
    const groups = groupGamesByDate([game(now / 1000 - 5 * 86400)], now)
    expect(groups[0].label).toMatch(/^\w+, \w+ \d+$/)
  })

  it('groups consecutive games on the same day into one entry', () => {
    const todayA = now / 1000 - 3600
    const todayB = now / 1000 - 7200
    const groups = groupGamesByDate([game(todayA), game(todayB)], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].games).toHaveLength(2)
  })

  it('starts a new group when the day changes, even if it returns to an earlier day later', () => {
    const today = now / 1000 - 3600
    const yesterday = now / 1000 - 26 * 3600
    const groups = groupGamesByDate([game(today), game(yesterday), game(today)], now)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Today'])
  })

  it('returns an empty array for no games', () => {
    expect(groupGamesByDate([], now)).toEqual([])
  })
})

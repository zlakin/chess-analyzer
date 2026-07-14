import { describe, it, expect } from 'vitest'
import {
  categorizeTimeControl,
  resolveTimeControlCategory,
  parseClockSeconds,
  isTimePressureMove,
  baseSecondsFromTimeControl
} from './timeControl'

describe('categorizeTimeControl', () => {
  it('categorizes under 3 minutes as bullet', () => {
    expect(categorizeTimeControl('60')).toBe('bullet')
    expect(categorizeTimeControl('120+1')).toBe('bullet')
  })

  it('categorizes 3-10 minutes as blitz', () => {
    expect(categorizeTimeControl('180')).toBe('blitz')
    expect(categorizeTimeControl('300+5')).toBe('blitz')
  })

  it('categorizes 10 minutes or more as rapid', () => {
    expect(categorizeTimeControl('600')).toBe('rapid')
    expect(categorizeTimeControl('900+10')).toBe('rapid')
  })

  it('accounts for increment via an estimated 40-move game, not just the base clock', () => {
    // 30s base but a 3-minute increment plays far slower than bullet.
    expect(categorizeTimeControl('30+180')).toBe('rapid')
  })

  it('falls back to a safe default for a malformed, non-numeric time control', () => {
    expect(categorizeTimeControl('garbage')).toBe('bullet')
  })

  it('categorizes the day-based correspondence format as daily', () => {
    expect(categorizeTimeControl('1/86400')).toBe('daily')
  })
})

describe('resolveTimeControlCategory', () => {
  it('prefers a valid chess.com time_class over the raw time control heuristic', () => {
    expect(resolveTimeControlCategory('daily', '60')).toBe('daily')
  })

  it('handles a real chess.com "Play vs Coach" game: a non-numeric timeControl ("-") with time_class "daily"', () => {
    // Real production data: chess.com's own time_class correctly says
    // "daily" even though timeControl is the placeholder "-", which a raw
    // numeric parse can't categorize at all.
    expect(resolveTimeControlCategory('daily', '-')).toBe('daily')
  })

  it('falls back to the heuristic when time_class is missing', () => {
    expect(resolveTimeControlCategory(undefined, '600')).toBe('rapid')
  })

  it('falls back to the heuristic when time_class is unrecognized', () => {
    expect(resolveTimeControlCategory('some-future-category', '60')).toBe('bullet')
  })
})

describe('parseClockSeconds', () => {
  it('parses %clk comments in order into total seconds', () => {
    const pgn = '1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:55]} 2. Nf3 {[%clk 0:09:50]}'
    expect(parseClockSeconds(pgn)).toEqual([598, 595, 590])
  })

  it('returns an empty array when the PGN has no clock annotations', () => {
    expect(parseClockSeconds('1. e4 e5 2. Nf3 Nc6')).toEqual([])
  })
})

describe('isTimePressureMove', () => {
  it('is true under 10% of the starting allotment', () => {
    expect(isTimePressureMove(25, 300)).toBe(true)
  })

  it('is false at or above 10% of the starting allotment', () => {
    expect(isTimePressureMove(30, 300)).toBe(false)
  })
})

describe('baseSecondsFromTimeControl', () => {
  it('parses the base seconds, ignoring increment', () => {
    expect(baseSecondsFromTimeControl('180+2')).toBe(180)
  })

  it('returns null for the daily/correspondence format', () => {
    expect(baseSecondsFromTimeControl('1/86400')).toBeNull()
  })
})

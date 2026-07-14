import { describe, it, expect } from 'vitest'
import {
  categorizeTimeControl,
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

  it('categorizes the day-based correspondence format as daily', () => {
    expect(categorizeTimeControl('1/86400')).toBe('daily')
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

import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime()

  it('returns "just now" for timestamps under a minute old', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now')
  })

  it('formats minutes for timestamps under an hour old', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago')
  })

  it('formats hours for timestamps under a day old', () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1 hour ago')
  })

  it('formats days for timestamps a day or more old', () => {
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 days ago')
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('1 day ago')
  })
})

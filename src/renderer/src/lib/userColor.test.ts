import { describe, it, expect } from 'vitest'
import { resolveUserColor } from './userColor'

const players = { white: 'zlakin', black: 'opponent123', whiteElo: null, blackElo: null }

describe('resolveUserColor', () => {
  it('returns "w" when the username matches the white player, case-insensitively', () => {
    expect(resolveUserColor(players, 'ZLakin')).toBe('w')
  })

  it('returns "b" when the username matches the black player', () => {
    expect(resolveUserColor(players, 'opponent123')).toBe('b')
  })

  it('returns null when the username matches neither player', () => {
    expect(resolveUserColor(players, 'someone_else')).toBeNull()
  })

  it('returns null when no username is known (no linked account)', () => {
    expect(resolveUserColor(players, null)).toBeNull()
  })

  it('trims surrounding whitespace before comparing', () => {
    expect(
      resolveUserColor(
        { white: ' zlakin ', black: 'opponent123', whiteElo: null, blackElo: null },
        'zlakin'
      )
    ).toBe('w')
  })
})

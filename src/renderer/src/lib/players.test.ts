import { describe, it, expect } from 'vitest'
import { parsePlayers } from './players'

const BASE_PGN = `[Event "Live Chess"]
[White "zlakin"]
[Black "opponent123"]
[WhiteElo "1450"]
[BlackElo "1502"]

1. e4 e5 2. Nf3 Nc6 *`

describe('parsePlayers', () => {
  it('extracts both usernames and both Elo ratings when present', () => {
    expect(parsePlayers(BASE_PGN)).toEqual({
      white: 'zlakin',
      black: 'opponent123',
      whiteElo: '1450',
      blackElo: '1502'
    })
  })

  it('falls back to "White"/"Black" when the name tags are absent', () => {
    const pgn = '1. e4 e5 *'
    expect(parsePlayers(pgn).white).toBe('White')
    expect(parsePlayers(pgn).black).toBe('Black')
  })

  it('returns null Elo values when the Elo tags are absent', () => {
    const pgn = '[White "a"]\n[Black "b"]\n\n1. e4 e5 *'
    expect(parsePlayers(pgn).whiteElo).toBeNull()
    expect(parsePlayers(pgn).blackElo).toBeNull()
  })
})

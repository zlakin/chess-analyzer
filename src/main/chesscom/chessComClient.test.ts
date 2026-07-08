import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRecentGames, ChessComFetchError } from './chessComClient'

describe('fetchRecentGames', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns games from the most recent archive, newest first', async () => {
    const archivesResponse = {
      archives: [
        'https://api.chess.com/pub/player/testuser/games/2026/06',
        'https://api.chess.com/pub/player/testuser/games/2026/07'
      ]
    }
    const gamesResponse = {
      games: [
        {
          url: 'https://www.chess.com/game/live/1',
          pgn: '1. e4 e5',
          end_time: 1000,
          time_control: '600',
          white: { username: 'testuser', rating: 1500, result: 'win' },
          black: { username: 'opponent', rating: 1490, result: 'checkmated' }
        },
        {
          url: 'https://www.chess.com/game/live/2',
          pgn: '1. d4 d5',
          end_time: 2000,
          time_control: '600',
          white: { username: 'opponent2', rating: 1600, result: 'win' },
          black: { username: 'testuser', rating: 1500, result: 'resigned' }
        }
      ]
    }

    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().endsWith('/archives')) {
        return new Response(JSON.stringify(archivesResponse), { status: 200 })
      }
      // Only return games for the most recent archive (2026/07)
      if (url.includes('2026/07')) {
        return new Response(JSON.stringify(gamesResponse), { status: 200 })
      }
      // Return empty games for other archives
      return new Response(JSON.stringify({ games: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const games = await fetchRecentGames('testuser', 10)

    expect(games).toHaveLength(2)
    expect(games[0].url).toBe('https://www.chess.com/game/live/2')
    expect(games[1].url).toBe('https://www.chess.com/game/live/1')
  })

  it('throws ChessComFetchError when the user does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))

    await expect(fetchRecentGames('nobody')).rejects.toThrow(ChessComFetchError)
  })

  it('throws ChessComFetchError for an empty username', async () => {
    await expect(fetchRecentGames('   ')).rejects.toThrow(ChessComFetchError)
  })
})

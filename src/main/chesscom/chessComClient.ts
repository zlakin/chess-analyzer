import type { ChessComGameSummary } from '../../shared/types'

const USER_AGENT = 'chess-analyzer (personal, non-commercial use)'

export class ChessComFetchError extends Error {}

interface ChessComArchivesResponse {
  archives: string[]
}

interface ChessComGamesResponse {
  games: Array<{
    url: string
    pgn?: string
    end_time: number
    time_control: string
    white: { username: string; rating: number; result: string }
    black: { username: string; rating: number; result: string }
  }>
}

async function fetchJson<T>(url: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    throw new ChessComFetchError(`Network error contacting chess.com: ${(err as Error).message}`)
  }
  if (response.status === 404) {
    throw new ChessComFetchError('Chess.com user not found')
  }
  if (response.status === 429) {
    throw new ChessComFetchError('Chess.com rate-limited this request. Try again in a moment.')
  }
  if (!response.ok) {
    throw new ChessComFetchError(`Chess.com request failed: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}

export async function fetchRecentGames(
  username: string,
  limit = 20
): Promise<ChessComGameSummary[]> {
  const trimmedUsername = username.trim().toLowerCase()
  if (trimmedUsername.length === 0) {
    throw new ChessComFetchError('Enter a chess.com username')
  }

  const { archives } = await fetchJson<ChessComArchivesResponse>(
    `https://api.chess.com/pub/player/${trimmedUsername}/games/archives`
  )

  if (archives.length === 0) {
    throw new ChessComFetchError(`${username} has no games on chess.com`)
  }

  const games: ChessComGameSummary[] = []
  for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
    const { games: monthGames } = await fetchJson<ChessComGamesResponse>(archives[i])
    for (const game of [...monthGames].reverse()) {
      if (!game.pgn) continue
      games.push({
        url: game.url,
        pgn: game.pgn,
        endTime: game.end_time,
        timeControl: game.time_control,
        white: game.white,
        black: game.black
      })
      if (games.length >= limit) break
    }
  }

  return games
}

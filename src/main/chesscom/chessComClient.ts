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
    time_class?: string
    white: { username: string; rating: number; result: string }
    black: { username: string; rating: number; result: string }
  }>
}

async function doFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  } catch (err) {
    throw new ChessComFetchError(`Network error contacting chess.com: ${(err as Error).message}`)
  }
}

function throwForErrorStatus(response: Response): never {
  if (response.status === 404) {
    throw new ChessComFetchError('Chess.com user not found')
  }
  if (response.status === 429) {
    throw new ChessComFetchError('Chess.com rate-limited this request. Try again in a moment.')
  }
  throw new ChessComFetchError(`Chess.com request failed: ${response.status} ${response.statusText}`)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await doFetch(url)
  if (!response.ok) throwForErrorStatus(response)
  return response.json() as Promise<T>
}

// The chess.com Published-Data API includes the current (and sometimes an
// upcoming) month in a player's `archives` list before any games have been
// recorded for it, and fetching that month's games endpoint then returns a
// plain 404 -- indistinguishable, by status code alone, from the archives
// endpoint's own "player does not exist" 404. That does NOT mean the player
// is missing, just that they have no games that month yet, so it must be
// treated as an empty result and skipped rather than surfaced as a fatal
// "user not found" error.
async function fetchMonthGamesOrEmpty(url: string): Promise<ChessComGamesResponse['games']> {
  const response = await doFetch(url)
  if (response.status === 404) return []
  if (!response.ok) throwForErrorStatus(response)
  const body = (await response.json()) as ChessComGamesResponse
  return body.games
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
    const monthGames = await fetchMonthGamesOrEmpty(archives[i])
    for (const game of [...monthGames].reverse()) {
      if (!game.pgn) continue
      games.push({
        url: game.url,
        pgn: game.pgn,
        endTime: game.end_time,
        timeControl: game.time_control,
        timeClass: game.time_class,
        white: game.white,
        black: game.black
      })
      if (games.length >= limit) break
    }
  }

  return games
}

export interface ChessComPlayerProfile {
  username: string
  location: string | null
}

export async function fetchPlayerProfile(username: string): Promise<ChessComPlayerProfile> {
  const trimmedUsername = username.trim().toLowerCase()
  if (trimmedUsername.length === 0) {
    throw new ChessComFetchError('Enter a chess.com username')
  }

  const profile = await fetchJson<{ username: string; location?: string }>(
    `https://api.chess.com/pub/player/${trimmedUsername}`
  )

  return { username: profile.username, location: profile.location ?? null }
}

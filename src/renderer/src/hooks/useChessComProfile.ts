import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChessComGameSummary, ChessComPlayerStats, LinkedAccount } from '../../../shared/types'
import { resolvePrefillUsername } from '../lib/resolvePrefillUsername'

export interface ChessComProfileState {
  linkedAccount: LinkedAccount | null
  username: string
  games: ChessComGameSummary[]
  stats: ChessComPlayerStats | null
  isFetching: boolean
  error: string | null
  isManualSearch: boolean
}

const INITIAL_STATE: ChessComProfileState = {
  linkedAccount: null,
  username: '',
  games: [],
  stats: null,
  isFetching: false,
  error: null,
  isManualSearch: false
}

export function useChessComProfile(): {
  state: ChessComProfileState
  setUsername: (username: string) => void
  findGames: () => void
  openManualSearch: () => void
  showMyProfile: () => void
} {
  const [state, setState] = useState<ChessComProfileState>(INITIAL_STATE)
  const hasAutoLoadedRef = useRef(false)

  const fetchFor = useCallback(async (username: string) => {
    const trimmed = username.trim()
    if (trimmed.length === 0) {
      setState((prev) => ({ ...prev, error: 'Enter a chess.com username' }))
      return
    }
    setState((prev) => ({ ...prev, isFetching: true, error: null }))
    const [gamesResult, statsResult] = await Promise.all([
      window.chessAPI.fetchChessComGames(trimmed),
      window.chessAPI.fetchChessComStats(trimmed)
    ])
    setState((prev) => ({
      ...prev,
      isFetching: false,
      games: 'error' in gamesResult ? [] : gamesResult,
      stats: 'error' in statsResult ? null : statsResult,
      error: 'error' in gamesResult ? gamesResult.error : null
    }))
  }, [])

  // Verified accounts skip the manual prompt entirely: the profile loads
  // itself. This guard runs the auto-load exactly once per mount so it
  // can't refire and clobber an in-progress manual search triggered before
  // settings resolve.
  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => {
      const linkedAccount = settings.linkedAccount
      setState((prev) => ({
        ...prev,
        linkedAccount,
        username: resolvePrefillUsername(prev.username, linkedAccount?.username ?? null)
      }))
      if (linkedAccount?.verifiedAt && !hasAutoLoadedRef.current) {
        hasAutoLoadedRef.current = true
        void fetchFor(linkedAccount.username)
      }
    })
  }, [fetchFor])

  const setUsername = useCallback((username: string) => {
    setState((prev) => ({ ...prev, username }))
  }, [])

  const findGames = useCallback(() => {
    setState((prev) => {
      void fetchFor(prev.username)
      return prev
    })
  }, [fetchFor])

  const openManualSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isManualSearch: true,
      username: '',
      games: [],
      stats: null,
      error: null
    }))
  }, [])

  const showMyProfile = useCallback(() => {
    setState((prev) => {
      const username = prev.linkedAccount?.username ?? ''
      if (username) void fetchFor(username)
      return { ...prev, isManualSearch: false, username }
    })
  }, [fetchFor])

  return { state, setUsername, findGames, openManualSearch, showMyProfile }
}

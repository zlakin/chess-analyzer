import { useEffect, useState } from 'react'
import type { ChessComGameSummary } from '../../../shared/types'
import { resolvePrefillUsername } from '../lib/resolvePrefillUsername'
import { resultBadge } from '../lib/chessComResult'

interface ImportModalProps {
  onGameLoaded: (pgn: string) => void
}

type ImportTab = 'paste' | 'upload' | 'chesscom'

export function ImportModal({ onGameLoaded }: ImportModalProps): JSX.Element {
  const [tab, setTab] = useState<ImportTab>('paste')
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [chessComGames, setChessComGames] = useState<ChessComGameSummary[]>([])
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => {
      setUsername((current) =>
        resolvePrefillUsername(current, settings.linkedAccount?.username ?? null)
      )
    })
  }, [])

  const handlePasteSubmit = (): void => {
    if (pasteText.trim().length === 0) {
      setError('Paste some PGN text first')
      return
    }
    setError(null)
    onGameLoaded(pasteText)
  }

  const handleUpload = async (): Promise<void> => {
    setError(null)
    const result = await window.chessAPI.openPgnFile()
    if ('error' in result) {
      setError(result.error)
    } else if (!('cancelled' in result)) {
      onGameLoaded(result.pgn)
    }
  }

  const handleFindGames = async (): Promise<void> => {
    const trimmedUsername = username.trim()
    if (trimmedUsername.length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsFetching(true)
    setChessComGames([])
    const result = await window.chessAPI.fetchChessComGames(trimmedUsername)
    setIsFetching(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setChessComGames(result)
    }
  }

  return (
    <div className="import-modal">
      <div className="import-tabs segmented-control">
        <button
          className={`segmented-control-option${tab === 'paste' ? ' active' : ''}`}
          onClick={() => setTab('paste')}
        >
          Paste PGN
        </button>
        <button
          className={`segmented-control-option${tab === 'upload' ? ' active' : ''}`}
          onClick={() => setTab('upload')}
        >
          Upload File
        </button>
        <button
          className={`segmented-control-option${tab === 'chesscom' ? ' active' : ''}`}
          onClick={() => setTab('chesscom')}
        >
          Chess.com
        </button>
      </div>

      {error && <div className="import-error">{error}</div>}

      {tab === 'paste' && (
        <div className="import-panel">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste PGN text here"
            rows={10}
          />
          <button className="button-primary" onClick={handlePasteSubmit}>
            Load Game
          </button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="import-panel">
          <button className="button-primary" onClick={handleUpload}>
            Choose .pgn File...
          </button>
        </div>
      )}

      {tab === 'chesscom' && (
        <div className="import-panel">
          <div className="chesscom-search">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="chess.com username"
              onKeyDown={(e) => e.key === 'Enter' && handleFindGames()}
            />
            <button className="button-primary" onClick={handleFindGames} disabled={isFetching}>
              {isFetching ? 'Searching...' : 'Find Games'}
            </button>
          </div>
          <ul className="chesscom-game-list">
            {chessComGames.map((game) => {
              const badge = resultBadge(game)
              return (
                <li key={game.url}>
                  <button className="chesscom-game-card" onClick={() => onGameLoaded(game.pgn)}>
                    <span className="chesscom-game-players">
                      <span className="chesscom-game-player">
                        {game.white.username}{' '}
                        <span className="chesscom-game-rating">({game.white.rating})</span>
                      </span>
                      <span className={`chesscom-game-result ${badge.outcome}`}>
                        {badge.text}
                      </span>
                      <span className="chesscom-game-player">
                        {game.black.username}{' '}
                        <span className="chesscom-game-rating">({game.black.rating})</span>
                      </span>
                    </span>
                    <span className="chesscom-game-date">
                      {new Date(game.endTime * 1000).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { ChessComGameSummary } from '../../../shared/types'
import { resolvePrefillUsername } from '../lib/resolvePrefillUsername'

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
      setUsername((current) => resolvePrefillUsername(current, settings.chessComUsername))
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
      void window.chessAPI.setChessComUsername(trimmedUsername)
    }
  }

  return (
    <div className="import-modal">
      <div className="import-tabs">
        <button className={tab === 'paste' ? 'active' : ''} onClick={() => setTab('paste')}>
          Paste PGN
        </button>
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          Upload File
        </button>
        <button className={tab === 'chesscom' ? 'active' : ''} onClick={() => setTab('chesscom')}>
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
          <button onClick={handlePasteSubmit}>Load Game</button>
        </div>
      )}

      {tab === 'upload' && (
        <div className="import-panel">
          <button onClick={handleUpload}>Choose .pgn File...</button>
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
            <button onClick={handleFindGames} disabled={isFetching}>
              {isFetching ? 'Searching...' : 'Find Games'}
            </button>
          </div>
          <ul className="chesscom-game-list">
            {chessComGames.map((game) => (
              <li key={game.url}>
                <button onClick={() => onGameLoaded(game.pgn)}>
                  {game.white.username} ({game.white.rating}) vs {game.black.username} (
                  {game.black.rating}) &mdash; {new Date(game.endTime * 1000).toLocaleDateString()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

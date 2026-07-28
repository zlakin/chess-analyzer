import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { useChessComProfile } from '../hooks/useChessComProfile'
import { resultBadge } from '../lib/chessComResult'
import { RATING_LABELS } from '../lib/chessComRatingLabels'
import { groupGamesByDate } from '../lib/groupGamesByDate'

interface ImportModalProps {
  onGameLoaded: (pgn: string) => void
}

type ImportTab = 'paste' | 'upload' | 'chesscom'

export function ImportModal({ onGameLoaded }: ImportModalProps): JSX.Element {
  const [tab, setTab] = useState<ImportTab>('paste')
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const chessCom = useChessComProfile()

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

  const activeError = tab === 'chesscom' ? chessCom.state.error : error

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

      {activeError && <div className="import-error">{activeError}</div>}

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
          {chessCom.state.linkedAccount?.verifiedAt && !chessCom.state.isManualSearch ? (
            <div className="chesscom-profile">
              <div className="chesscom-profile-identity">
                <BadgeCheck size={16} className="chesscom-verified-icon" />
                <span className="chesscom-profile-username">
                  {chessCom.state.linkedAccount.username}
                </span>
                {chessCom.state.stats && (
                  <span className="chesscom-profile-ratings">
                    {RATING_LABELS.filter(({ key }) => chessCom.state.stats?.[key] != null).map(
                      ({ key, label }) => (
                        <span key={key} className="chesscom-rating-badge">
                          {label} <strong>{chessCom.state.stats?.[key]}</strong>
                        </span>
                      )
                    )}
                  </span>
                )}
              </div>
              <button className="button-secondary" onClick={chessCom.openManualSearch}>
                Search another player
              </button>
            </div>
          ) : (
            <div className="chesscom-search">
              <input
                value={chessCom.state.username}
                onChange={(e) => chessCom.setUsername(e.target.value)}
                placeholder="chess.com username"
                onKeyDown={(e) => e.key === 'Enter' && chessCom.findGames()}
              />
              <button
                className="button-primary"
                onClick={chessCom.findGames}
                disabled={chessCom.state.isFetching}
              >
                {chessCom.state.isFetching ? 'Searching...' : 'Find Games'}
              </button>
              {chessCom.state.linkedAccount?.verifiedAt && (
                <button className="button-secondary" onClick={chessCom.showMyProfile}>
                  Back to my profile
                </button>
              )}
            </div>
          )}
          {chessCom.state.isFetching && chessCom.state.games.length === 0 && (
            <p className="chesscom-loading">Loading games...</p>
          )}
          {groupGamesByDate(chessCom.state.games).map((group) => (
            <div key={`${group.label}-${group.games[0].url}`} className="chesscom-game-group">
              <h4 className="insights-subheading">{group.label}</h4>
              <ul className="chesscom-game-list">
                {group.games.map((game) => {
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
                          {new Date(game.endTime * 1000).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

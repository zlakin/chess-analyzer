import { useEffect, useState } from 'react'
import type { LinkedAccount, PuzzleStats } from '../../../shared/types'

interface ConnectAccountModalProps {
  linkedAccount: LinkedAccount | null
  // Already fetched at the App level (useInsightsScan loads its report on
  // mount regardless of which tab is active) - passed down rather than
  // re-fetched, since a full insights-report call is heavier than this
  // modal needs just to show one count.
  gamesScanned: number | null
  onClose: () => void
  onLinked: (account: LinkedAccount) => void
  onDisconnected: () => void
}

type Step = 'status' | 'enter-username' | 'awaiting-code'

export function ConnectAccountModal({
  linkedAccount,
  gamesScanned,
  onClose,
  onLinked,
  onDisconnected
}: ConnectAccountModalProps): JSX.Element {
  const [step, setStep] = useState<Step>(linkedAccount ? 'status' : 'enter-username')
  const [username, setUsername] = useState(linkedAccount?.username ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [puzzleStats, setPuzzleStats] = useState<PuzzleStats | null>(null)

  // Fetched here rather than lifted to App.tsx: this modal is opened rarely,
  // so there's no benefit to keeping puzzle stats warm at the top level for
  // the whole app's lifetime just for this one occasional view.
  useEffect(() => {
    window.chessAPI.getPuzzleStats().then(setPuzzleStats)
  }, [])

  const startLinkFor = async (targetUsername: string): Promise<void> => {
    const trimmed = targetUsername.trim()
    if (trimmed.length === 0) {
      setError('Enter a chess.com username')
      return
    }
    setError(null)
    setIsBusy(true)
    const result = await window.chessAPI.startAccountLink(trimmed)
    setIsBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setUsername(trimmed)
    setCode(result.code)
    setStep('awaiting-code')
  }

  const handleVerify = async (): Promise<void> => {
    setError(null)
    setIsBusy(true)
    const result = await window.chessAPI.verifyAccountLink()
    setIsBusy(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onLinked({ username: result.username, verifiedAt: result.verifiedAt })
  }

  const handleDisconnect = async (): Promise<void> => {
    await window.chessAPI.disconnectAccount()
    onDisconnected()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="connect-account-modal" onClick={(e) => e.stopPropagation()}>
        {error && <div className="import-error">{error}</div>}

        {step === 'status' && linkedAccount && (
          <>
            <p>
              Connected as <strong>{linkedAccount.username}</strong>
              {linkedAccount.verifiedAt ? ' — Verified' : ' — Unverified'}
            </p>
            {puzzleStats && (
              <div className="puzzle-stats-bar">
                <div className="puzzle-stat-tile">
                  <span className="puzzle-stat-value">{gamesScanned ?? 0}</span>
                  <span className="puzzle-stat-label">Games analyzed</span>
                </div>
                <div className="puzzle-stat-tile">
                  <span className="puzzle-stat-value">{puzzleStats.totalResolved}</span>
                  <span className="puzzle-stat-label">Puzzles solved</span>
                </div>
                <div className="puzzle-stat-tile" title={`Best: ${puzzleStats.longestStreak}`}>
                  <span className="puzzle-stat-value">{puzzleStats.currentStreak}</span>
                  <span className="puzzle-stat-label">Solve streak</span>
                </div>
              </div>
            )}
            <div className="modal-actions">
              {!linkedAccount.verifiedAt && (
                <button className="button-primary" onClick={() => void startLinkFor(linkedAccount.username)} disabled={isBusy}>
                  Verify it&apos;s you
                </button>
              )}
              <button className="button-secondary" onClick={() => void handleDisconnect()} disabled={isBusy}>
                Disconnect
              </button>
              <button className="button-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {step === 'enter-username' && (
          <>
            <p>Connect your chess.com account</p>
            <div className="chesscom-search">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="chess.com username"
                onKeyDown={(e) => e.key === 'Enter' && void startLinkFor(username)}
              />
              <button className="button-primary" onClick={() => void startLinkFor(username)} disabled={isBusy}>
                {isBusy ? 'Checking...' : 'Start'}
              </button>
            </div>
            <div className="modal-actions">
              <button className="button-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === 'awaiting-code' && (
          <>
            <p>
              Paste this code into your chess.com profile&apos;s <strong>Location</strong> field,
              save it there, then verify:
            </p>
            <code className="verification-code">{code}</code>
            <div className="modal-actions">
              <button className="button-secondary" onClick={() => void window.chessAPI.openChessComProfileSettings()}>
                Open chess.com profile
              </button>
              <button className="button-primary" onClick={() => void handleVerify()} disabled={isBusy}>
                {isBusy ? 'Checking...' : "I've pasted it — Verify"}
              </button>
              <button className="button-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

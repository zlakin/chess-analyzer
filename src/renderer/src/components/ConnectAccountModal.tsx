import { useState } from 'react'
import type { LinkedAccount } from '../../../shared/types'

interface ConnectAccountModalProps {
  linkedAccount: LinkedAccount | null
  onClose: () => void
  onLinked: (account: LinkedAccount) => void
  onDisconnected: () => void
}

type Step = 'status' | 'enter-username' | 'awaiting-code'

export function ConnectAccountModal({
  linkedAccount,
  onClose,
  onLinked,
  onDisconnected
}: ConnectAccountModalProps): JSX.Element {
  const [step, setStep] = useState<Step>(linkedAccount ? 'status' : 'enter-username')
  const [username, setUsername] = useState(linkedAccount?.username ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

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

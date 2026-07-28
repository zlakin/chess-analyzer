import { useState } from 'react'
import type { MistakeAttemptResult } from '../hooks/useMistakeAttempt'
import { useMistakeAttempt } from '../hooks/useMistakeAttempt'
import { tryMove } from '../lib/tryMove'
import { Board } from './Board'
import type { MistakeDetail } from '../../../shared/types'
import { TACTIC_LABELS } from '../lib/tacticLabels'

interface MistakeCoachModalProps {
  detail: MistakeDetail
  onClose: () => void
}

export function MistakeCoachModal({ detail, onClose }: MistakeCoachModalProps): JSX.Element {
  const { hintUsed, attempt, requestHint, giveUp } = useMistakeAttempt(detail)
  const [attemptFen, setAttemptFen] = useState<string | null>(null)
  const [result, setResult] = useState<MistakeAttemptResult | { error: string } | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const [isGrading, setIsGrading] = useState(false)

  const isCorrect = result !== null && 'correct' in result && result.correct
  const resolved = isCorrect || gaveUp
  const hintSquare = hintUsed && !resolved ? detail.bestMoveUci.slice(0, 2) : null
  // Same dedup as RecentMistakesList's displayTags() - a mistake can
  // legitimately carry the same tag in both arrays, and two identical chips
  // would read as a rendering glitch rather than one distinct fact.
  const tags = Array.from(new Set([...detail.missedTactics, ...detail.punishedByTactics]))

  const handleMove = (from: string, to: string): boolean => {
    if (result !== null || gaveUp || isGrading) return false

    const fenAfterAttempt = tryMove(detail.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setAttemptFen(fenAfterAttempt)
    setIsGrading(true)
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setResult(r)
    })
    return true
  }

  const handleRetry = (): void => {
    setAttemptFen(null)
    setResult(null)
  }

  const handleGiveUp = (): void => {
    if (isGrading) return
    giveUp()
    setGaveUp(true)
    setResult(null)
    setAttemptFen(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="mistake-coach-modal" onClick={(e) => e.stopPropagation()}>
        <div className="recent-mistake-tags">
          {tags.length === 0 ? (
            <span className="recent-mistake-tag">Positional</span>
          ) : (
            tags.map((tag) => (
              <span key={tag} className="recent-mistake-tag">
                {TACTIC_LABELS[tag]}
              </span>
            ))
          )}
        </div>
        <Board
          fen={result === null && attemptFen !== null ? attemptFen : detail.fenBefore}
          bestMoveUci={resolved ? detail.bestMoveUci : null}
          currentMove={null}
          boardOrientation={detail.userColor === 'w' ? 'white' : 'black'}
          onMove={handleMove}
          hintSquare={hintSquare}
        />
        {result !== null && 'error' in result && (
          <div className="puzzle-feedback puzzle-feedback-incorrect">
            <span>{result.error}</span>
            <button className="button-secondary" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}
        {result !== null && 'correct' in result && !result.correct && (
          <div className="puzzle-feedback puzzle-feedback-incorrect">
            <span>Not quite — try again.</span>
            <button className="button-secondary" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}
        {result !== null && 'correct' in result && result.correct && (
          <div className="puzzle-feedback puzzle-feedback-correct">
            <span>Correct!</span>
          </div>
        )}
        {gaveUp && (
          <div className="puzzle-feedback puzzle-feedback-incorrect">
            <span>Here's the move you missed.</span>
          </div>
        )}
        {!resolved && (
          <div className="puzzle-hint-controls">
            <button className="button-secondary" onClick={requestHint} disabled={isGrading || hintUsed}>
              {hintUsed ? 'Hint used' : 'Hint'}
            </button>
            <button className="button-secondary" onClick={handleGiveUp} disabled={isGrading || !hintUsed}>
              Can't solve
            </button>
          </div>
        )}
        {isGrading && <p className="puzzle-status-panel">Grading…</p>}
        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

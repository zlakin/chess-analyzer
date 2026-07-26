import { useEffect, useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { TACTIC_LABELS } from '../lib/tacticLabels'
import { Board } from './Board'
import type { TacticType } from '../../../shared/types'

function tacticTags(missed: TacticType[], punished: TacticType[]): TacticType[] {
  return Array.from(new Set([...missed, ...punished]))
}

export function PuzzlesTab(): JSX.Element {
  const { queue, nextDueAt, currentCard, attempt, next, isLoading } = usePuzzleSession()
  const [attemptFen, setAttemptFen] = useState<string | null>(null)
  const [result, setResult] = useState<PuzzleAttemptResult | { error: string } | null>(null)
  const [isGrading, setIsGrading] = useState(false)

  // A new card (via next(), or the very first card loading in) starts
  // clean - any leftover attempt/result/grading state described a
  // *previous* card and would otherwise leak into this one.
  useEffect(() => {
    setAttemptFen(null)
    setResult(null)
    setIsGrading(false)
  }, [currentCard?.cardId])

  if (isLoading) return <div className="puzzles-tab" />

  if (!currentCard) {
    return (
      <div className="puzzles-tab">
        <p className="puzzle-empty-message">
          {nextDueAt === null
            ? 'Run an Insights scan to build your practice queue.'
            : `You're all caught up — next review due ${new Date(nextDueAt).toLocaleDateString()}.`}
        </p>
      </div>
    )
  }

  const handleMove = (from: string, to: string): boolean => {
    if (result !== null) return false // already graded this card, waiting on Next

    const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setAttemptFen(fenAfterAttempt)
    setIsGrading(true)
    // attempt() re-derives the same resulting FEN internally (it needs to
    // evaluate that position, not just know it) - recomputing tryMove
    // there is cheap and keeps the hook self-contained rather than
    // threading this component's already-computed FEN through its
    // signature.
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setResult(r)
    })
    return true
  }

  const tags = tacticTags(currentCard.missedTactics, currentCard.punishedByTactics)

  return (
    <div className="puzzles-tab">
      <div className="analysis-layout">
        <div className="board-column">
          <Board
            fen={attemptFen ?? currentCard.fenBefore}
            bestMoveUci={result !== null && 'correct' in result ? currentCard.bestMoveUci : null}
            currentMove={null}
            boardOrientation={currentCard.userColor === 'w' ? 'white' : 'black'}
            onMove={handleMove}
          />
          {result !== null && 'error' in result && <div className="import-error">{result.error}</div>}
          {result !== null && 'correct' in result && (
            <div className={`puzzle-feedback ${result.correct ? 'puzzle-feedback-correct' : 'puzzle-feedback-incorrect'}`}>
              <span>{result.correct ? 'Correct!' : 'Not quite.'}</span>
              <button className="button-secondary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {isGrading && <p className="puzzle-status-panel">Grading…</p>}
        </div>
        <div className="side-panel">
          <p className="puzzle-status-panel">
            {queue.length} puzzle{queue.length === 1 ? '' : 's'} due
          </p>
          {tags.length > 0 && (
            <div className="tactic-chip-row">
              {tags.map((tag) => (
                <span key={tag} className="tactic-chip">
                  {TACTIC_LABELS[tag]}
                </span>
              ))}
            </div>
          )}
          <p className="puzzle-status-panel">
            {`vs ${currentCard.opponentUsername} · ${new Date(currentCard.endTime * 1000).toLocaleDateString()}`}
          </p>
        </div>
      </div>
    </div>
  )
}

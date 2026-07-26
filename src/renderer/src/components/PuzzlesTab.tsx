import { useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { TACTIC_LABELS } from '../lib/tacticLabels'
import { Board } from './Board'
import type { TacticType } from '../../../shared/types'

function tacticTags(missed: TacticType[], punished: TacticType[]): TacticType[] {
  return Array.from(new Set([...missed, ...punished]))
}

interface TaggedAttempt {
  cardId: string
  fen: string
}

interface TaggedResult {
  cardId: string
  result: PuzzleAttemptResult | { error: string }
}

export function PuzzlesTab(): JSX.Element {
  const { queue, nextDueAt, currentCard, attempt, next, isLoading } = usePuzzleSession()
  const [taggedAttempt, setTaggedAttempt] = useState<TaggedAttempt | null>(null)
  const [taggedResult, setTaggedResult] = useState<TaggedResult | null>(null)
  const [isGrading, setIsGrading] = useState(false)

  // Tagging each value with the cardId it belongs to, and only ever
  // reading it back when that tag matches the *current* card, means a
  // stale attempt/result from a just-abandoned card can never render -
  // structurally, not just via a same-tick effect racing the paint.
  const attemptFen =
    taggedAttempt && taggedAttempt.cardId === currentCard?.cardId ? taggedAttempt.fen : null
  const result =
    taggedResult && taggedResult.cardId === currentCard?.cardId ? taggedResult.result : null

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
    if (result !== null) return false // already graded this card, waiting on Retry/Next

    const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
    if (!fenAfterAttempt) return false

    setTaggedAttempt({ cardId: currentCard.cardId, fen: fenAfterAttempt })
    setIsGrading(true)
    void attempt(from, to).then((r) => {
      setIsGrading(false)
      setTaggedResult({ cardId: currentCard.cardId, result: r })
    })
    return true
  }

  const handleRetry = (): void => {
    setTaggedAttempt(null)
    setTaggedResult(null)
  }

  const tags = tacticTags(currentCard.missedTactics, currentCard.punishedByTactics)
  const graded = result !== null && 'correct' in result

  return (
    <div className="puzzles-tab">
      <div className="analysis-layout">
        <div className="board-column">
          <Board
            // While grading (or ungraded), show wherever the attempt
            // landed. Once a verdict exists, revert to fenBefore -
            // bestMoveUci describes a move IN fenBefore, one ply earlier
            // than wherever the attempt ended up, so the reveal arrow
            // below is only ever correct against fenBefore.
            fen={result === null && attemptFen !== null ? attemptFen : currentCard.fenBefore}
            bestMoveUci={graded ? currentCard.bestMoveUci : null}
            currentMove={null}
            boardOrientation={currentCard.userColor === 'w' ? 'white' : 'black'}
            onMove={handleMove}
          />
          {result !== null && 'error' in result && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>{result.error}</span>
              <button className="button-secondary" onClick={handleRetry}>
                Retry
              </button>
              <button className="button-secondary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {graded && result !== null && 'correct' in result && (
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

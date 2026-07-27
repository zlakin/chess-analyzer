import { useState } from 'react'
import type { PuzzleAttemptResult } from '../hooks/usePuzzleSession'
import { usePuzzleSession } from '../hooks/usePuzzleSession'
import { tryMove } from '../lib/tryMove'
import { Board } from './Board'
import type { MasteryNodeKey } from '../../../shared/types'

interface TaggedAttempt {
  cardId: string
  fen: string
}

interface TaggedResult {
  cardId: string
  result: PuzzleAttemptResult | { error: string }
}

interface PuzzleSessionViewProps {
  nodeKey: MasteryNodeKey
  onBack: () => void
}

export function PuzzleSessionView({ nodeKey, onBack }: PuzzleSessionViewProps): JSX.Element {
  const {
    queue,
    currentCard,
    sessionTotal,
    stats,
    nodeProgress,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  } = usePuzzleSession(nodeKey)
  const [taggedAttempt, setTaggedAttempt] = useState<TaggedAttempt | null>(null)
  const [taggedResult, setTaggedResult] = useState<TaggedResult | null>(null)
  const [taggedGaveUp, setTaggedGaveUp] = useState<string | null>(null)
  const [isGrading, setIsGrading] = useState(false)

  // Tagging each value with the cardId it belongs to, and only ever
  // reading it back when that tag matches the *current* card, means a
  // stale attempt/result from a just-abandoned card can never render -
  // structurally, not just via a same-tick effect racing the paint.
  const attemptFen =
    taggedAttempt && taggedAttempt.cardId === currentCard?.cardId ? taggedAttempt.fen : null
  const result =
    taggedResult && taggedResult.cardId === currentCard?.cardId ? taggedResult.result : null
  const gaveUp = taggedGaveUp === currentCard?.cardId

  const backButton = (
    <button className="button-secondary puzzle-session-back" onClick={onBack}>
      ← Back to tree
    </button>
  )

  if (isLoading) {
    return (
      <div className="puzzles-tab">
        {backButton}
      </div>
    )
  }

  if (!currentCard) {
    return (
      <div className="puzzles-tab">
        {backButton}
        <p className="puzzle-empty-message">No puzzles available for this node right now.</p>
      </div>
    )
  }

  const isCorrect = result !== null && 'correct' in result && result.correct
  const resolved = isCorrect || gaveUp
  const hintSquare = hintUsed && !resolved ? currentCard.bestMoveUci.slice(0, 2) : null
  const position = sessionTotal - queue.length + 1
  const accuracyLabel =
    stats && stats.totalResolved > 0
      ? `${Math.round((stats.totalCleanSolves / stats.totalResolved) * 100)}%`
      : '—'

  const handleMove = (from: string, to: string): boolean => {
    // Already resolved, waiting on Retry, or still awaiting the engine on a
    // previous move - a second concurrent attempt() would race the first.
    if (result !== null || gaveUp || isGrading) return false

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

  const handleGiveUp = (): void => {
    // Mirrors the button's own disabled condition, so taggedGaveUp can't
    // flip on a click the hook itself would have no-opped. (giveUp() also
    // no-ops when !hintUsed, which the button already gates.)
    if (!currentCard || isGrading) return
    giveUp()
    setTaggedGaveUp(currentCard.cardId)
    // The reveal is the whole story now - clear any wrong-attempt feedback
    // so two contradictory panels can't render at once.
    setTaggedResult(null)
    setTaggedAttempt(null)
  }

  return (
    <div className="puzzles-tab">
      {backButton}
      {stats && (
        <div className="puzzle-stats-bar">
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.rating}</span>
            <span className="puzzle-stat-label">Rating</span>
          </div>
          <div className="puzzle-stat-tile" title={`Best: ${stats.longestStreak}`}>
            <span className="puzzle-stat-value">{stats.currentStreak}</span>
            <span className="puzzle-stat-label">Solve streak</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.solvedToday}</span>
            <span className="puzzle-stat-label">Solved today</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{accuracyLabel}</span>
            <span className="puzzle-stat-label">Accuracy</span>
          </div>
        </div>
      )}
      {nodeProgress && (
        <p className="puzzle-status-panel">
          {nodeProgress.mastered ? 'Node mastered!' : `Mastery streak: ${nodeProgress.cleanStreak}/5`}
        </p>
      )}
      <p className="puzzle-status-panel">{`Puzzle ${position} of ${sessionTotal}`}</p>
      <div className="analysis-layout">
        <div className="board-column">
          <Board
            // While grading (or ungraded), show wherever the attempt
            // landed. Once a verdict exists, revert to fenBefore -
            // bestMoveUci describes a move IN fenBefore, one ply earlier
            // than wherever the attempt ended up, so the reveal arrow
            // below is only ever correct against fenBefore.
            fen={result === null && attemptFen !== null ? attemptFen : currentCard.fenBefore}
            bestMoveUci={resolved ? currentCard.bestMoveUci : null}
            currentMove={null}
            boardOrientation={currentCard.userColor === 'w' ? 'white' : 'black'}
            onMove={handleMove}
            hintSquare={hintSquare}
          />
          {result !== null && 'error' in result && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>{result.error}</span>
              <button className="button-secondary" onClick={handleRetry}>
                Retry
              </button>
              {/* An error is an illegal move or an engine failure, not a real
                  attempt - nothing was graded and no review or outcome was
                  recorded - so skipping past it doesn't undermine the rule
                  that giving up requires a hint first. Without Next, a
                  persistently failing engine leaves the card unskippable. */}
              <button className="button-primary" onClick={next}>
                Next
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
              <button className="button-primary" onClick={next}>
                Next
              </button>
            </div>
          )}
          {gaveUp && (
            <div className="puzzle-feedback puzzle-feedback-incorrect">
              <span>Here's the move you missed.</span>
              <button className="button-primary" onClick={next}>
                Next
              </button>
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
        </div>
        <div className="side-panel">
          <p className="puzzle-status-panel">
            {currentCard.gameUrl !== null && currentCard.opponentUsername !== null && currentCard.endTime !== null
              ? `vs ${currentCard.opponentUsername} · ${new Date(currentCard.endTime * 1000).toLocaleDateString()}`
              : 'From the practice library'}
          </p>
        </div>
      </div>
    </div>
  )
}

import type { PositionEvaluation } from '../../../shared/types'
import { whiteWinPercent, formatScore } from '../lib/displayEval'

interface ExploringBannerProps {
  evaluation: PositionEvaluation | null
  isEvaluating: boolean
  sideToMove: 'w' | 'b'
  canUndo: boolean
  onUndo: () => void
  onExit: () => void
}

export function ExploringBanner({
  evaluation,
  isEvaluating,
  sideToMove,
  canUndo,
  onUndo,
  onExit
}: ExploringBannerProps): JSX.Element {
  const scoreText = evaluation ? formatScore(evaluation, sideToMove) : null

  return (
    <div className="exploring-banner">
      <span className="exploring-banner-label">Exploring a variation</span>
      <span className="exploring-banner-eval">
        {isEvaluating && !evaluation ? '…' : (scoreText ?? '')}
      </span>
      <button className="button-secondary" onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>
      <button className="button-secondary" onClick={onExit}>
        Back to game
      </button>
    </div>
  )
}

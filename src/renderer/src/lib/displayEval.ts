import type { PositionEvaluation } from '../../../shared/types'
import { effectiveCp, cpToWinPercent } from '../../../shared/engineMath'

export function whiteWinPercent(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): number {
  const cpFromSideToMove = effectiveCp(evaluation.lines[0])
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  return cpToWinPercent(cpFromWhite)
}

export function formatScore(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): string {
  const topLine = evaluation.lines[0]
  if (topLine.scoreMate !== null) {
    const mateFromWhite = sideToMove === 'w' ? topLine.scoreMate : -topLine.scoreMate
    return mateFromWhite > 0 ? `M${mateFromWhite}` : `-M${Math.abs(mateFromWhite)}`
  }
  const cpFromSideToMove = topLine.scoreCp ?? 0
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  const pawns = cpFromWhite / 100
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2)
}

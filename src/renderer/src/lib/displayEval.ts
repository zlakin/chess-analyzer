import type { PositionEvaluation } from '../../../shared/types'
import { effectiveCp, cpToWinPercent } from '../../../shared/engineMath'

export function whiteWinPercent(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): number {
  // Defense-in-depth: evaluatePosition() always synthesizes at least one
  // line, even for a terminal position, but guard here too so a missing
  // line never crashes the eval graph -- fall back to a neutral 50/50.
  const topLine = evaluation.lines[0]
  const cpFromSideToMove = topLine ? effectiveCp(topLine) : 0
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  return cpToWinPercent(cpFromWhite)
}

export function formatScore(evaluation: PositionEvaluation, sideToMove: 'w' | 'b'): string {
  const topLine = evaluation.lines[0]
  if (!topLine) return '+0.00'
  if (topLine.scoreMate !== null) {
    const mateFromWhite = sideToMove === 'w' ? topLine.scoreMate : -topLine.scoreMate
    return mateFromWhite > 0 ? `M${mateFromWhite}` : `-M${Math.abs(mateFromWhite)}`
  }
  const cpFromSideToMove = topLine.scoreCp ?? 0
  const cpFromWhite = sideToMove === 'w' ? cpFromSideToMove : -cpFromSideToMove
  const pawns = cpFromWhite / 100
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2)
}

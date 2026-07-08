import { cpToWinPercent } from '../../shared/engineMath'
import type { MoveEvalDelta } from '../../shared/engineMath'

export function moveAccuracy(delta: MoveEvalDelta): number {
  const winPercentBefore = cpToWinPercent(delta.evalBeforeMoverCp)
  const winPercentAfter = cpToWinPercent(delta.evalAfterMoverCp)
  const drop = Math.max(0, winPercentBefore - winPercentAfter)
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669
  return Math.min(100, Math.max(0, raw))
}

export function gameAccuracy(accuracies: number[]): number {
  if (accuracies.length === 0) return 100
  const sum = accuracies.reduce((total, value) => total + value, 0)
  return sum / accuracies.length
}

import type { EngineLine, PositionEvaluation } from './types'

const MATE_SCORE_BASE = 100000
const MATE_SCORE_STEP = 100

export function effectiveCp(line: EngineLine): number {
  if (line.scoreMate !== null) {
    const sign = line.scoreMate > 0 ? 1 : -1
    return sign * (MATE_SCORE_BASE - Math.abs(line.scoreMate) * MATE_SCORE_STEP)
  }
  return line.scoreCp ?? 0
}

export function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export interface MoveEvalDelta {
  cpLoss: number
  evalBeforeMoverCp: number
  evalAfterMoverCp: number
  secondBestMoverCp: number | null
  isBestMove: boolean
}

export function computeMoveEvalDelta(
  evalBefore: PositionEvaluation,
  evalAfter: PositionEvaluation,
  playedMoveUci: string
): MoveEvalDelta {
  const bestLineBefore = evalBefore.lines[0]
  const secondLineBefore = evalBefore.lines[1] ?? null
  const bestLineAfter = evalAfter.lines[0]

  const evalBeforeMoverCp = effectiveCp(bestLineBefore)
  const evalAfterMoverCp = -effectiveCp(bestLineAfter)
  const secondBestMoverCp = secondLineBefore ? effectiveCp(secondLineBefore) : null

  const isBestMove = bestLineBefore.moveUci === playedMoveUci

  return {
    cpLoss: isBestMove ? 0 : Math.max(0, evalBeforeMoverCp - evalAfterMoverCp),
    evalBeforeMoverCp,
    evalAfterMoverCp,
    secondBestMoverCp,
    isBestMove
  }
}

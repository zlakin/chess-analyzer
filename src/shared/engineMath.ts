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

// A mate score is a certainty, not an amount of material. Running it through
// cpToWinPercent's logistic curve via effectiveCp's +/-100000 ramp makes
// "mate in 3" and "mate in 8" look 500 centipawns apart, which then reads as
// a blunder. Saturating instead makes any two mating lines identical, which
// is what they are: both won.
export function winPercent(line: EngineLine): number {
  if (line.scoreMate !== null) return line.scoreMate > 0 ? 100 : 0
  return cpToWinPercent(line.scoreCp ?? 0)
}

// A move whose win probability is indistinguishable from the engine's top
// choice is best, even when Stockfish happened to name a different move --
// exact UCI equality demotes a genuine tie to "excellent".
export const BEST_MOVE_WIN_PERCENT_TOLERANCE = 0.2

export interface MoveEvalDelta {
  cpLoss: number
  winPercentLoss: number
  evalBeforeMoverCp: number
  evalAfterMoverCp: number
  secondBestMoverCp: number | null
  isBestMove: boolean
}

// Defense-in-depth fallback for an empty `lines` array. evaluatePosition()
// should never actually return one (it synthesizes a terminal EngineLine
// for checkmate/stalemate positions), but this keeps computeMoveEvalDelta
// from throwing if some future engine implementation or fixture ever does.
const FALLBACK_LINE: EngineLine = { depth: 0, scoreCp: 0, scoreMate: null, moveUci: '', pv: [] }

export function computeMoveEvalDelta(
  evalBefore: PositionEvaluation,
  evalAfter: PositionEvaluation,
  playedMoveUci: string
): MoveEvalDelta {
  const bestLineBefore = evalBefore.lines[0] ?? FALLBACK_LINE
  const secondLineBefore = evalBefore.lines[1] ?? null
  const bestLineAfter = evalAfter.lines[0] ?? FALLBACK_LINE

  const evalBeforeMoverCp = effectiveCp(bestLineBefore)
  const evalAfterMoverCp = -effectiveCp(bestLineAfter)
  const secondBestMoverCp = secondLineBefore ? effectiveCp(secondLineBefore) : null

  const winPercentBefore = winPercent(bestLineBefore)
  const winPercentAfter = 100 - winPercent(bestLineAfter)
  const rawWinPercentLoss = Math.max(0, winPercentBefore - winPercentAfter)

  // The tolerance is only meaningful when evalBefore actually produced a
  // line. With an empty `lines` array the fallback puts both sides at 0,
  // making the raw loss 0 and every move look best -- so require a real
  // line before letting the tolerance widen isBestMove.
  const hasBeforeLine = evalBefore.lines.length > 0
  const isBestMove =
    bestLineBefore.moveUci === playedMoveUci ||
    (hasBeforeLine && rawWinPercentLoss <= BEST_MOVE_WIN_PERCENT_TOLERANCE)

  return {
    cpLoss: isBestMove ? 0 : Math.max(0, evalBeforeMoverCp - evalAfterMoverCp),
    winPercentLoss: isBestMove ? 0 : rawWinPercentLoss,
    evalBeforeMoverCp,
    evalAfterMoverCp,
    secondBestMoverCp,
    isBestMove
  }
}

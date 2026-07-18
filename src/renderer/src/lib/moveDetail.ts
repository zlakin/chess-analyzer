import { Chess } from 'chess.js'
import type { AnalyzedMove } from '../../../shared/types'
import { computeMoveEvalDelta, cpToWinPercent } from '../../../shared/engineMath'
import { MOVE_CLASSIFICATION_STYLE } from './moveClassificationStyle'

export function sanForUci(fen: string, uci: string): string | null {
  const chess = new Chess(fen)
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promotion = uci.length > 4 ? uci.slice(4) : undefined
  try {
    const result = chess.move({ from, to, promotion })
    return result.san
  } catch {
    return null
  }
}

export function formatMoveDetail(move: AnalyzedMove | null): string | null {
  if (!move || move.classification === 'book') return null

  const delta = computeMoveEvalDelta(move.evalBefore, move.evalAfter, move.moveUci)
  const winBefore = cpToWinPercent(delta.evalBeforeMoverCp)
  const winAfter = cpToWinPercent(delta.evalAfterMoverCp)
  const winDelta = winAfter - winBefore
  const sign = winDelta >= 0 ? '+' : ''
  const label = MOVE_CLASSIFICATION_STYLE[move.classification].label

  let text = `${move.san} — ${label}, ${sign}${winDelta.toFixed(0)}% win chance.`

  if (!delta.isBestMove) {
    const bestUci = move.evalBefore.lines[0]?.moveUci
    const bestSan = bestUci ? sanForUci(move.fenBefore, bestUci) : null
    if (bestSan) text += ` Best was ${bestSan}.`
  }

  return text
}

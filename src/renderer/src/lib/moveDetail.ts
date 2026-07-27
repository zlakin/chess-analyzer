import { Chess } from 'chess.js'
import type { AnalyzedMove, TacticType } from '../../../shared/types'
import { computeMoveEvalDelta, cpToWinPercent } from '../../../shared/engineMath'
import { detectTactics } from '../../../shared/analysis/tacticDetector'
import { MOVE_CLASSIFICATION_STYLE } from './moveClassificationStyle'

// Phrases specific to this "Best was X (...)" coaching sentence - every
// entry must read correctly as "what the recommended move achieves".
// Deliberately separate from TACTIC_LABELS (tacticLabels.ts), whose noun
// labels ("Hung piece") read backwards here: "Best was Rxd1 (hung piece)"
// sounds like the recommended move hangs a piece, when it actually means
// the recommended move captures an undefended one.
export const MISSED_TACTIC_PHRASES: Record<TacticType, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discovered_attack: 'discovered attack',
  back_rank_mate: 'back-rank mate',
  hung_piece: 'wins a hanging piece'
}

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
    if (bestSan) {
      const isMistakeOrBlunder = move.classification === 'mistake' || move.classification === 'blunder'
      const tactics = isMistakeOrBlunder && bestUci ? detectTactics(move.fenBefore, bestUci) : []
      const tacticSuffix =
        tactics.length > 0 ? ` (${tactics.map((t) => MISSED_TACTIC_PHRASES[t]).join(', ')})` : ''
      text += ` Best was ${bestSan}${tacticSuffix}.`
    }
  }

  return text
}

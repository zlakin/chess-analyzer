import { Chess } from 'chess.js'
import type { EngineLine } from '../../shared/types'

function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined
  }
}

// One-ply lookahead, not a full static-exchange evaluation: checks whether
// the opponent's top engine line is a capture that the blundering side has
// no legal recapture for. This deliberately doesn't account for deeper
// tactics (e.g. a recapture that itself loses more material) -- it's a
// coarse "did you just hang a piece for free" signal, not a full SEE.
export function isHungPieceBlunder(
  fenAfterBlunder: string,
  opponentBestLine: EngineLine | undefined
): boolean {
  if (!opponentBestLine || opponentBestLine.pv.length === 0) return false

  const chess = new Chess(fenAfterBlunder)
  const replyMove = uciToMove(opponentBestLine.pv[0])

  let moveResult
  try {
    moveResult = chess.move(replyMove)
  } catch {
    return false
  }
  if (!moveResult?.captured) return false

  const canRecapture = chess.moves({ verbose: true }).some((m) => m.to === replyMove.to && m.captured)

  return !canRecapture
}

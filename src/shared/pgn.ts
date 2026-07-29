import { Chess } from 'chess.js'
import type { AnalyzedPosition } from './types'
import { staticExchangeEval } from './analysis/see'

export class PgnParseError extends Error {}

// Also used by tacticDetector.ts's hung-piece detection, independent of the
// SEE-based sacrifice signal below.
export const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function parsePgn(pgn: string): AnalyzedPosition[] {
  const chess = new Chess()

  try {
    chess.loadPgn(pgn)
  } catch (err) {
    throw new PgnParseError(err instanceof Error ? err.message : 'Invalid PGN')
  }

  const moves = chess.history({ verbose: true })
  if (moves.length === 0) {
    throw new PgnParseError('PGN contains no moves')
  }

  return moves.map((move, index) => {
    const beforePosition = new Chess(move.before)

    return {
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      color: move.color,
      san: move.san,
      moveUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore: move.before,
      fenAfter: move.after,
      seeCp: staticExchangeEval(move.before, move.from, move.to),
      isCapture: move.captured !== undefined,
      legalMoveCount: beforePosition.moves().length
    }
  })
}

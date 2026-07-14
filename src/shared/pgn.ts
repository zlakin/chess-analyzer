import { Chess } from 'chess.js'
import type { AnalyzedPosition } from './types'

export class PgnParseError extends Error {}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

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
    const ply = index + 1
    const moveNumber = Math.floor(index / 2) + 1
    const opponentColor = move.color === 'w' ? 'b' : 'w'
    const capturedValue = move.captured ? PIECE_VALUES[move.captured] : 0
    const movedValue = PIECE_VALUES[move.piece]
    const afterPosition = new Chess(move.after)
    const isPotentialSacrifice =
      capturedValue < movedValue && afterPosition.isAttacked(move.to, opponentColor)

    return {
      ply,
      moveNumber,
      color: move.color,
      san: move.san,
      moveUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore: move.before,
      fenAfter: move.after,
      isPotentialSacrifice
    }
  })
}

import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface PositionAtPly {
  fen: string
  evaluation: PositionEvaluation | null
  sideToMove: 'w' | 'b'
  bestMoveUci: string | null
}

export function getPositionAtPly(moves: AnalyzedMove[], ply: number): PositionAtPly {
  if (ply <= 0 || moves.length === 0) {
    const first = moves[0]
    return {
      fen: first ? first.fenBefore : STARTING_FEN,
      evaluation: first ? first.evalBefore : null,
      sideToMove: 'w',
      bestMoveUci: first ? first.evalBefore.lines[0]?.moveUci ?? null : null
    }
  }
  const move = moves[Math.min(ply, moves.length) - 1]
  const sideToMove = move.color === 'w' ? 'b' : 'w'
  return {
    fen: move.fenAfter,
    evaluation: move.evalAfter,
    sideToMove,
    bestMoveUci: move.evalAfter.lines[0]?.moveUci ?? null
  }
}

export function getMoveAtPly(moves: AnalyzedMove[], ply: number): AnalyzedMove | null {
  if (ply <= 0 || moves.length === 0) return null
  return moves[Math.min(ply, moves.length) - 1]
}

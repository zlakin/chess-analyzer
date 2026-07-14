import { Chess } from 'chess.js'
import type { GamePhase } from '../../shared/types'

const OPENING_PLY_CEILING = 20
// Roughly "a rook plus one minor piece" combined value, per side -- below
// this, a side has too little material left for the position to still be
// considered a middlegame.
const ENDGAME_MATERIAL_CEILING = 8

const PIECE_VALUES: Record<string, number> = { p: 0, n: 3, b: 3, r: 5, q: 9, k: 0 }

function nonPawnMaterial(fen: string, color: 'w' | 'b'): number {
  const board = new Chess(fen).board()
  let total = 0
  for (const row of board) {
    for (const square of row) {
      if (square && square.color === color) {
        total += PIECE_VALUES[square.type]
      }
    }
  }
  return total
}

export function gamePhaseAt(fenAfter: string, ply: number): GamePhase {
  if (ply < OPENING_PLY_CEILING) return 'opening'

  const whiteMaterial = nonPawnMaterial(fenAfter, 'w')
  const blackMaterial = nonPawnMaterial(fenAfter, 'b')
  const isEndgame =
    whiteMaterial <= ENDGAME_MATERIAL_CEILING && blackMaterial <= ENDGAME_MATERIAL_CEILING

  return isEndgame ? 'endgame' : 'middlegame'
}

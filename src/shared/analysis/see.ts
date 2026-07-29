import { Chess } from 'chess.js'
import type { Color, PieceSymbol, Square } from 'chess.js'

export const SEE_PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
}

function opposite(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

// chess.js's attackers() is geometric: it ignores whose turn it is and
// reports attackers of a square even when that square is occupied. Re-
// querying it after each simulated capture is what makes x-ray attackers
// (a rook behind a rook) resolve correctly without tracking them by hand.
function leastValuableAttacker(
  board: Chess,
  target: Square,
  color: Color
): { square: Square; type: PieceSymbol } | null {
  let best: { square: Square; type: PieceSymbol } | null = null
  for (const square of board.attackers(target, color)) {
    const piece = board.get(square)
    if (!piece) continue
    if (best === null || SEE_PIECE_VALUES[piece.type] < SEE_PIECE_VALUES[best.type]) {
      best = { square, type: piece.type }
    }
  }
  return best
}

/**
 * Static exchange evaluation: the centipawn balance for the side making
 * `from`->`to`, assuming both sides keep recapturing on `to` with their
 * least valuable attacker and either may stop when continuing would lose
 * material.
 *
 * Returns 0 for a quiet move to a square nobody contests, a positive number
 * for a favourable exchange, and a negative number for a real sacrifice.
 */
export function staticExchangeEval(fen: string, from: Square, to: Square): number {
  const board = new Chess(fen)
  const mover = board.get(from)
  if (!mover) return 0

  const side = mover.color
  const target = board.get(to)

  // An en passant capture takes a pawn that is NOT standing on the
  // destination square -- it is on the mover's own rank, in the
  // destination's file.
  const isEnPassant = mover.type === 'p' && target === undefined && from[0] !== to[0]
  const capturedValue = target
    ? SEE_PIECE_VALUES[target.type]
    : isEnPassant
      ? SEE_PIECE_VALUES.p
      : 0

  const promotes = mover.type === 'p' && (to[1] === '8' || to[1] === '1')
  const promotionGain = promotes ? SEE_PIECE_VALUES.q - SEE_PIECE_VALUES.p : 0

  const gains: number[] = [capturedValue + promotionGain]

  if (isEnPassant) board.remove(`${to[0]}${from[1]}` as Square)
  board.remove(from)
  board.remove(to)
  const arrivingType: PieceSymbol = promotes ? 'q' : mover.type
  board.put({ type: arrivingType, color: side }, to)

  // Value of whatever currently stands on `to` -- i.e. what the next
  // capturer would win.
  let onSquare = SEE_PIECE_VALUES[arrivingType]
  let turn = opposite(side)
  let depth = 0

  for (;;) {
    const attacker = leastValuableAttacker(board, to, turn)
    if (attacker === null) break

    // A king may only capture on `to` when the other side has nothing left
    // defending it -- otherwise the recapture is illegal and must not count
    // as a defence. A piece never attacks the square it stands on, so the
    // piece currently occupying `to` does not defend itself here.
    if (attacker.type === 'k' && leastValuableAttacker(board, to, opposite(turn)) !== null) break

    depth += 1
    gains[depth] = onSquare - gains[depth - 1]

    board.remove(attacker.square)
    board.remove(to)
    board.put({ type: attacker.type, color: turn }, to)
    onSquare = SEE_PIECE_VALUES[attacker.type]
    turn = opposite(turn)
  }

  // Walk the swap list backwards: at each point the side to move can decline
  // the recapture, so it takes the better of "stop here" and "capture".
  for (let d = depth; d > 0; d--) {
    gains[d - 1] = -Math.max(-gains[d - 1], gains[d])
  }

  // -Math.max(...) produces JS's negative zero whenever declining every
  // recapture is exactly as good as taking (e.g. an even trade). -0 is
  // mathematically 0, but `Object.is(-0, 0)` is false, so callers doing
  // strict equality against 0 would see a sign bit that means nothing here.
  return gains[0] === 0 ? 0 : gains[0]
}

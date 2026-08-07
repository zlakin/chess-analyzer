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

// A pawn arriving on the far rank does not stay a pawn: the step is worth
// the promoted piece minus the pawn, and the square is then held by the
// promoted piece for whoever recaptures next. Returns null when the move is
// not a promotion, so callers can use one code path for both cases.
//
// `chosen` is only known for the move actually being evaluated -- the caller
// has it from chess.js's `move.promotion`. Recaptures deeper in the swap-off
// are hypothetical, and a side recapturing into promotion would take the
// queen, so 'q' is the right assumption there.
function promotedType(
  pieceType: PieceSymbol,
  to: Square,
  chosen?: PieceSymbol
): PieceSymbol | null {
  if (pieceType !== 'p') return null
  if (to[1] !== '8' && to[1] !== '1') return null
  return chosen ?? 'q'
}

/**
 * Static exchange evaluation: the centipawn balance for the side making
 * `from`->`to`, assuming both sides keep recapturing on `to` with their
 * least valuable attacker and either may stop when continuing would lose
 * material.
 *
 * Returns 0 for a quiet move to a square nobody contests, a positive number
 * for a favourable exchange, and a negative number for a real sacrifice.
 *
 * `promotion` is the piece a promoting pawn actually becomes. Pass it
 * whenever it is known: an underpromotion is precisely the case where the
 * mover deliberately takes less material, so assuming a queen would hide
 * the sacrifice this function exists to find.
 */
export function staticExchangeEval(
  fen: string,
  from: Square,
  to: Square,
  promotion?: PieceSymbol
): number {
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

  const promotesTo = promotedType(mover.type, to, promotion)
  const promotionGain = promotesTo ? SEE_PIECE_VALUES[promotesTo] - SEE_PIECE_VALUES.p : 0

  const gains: number[] = [capturedValue + promotionGain]

  if (isEnPassant) board.remove(`${to[0]}${from[1]}` as Square)
  board.remove(from)
  board.remove(to)
  const arrivingType: PieceSymbol = promotesTo ?? mover.type
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
    //
    // This is the ONLY legality rule the swap-off applies. leastValuableAttacker
    // is otherwise purely geometric, so a pinned defender -- or any other
    // recapture that would be illegal in the real position -- is still counted
    // as if it could take. That is the textbook limitation of static exchange
    // evaluation, not an oversight: e.g. on '7k/6p1/8/8/8/8/1B1Q4/4K3 w - - 0 1'
    // Qd2-h6 scores -900 because the g7 pawn is treated as a recapturer even
    // though it is pinned to h8 by the b2 bishop. Full legality checking is a
    // real design change in a hot path, so do not read the king carve-out as
    // general legality handling.
    if (attacker.type === 'k' && leastValuableAttacker(board, to, opposite(turn)) !== null) break

    // A recapturing pawn reaching the far rank promotes just as the initial
    // move can: it wins the extra material for this step, and the next
    // capturer takes the promoted piece rather than a pawn.
    const recaptureType = promotedType(attacker.type, to) ?? attacker.type
    const recapturePromotionGain =
      SEE_PIECE_VALUES[recaptureType] - SEE_PIECE_VALUES[attacker.type]

    depth += 1
    gains[depth] = onSquare + recapturePromotionGain - gains[depth - 1]

    board.remove(attacker.square)
    board.remove(to)
    board.put({ type: recaptureType, color: turn }, to)
    onSquare = SEE_PIECE_VALUES[recaptureType]
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

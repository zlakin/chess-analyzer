import { Chess } from 'chess.js'
import type { Color, Move, PieceSymbol, Square } from 'chess.js'
import { PIECE_VALUES } from '../../shared/pgn'
import type { TacticType } from '../../shared/types'

const SIGNIFICANT_VALUE = 3 // knight/bishop or greater

function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined
  }
}

function opponentOf(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function isSlider(type: PieceSymbol): boolean {
  return type === 'b' || type === 'r' || type === 'q'
}

function pieceValue(type: PieceSymbol): number {
  return PIECE_VALUES[type]
}

const ROOK_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]
const BISHOP_DIRECTIONS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
]

function directionsFor(type: PieceSymbol): Array<[number, number]> {
  if (type === 'r') return ROOK_DIRECTIONS
  if (type === 'b') return BISHOP_DIRECTIONS
  return [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS] // queen
}

function fileRank(square: Square): [number, number] {
  return ['abcdefgh'.indexOf(square[0]), Number(square[1]) - 1]
}

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
  return `${'abcdefgh'[file]}${rank + 1}` as Square
}

// Reuses the same "opponent's top reply is a capture the mover can't
// recapture" idea the old isHungPieceBlunder used, generalized to run on
// any move rather than only an engine PV's first move.
function detectHungPiece(chess: Chess, move: Move): boolean {
  if (!move.captured) return false
  const canRecapture = chess.moves({ verbose: true }).some((m) => m.to === move.to && m.captured)
  return !canRecapture
}

function detectFork(chess: Chess, moverColor: Color, toSquare: Square): boolean {
  const enemy = opponentOf(moverColor)
  const attackedTypes: PieceSymbol[] = []

  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy) continue
      if (chess.attackers(cell.square, moverColor).includes(toSquare)) {
        attackedTypes.push(cell.type)
      }
    }
  }

  if (attackedTypes.length < 2) return false
  if (attackedTypes.includes('k')) return true
  return attackedTypes.filter((type) => pieceValue(type) >= SIGNIFICANT_VALUE).length >= 2
}

// Walks each sliding direction from the moved piece's square. The first
// enemy piece hit is the "near" piece; if another enemy piece (or the
// king) sits directly behind it on the same ray, near < far in value is a
// pin (near piece can't move without exposing the more valuable one),
// near >= far is a skewer (near piece -- possibly the king itself, in
// check -- must move, exposing what's behind it).
function detectPinsAndSkewers(chess: Chess, moverColor: Color, toSquare: Square): TacticType[] {
  const piece = chess.get(toSquare)
  if (!piece || !isSlider(piece.type)) return []

  const enemy = opponentOf(moverColor)
  const [file, rank] = fileRank(toSquare)
  const results: TacticType[] = []

  for (const [df, dr] of directionsFor(piece.type)) {
    let f = file + df
    let r = rank + dr
    let near: { type: PieceSymbol } | null = null

    while (true) {
      const square = squareAt(f, r)
      if (!square) break
      const occupant = chess.get(square)

      if (occupant) {
        if (!near) {
          if (occupant.color !== enemy) break
          near = { type: occupant.type }
        } else {
          if (occupant.color !== enemy) break
          const nearValue = near.type === 'k' ? Infinity : pieceValue(near.type)
          const farValue = occupant.type === 'k' ? Infinity : pieceValue(occupant.type)
          results.push(nearValue < farValue ? 'pin' : 'skewer')
          break
        }
      }

      f += df
      r += dr
    }
  }

  return results
}

// Compares, for every significant enemy piece and the enemy king, which
// of the mover's pieces attack it before vs. after the move. A square
// that gains an attacker other than the moved piece itself is a
// discovered attack -- the moved piece was blocking that line before.
function detectDiscoveredAttack(fenBefore: string, chess: Chess, moverColor: Color, toSquare: Square): boolean {
  const before = new Chess(fenBefore)
  const enemy = opponentOf(moverColor)

  const targets: Square[] = []
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === enemy && (cell.type === 'k' || pieceValue(cell.type) >= SIGNIFICANT_VALUE)) {
        targets.push(cell.square)
      }
    }
  }

  for (const target of targets) {
    const beforeAttackers = new Set(before.attackers(target, moverColor))
    for (const attackerSquare of chess.attackers(target, moverColor)) {
      if (attackerSquare === toSquare) continue
      if (!beforeAttackers.has(attackerSquare)) return true
    }
  }

  return false
}

function detectBackRankMate(chess: Chess, move: Move): boolean {
  const enemyColor = opponentOf(move.color)
  const homeRank = enemyColor === 'w' ? '1' : '8'

  const kingCell = chess
    .board()
    .flat()
    .find((cell) => cell?.type === 'k' && cell.color === enemyColor)
  if (!kingCell || kingCell.square[1] !== homeRank) return false
  if (move.to[1] !== homeRank) return false

  const forwardDelta = enemyColor === 'w' ? 1 : -1
  const [kingFile, kingRank] = fileRank(kingCell.square)

  for (const df of [-1, 0, 1]) {
    const square = squareAt(kingFile + df, kingRank + forwardDelta)
    if (!square) continue
    const occupant = chess.get(square)
    if (!occupant || occupant.color !== enemyColor || occupant.type !== 'p') return false
  }

  return true
}

// Every check below runs on the position after `moveUci` is played from
// `fenBefore` -- each is a heuristic pattern match (same spirit as the
// hung-piece check's original "not full SEE" comment), not a formal
// tactics solver. A single move can match more than one tag.
export function detectTactics(fenBefore: string, moveUci: string): TacticType[] {
  const chess = new Chess(fenBefore)

  let move: Move
  try {
    move = chess.move(uciToMove(moveUci))
  } catch {
    return []
  }

  const tactics = new Set<TacticType>()

  if (detectHungPiece(chess, move)) tactics.add('hung_piece')
  if (detectFork(chess, move.color, move.to)) tactics.add('fork')
  for (const tag of detectPinsAndSkewers(chess, move.color, move.to)) tactics.add(tag)
  if (detectDiscoveredAttack(fenBefore, chess, move.color, move.to)) tactics.add('discovered_attack')
  if (chess.isCheckmate() && detectBackRankMate(chess, move)) tactics.add('back_rank_mate')

  return Array.from(tactics)
}

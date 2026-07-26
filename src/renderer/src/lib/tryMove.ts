import { Chess } from 'chess.js'

export function tryMove(fen: string, from: string, to: string): string | null {
  const chess = new Chess(fen)
  try {
    const move = chess.move({ from, to, promotion: 'q' })
    return move ? chess.fen() : null
  } catch {
    return null
  }
}

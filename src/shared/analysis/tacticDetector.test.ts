import { describe, it, expect } from 'vitest'
import { detectTactics } from './tacticDetector'

describe('detectTactics', () => {
  it('detects a knight fork on a queen and a rook', () => {
    // White knight d3 -> e5 forks the queen on c6 and the rook on g6.
    const fen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'd3e5')).toEqual(['fork'])
  })

  it('detects a bishop pin of a knight against the king', () => {
    // White bishop a4 -> b5 pins the knight on c6 to the king on e8
    // (b5-c6-d7-e8 is one diagonal, d7 empty).
    const fen = '4k3/8/2n5/8/B7/8/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'a4b5')).toEqual(['pin'])
  })

  it('detects a rook skewer of a king in front of a rook', () => {
    // White rook a1 -> e1 checks the king on e5; the black rook on e8
    // is directly behind it on the e-file with nothing in between.
    const fen = '4r3/8/8/4k3/8/8/8/R6K w - - 0 1'
    expect(detectTactics(fen, 'a1e1')).toEqual(['skewer'])
  })

  it('detects a discovered check', () => {
    // White knight d4 -> f5 uncovers the queen on d1's attack on the
    // king on d8 along the previously-blocked d-file.
    const fen = '3k4/8/8/8/3N4/8/8/3Q1K2 w - - 0 1'
    expect(detectTactics(fen, 'd4f5')).toEqual(['discovered_attack'])
  })

  it('detects a back-rank checkmate', () => {
    // White rook e1 -> e8 mates the king on g8, boxed in by its own
    // pawns on f7/g7/h7.
    const fen = '6k1/5ppp/8/8/8/8/8/4RK2 w - - 0 1'
    expect(detectTactics(fen, 'e1e8')).toEqual(['back_rank_mate'])
  })

  it('detects a hung piece (capture with no legal recapture)', () => {
    // White knight g5 captures the pawn on f7; the black king on a8 is
    // much too far away to recapture, and it's the only other black piece.
    const fen = 'k7/5p2/8/6N1/8/8/8/4K3 w - - 0 1'
    expect(detectTactics(fen, 'g5f7')).toEqual(['hung_piece'])
  })

  it('returns an empty array for a quiet developing move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    expect(detectTactics(fen, 'g1f3')).toEqual([])
  })

  it('returns multiple tags when one move matches more than one pattern', () => {
    // Same fork position as above, but with an undefended black pawn on
    // e5 -- Nxe5 both captures a hung pawn AND still forks c6/g6.
    const fen = '4k3/8/2q3r1/4p3/8/3N4/8/4K3 w - - 0 1'
    const tags = detectTactics(fen, 'd3e5')
    expect(tags).toContain('fork')
    expect(tags).toContain('hung_piece')
    expect(tags).toHaveLength(2)
  })

  it('returns an empty array for an illegal move rather than throwing', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    expect(detectTactics(fen, 'a1a8')).toEqual([])
  })
})

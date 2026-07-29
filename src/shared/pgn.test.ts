import { describe, it, expect } from 'vitest'
import { parsePgn, PgnParseError } from './pgn'

const SAMPLE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`

describe('parsePgn', () => {
  it('returns one position per ply, in order', () => {
    const positions = parsePgn(SAMPLE_PGN)
    expect(positions).toHaveLength(10)
    expect(positions[0]).toMatchObject({ ply: 1, moveNumber: 1, color: 'w', san: 'e4' })
    expect(positions[9]).toMatchObject({ ply: 10, moveNumber: 5, color: 'b', san: 'Be7' })
  })

  it('chains fenAfter of one move into fenBefore of the next', () => {
    const positions = parsePgn(SAMPLE_PGN)
    expect(positions[0].fenAfter).toBe(positions[1].fenBefore)
  })

  it('reports a clearly negative SEE for a real piece sacrifice', () => {
    const sacrificePgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7'
    const positions = parsePgn(sacrificePgn)
    const knightSac = positions[positions.length - 1]
    expect(knightSac.san).toBe('Nxf7')
    // Wins a pawn, loses a knight.
    expect(knightSac.seeCp).toBe(-220)
  })

  it('does not treat a minor-piece trade as a sacrifice', () => {
    const evenTradePgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6'
    const positions = parsePgn(evenTradePgn)
    const trade = positions[positions.length - 1]
    expect(trade.san).toBe('Bxc6')
    // A bishop (330) for a knight (320) is -10 -- slightly negative, but
    // nowhere near the -150 threshold that makes a move a sacrifice. This
    // is why the threshold is not simply "SEE < 0".
    expect(trade.seeCp).toBe(-10)
    expect(trade.seeCp).toBeGreaterThan(-150)
  })

  it('does not treat 3...a6 in the Ruy Lopez as a sacrifice (regression)', () => {
    // The old heuristic was `capturedValue < movedValue && isAttacked(to)`,
    // which for any non-capturing pawn move reduces to `0 < 1 && attacked` --
    // so every pawn push to a covered square looked like a sacrifice, and a
    // best-move pawn push outside the opening book got classified
    // "Brilliant". The book was padded with extra theory to paper over this;
    // SEE fixes it at the source. a6 captures nothing and hangs nothing.
    const positions = parsePgn(SAMPLE_PGN)
    const a6 = positions.find((p) => p.san === 'a6')
    expect(a6?.seeCp).toBe(0)
  })

  it('reports capture and legal-move-count metadata', () => {
    const positions = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6')
    const capture = positions[positions.length - 1]
    expect(capture.isCapture).toBe(true)
    expect(capture.legalMoveCount).toBe(32)

    const opening = positions[0]
    expect(opening.isCapture).toBe(false)
    expect(opening.legalMoveCount).toBe(20)
  })

  it('throws PgnParseError for malformed PGN', () => {
    expect(() => parsePgn('1. e4 Zz9')).toThrow(PgnParseError)
  })

  it('throws PgnParseError for a PGN with no moves', () => {
    expect(() => parsePgn('[Event "Empty"]')).toThrow(PgnParseError)
  })
})

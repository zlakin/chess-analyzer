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

  it('flags a piece sacrifice landing on an attacked square', () => {
    const sacrificePgn = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7'
    const positions = parsePgn(sacrificePgn)
    const knightSac = positions[positions.length - 1]
    expect(knightSac.san).toBe('Nxf7')
    expect(knightSac.isPotentialSacrifice).toBe(true)
  })

  it('does not flag an even trade as a sacrifice', () => {
    const evenTradePgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6'
    const positions = parsePgn(evenTradePgn)
    const trade = positions[positions.length - 1]
    expect(trade.san).toBe('Bxc6')
    expect(trade.isPotentialSacrifice).toBe(false)
  })

  it('flags 3...a6 in the Ruy Lopez as a "potential sacrifice" (coarse heuristic, by design)', () => {
    // This is the root cause behind the false-positive "brilliant"
    // classification the final review found: a6 is a completely standard
    // theoretical move, but its destination square is attacked by the
    // bishop on b5, and this heuristic treats "non-capturing move to an
    // attacked square" as a potential sacrifice regardless of piece value.
    // The fix lives in the opening book (src/main/analysis/openingBook.ts),
    // which now covers this line so classifyMove tags a6 "book" before it
    // ever reaches the sacrifice/brilliant path -- see
    // src/main/analysis/classification.test.ts and
    // src/main/analysis/openingBook.test.ts. This test just documents and
    // locks in the heuristic's actual (coarse, v1) behavior.
    const positions = parsePgn(SAMPLE_PGN)
    const a6 = positions.find((p) => p.san === 'a6')
    expect(a6?.isPotentialSacrifice).toBe(true)
  })

  it('throws PgnParseError for malformed PGN', () => {
    expect(() => parsePgn('1. e4 Zz9')).toThrow(PgnParseError)
  })

  it('throws PgnParseError for a PGN with no moves', () => {
    expect(() => parsePgn('[Event "Empty"]')).toThrow(PgnParseError)
  })
})

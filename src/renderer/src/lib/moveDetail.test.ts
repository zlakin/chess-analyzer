import { describe, it, expect } from 'vitest'
import { formatMoveDetail, sanForUci } from './moveDetail'
import type { AnalyzedMove, PositionEvaluation } from '../../../shared/types'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function evalWithLine(scoreCp: number, moveUci: string): PositionEvaluation {
  return { lines: [{ depth: 18, scoreCp, scoreMate: null, moveUci, pv: [moveUci] }] }
}

function makeMove(overrides: Partial<AnalyzedMove>): AnalyzedMove {
  return {
    ply: 1,
    moveNumber: 1,
    color: 'w',
    san: 'a3',
    moveUci: 'a2a3',
    fenBefore: START_FEN,
    fenAfter: 'rnbqkbnr/pppppppp/8/8/8/P7/1PPPPPPP/RNBQKBNR b KQkq - 0 1',
    seeCp: 0,
    isCapture: false,
    legalMoveCount: 20,
    evalBefore: evalWithLine(40, 'g1f3'),
    evalAfter: evalWithLine(850, 'e7e5'),
    classification: 'inaccuracy',
    accuracy: 60,
    ...overrides
  }
}

describe('sanForUci', () => {
  it('converts a legal UCI move to SAN for the given position', () => {
    expect(sanForUci(START_FEN, 'g1f3')).toBe('Nf3')
  })

  it('returns null for an illegal move', () => {
    expect(sanForUci(START_FEN, 'a1a8')).toBeNull()
  })
})

describe('formatMoveDetail', () => {
  it('returns null when no move is selected', () => {
    expect(formatMoveDetail(null)).toBeNull()
  })

  it('returns null for book moves', () => {
    expect(formatMoveDetail(makeMove({ classification: 'book' }))).toBeNull()
  })

  it('describes a non-best move with the win-chance swing and the best alternative', () => {
    const text = formatMoveDetail(makeMove({}))
    expect(text).toMatch(/^a3 — Inaccuracy, -\d+% win chance\. Best was Nf3\.$/)
  })

  it('omits the "Best was" suffix when the played move was the engine\'s top choice', () => {
    const text = formatMoveDetail(
      makeMove({
        san: 'Nf3',
        moveUci: 'g1f3',
        classification: 'best',
        evalBefore: evalWithLine(40, 'g1f3'),
        evalAfter: evalWithLine(-30, 'e7e5')
      })
    )
    expect(text).not.toContain('Best was')
    expect(text).toMatch(/^Nf3 — Best, /)
  })

  it('appends a parenthetical tactic tag when the best move (not the move played) enables one, for a blunder', () => {
    // Same fork fixture as tacticDetector.test.ts: Nd3-e5 forks the queen on
    // c6 and the rook on g6 - Kd2 ignores it entirely.
    const forkFen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    const text = formatMoveDetail(
      makeMove({
        san: 'Kd2',
        moveUci: 'e1d2',
        fenBefore: forkFen,
        classification: 'blunder',
        evalBefore: evalWithLine(500, 'd3e5'),
        evalAfter: evalWithLine(100, 'e8d8')
      })
    )
    expect(text).toMatch(/^Kd2 — Blunder, -\d+% win chance\. Best was Ne5 \(fork\)\.$/)
  })

  it('omits the tactic tag for an inaccuracy even when the best move would enable one', () => {
    const forkFen = '4k3/8/2q3r1/8/8/3N4/8/4K3 w - - 0 1'
    const text = formatMoveDetail(
      makeMove({
        san: 'Kd2',
        moveUci: 'e1d2',
        fenBefore: forkFen,
        classification: 'inaccuracy',
        evalBefore: evalWithLine(50, 'd3e5'),
        evalAfter: evalWithLine(10, 'e8d8')
      })
    )
    expect(text).not.toContain('(fork)')
    expect(text).toMatch(/Best was Ne5\.$/)
  })

  it('omits the parenthetical when the best move enables no detected tactic, even for a blunder', () => {
    const text = formatMoveDetail(makeMove({ classification: 'blunder' }))
    expect(text).toMatch(/^a3 — Blunder, -\d+% win chance\. Best was Nf3\.$/)
  })

  it('comma-joins multiple tactic tags when the best move enables more than one', () => {
    // Same fixture as tacticDetector.test.ts's "returns multiple tags"
    // test: Nd3-e5 both captures the undefended pawn on e5 AND forks the
    // queen on c6 / rook on g6.
    const forkAndHangFen = '4k3/8/2q3r1/4p3/8/3N4/8/4K3 w - - 0 1'
    const text = formatMoveDetail(
      makeMove({
        san: 'Kd2',
        moveUci: 'e1d2',
        fenBefore: forkAndHangFen,
        classification: 'blunder',
        evalBefore: evalWithLine(500, 'd3e5'),
        evalAfter: evalWithLine(100, 'e8d8')
      })
    )
    expect(text).toMatch(/Best was Nxe5 \(wins a hanging piece, fork\)\.$/)
  })
})

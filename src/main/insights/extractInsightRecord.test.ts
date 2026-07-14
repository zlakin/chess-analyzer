import { describe, it, expect } from 'vitest'
import { extractInsightRecord } from './extractInsightRecord'
import type { AnalyzedMove, ChessComGameSummary, GameAnalysisResult } from '../../shared/types'

const HUNG_ROOK_FEN = '3qk3/8/8/8/8/8/8/3R3K b - - 0 1'
const QUIET_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

function move(
  overrides: Partial<AnalyzedMove> &
    Pick<AnalyzedMove, 'ply' | 'color' | 'san' | 'classification' | 'fenAfter'>
): AnalyzedMove {
  return {
    moveNumber: Math.ceil(overrides.ply / 2),
    moveUci: 'e2e4',
    fenBefore: QUIET_FEN,
    isPotentialSacrifice: false,
    evalBefore: { lines: [] },
    evalAfter: { lines: [] },
    accuracy: 100,
    ...overrides
  }
}

function chessComGame(overrides: Partial<ChessComGameSummary> = {}): ChessComGameSummary {
  return {
    url: 'https://www.chess.com/game/live/1',
    pgn: '1. e4 e5 2. Nf3 Nc6',
    endTime: 1700000000,
    timeControl: '600',
    white: { username: 'testuser', rating: 1500, result: 'win' },
    black: { username: 'opponent', rating: 1490, result: 'checkmated' },
    ...overrides
  }
}

describe('extractInsightRecord', () => {
  it('identifies the user color by matching username against white/black (case-insensitively)', () => {
    const analysis: GameAnalysisResult = {
      moves: [move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN })],
      whiteAccuracy: 95,
      blackAccuracy: 80
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'TestUser')
    expect(record.userColor).toBe('w')
    expect(record.accuracy).toBe(95)
    expect(record.result).toBe('win')
  })

  it('only records mistakes/blunders made by the tracked user, tagging phase and hung-piece status', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN }),
        move({
          ply: 25,
          color: 'w',
          san: 'Rd1??',
          classification: 'blunder',
          fenAfter: HUNG_ROOK_FEN,
          evalAfter: {
            lines: [{ depth: 14, scoreCp: -900, scoreMate: null, moveUci: 'd8d1', pv: ['d8d1'] }]
          }
        }),
        move({ ply: 26, color: 'b', san: 'Qxd1', classification: 'best', fenAfter: QUIET_FEN })
      ],
      whiteAccuracy: 60,
      blackAccuracy: 95
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'testuser')

    expect(record.mistakes).toHaveLength(1)
    expect(record.mistakes[0]).toMatchObject({
      ply: 25,
      classification: 'blunder',
      phase: 'middlegame',
      isHungPiece: true
    })
  })

  it('categorizes the time control from the game', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({ ply: 1, color: 'w', san: 'e4', classification: 'book', fenAfter: QUIET_FEN }),
        move({ ply: 2, color: 'b', san: 'e5', classification: 'book', fenAfter: QUIET_FEN })
      ],
      whiteAccuracy: 90,
      blackAccuracy: 90
    }

    // NOTE: the plan's brief used '180+2' here, but categorizeTimeControl (Task 6,
    // already implemented/tested) treats exactly 180s base as 'blitz' (chess.com's own
    // convention: 3|0 is Blitz, not Bullet) -- see timeControl.ts's own passing test
    // `categorizeTimeControl('180')` -> 'blitz'. Using 120s here (matching Task 6's own
    // bullet-boundary fixture '120+1') keeps this test meaningful without touching the
    // already-shipped Task 6 module.
    const record = extractInsightRecord(chessComGame({ timeControl: '120+2' }), analysis, 'testuser')
    expect(record.timeControlCategory).toBe('bullet')
  })

  it('leaves clockSecondsRemaining null and isTimePressure false when the PGN has no clock data', () => {
    const analysis: GameAnalysisResult = {
      moves: [
        move({
          ply: 25,
          color: 'w',
          san: 'Rd1??',
          classification: 'blunder',
          fenAfter: HUNG_ROOK_FEN
        })
      ],
      whiteAccuracy: 60,
      blackAccuracy: 95
    }

    const record = extractInsightRecord(chessComGame(), analysis, 'testuser')
    expect(record.mistakes[0].clockSecondsRemaining).toBeNull()
    expect(record.mistakes[0].isTimePressure).toBe(false)
  })
})

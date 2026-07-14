import { describe, it, expect } from 'vitest'
import { gamePhaseAt } from './phaseHeuristic'

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const KR_VS_KR_ENDGAME_FEN = '8/8/4k3/8/8/4K3/8/R6r w - - 0 40'
const FULL_MATERIAL_MIDDLEGAME_FEN =
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

describe('gamePhaseAt', () => {
  it('is always "opening" before ply 20 regardless of material', () => {
    expect(gamePhaseAt(STARTING_FEN, 1)).toBe('opening')
    expect(gamePhaseAt(KR_VS_KR_ENDGAME_FEN, 19)).toBe('opening')
  })

  it('is "middlegame" past ply 20 with substantial material on the board', () => {
    expect(gamePhaseAt(FULL_MATERIAL_MIDDLEGAME_FEN, 20)).toBe('middlegame')
  })

  it('is "endgame" past ply 20 once both sides are down to a rook or less', () => {
    expect(gamePhaseAt(KR_VS_KR_ENDGAME_FEN, 45)).toBe('endgame')
  })
})

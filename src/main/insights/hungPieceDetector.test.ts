import { describe, it, expect } from 'vitest'
import { isHungPieceBlunder } from './hungPieceDetector'
import type { EngineLine } from '../../shared/types'

function line(pv: string[]): EngineLine {
  return { depth: 14, scoreCp: -500, scoreMate: null, moveUci: pv[0], pv }
}

describe('isHungPieceBlunder', () => {
  it('is true when the opponent can capture a piece with no possible recapture', () => {
    // Black queen d8, white rook d1 (undefended -- king is on h1, out of
    // reach), black to move. Qxd1 wins the rook for free.
    const fenAfterBlunder = '3qk3/8/8/8/8/8/8/3R3K b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['d8d1']))).toBe(true)
  })

  it('is false when the blundering side can recapture on the same square', () => {
    // Same idea, but a second white rook on a1 defends d1 along the first
    // rank, so after Qxd1, Rxd1 recaptures.
    const fenAfterBlunder = '3qk3/8/8/8/8/8/8/R2R3K b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['d8d1']))).toBe(false)
  })

  it("is false when the opponent's best reply is not a capture", () => {
    const fenAfterBlunder = '4k3/8/8/8/8/8/4K3/7q b - - 0 1'
    expect(isHungPieceBlunder(fenAfterBlunder, line(['h1h4']))).toBe(false)
  })

  it('is false when there is no PV to inspect', () => {
    expect(isHungPieceBlunder('4k3/8/8/8/8/8/8/4K3 w - - 0 1', undefined)).toBe(false)
  })
})

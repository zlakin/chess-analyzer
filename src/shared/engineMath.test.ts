import { describe, it, expect } from 'vitest'
import { effectiveCp, cpToWinPercent, computeMoveEvalDelta } from './engineMath'
import type { EngineLine, PositionEvaluation } from './types'

function line(overrides: Partial<EngineLine>): EngineLine {
  return { depth: 18, scoreCp: 0, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'], ...overrides }
}

describe('effectiveCp', () => {
  it('returns the raw centipawn score when there is no mate', () => {
    expect(effectiveCp(line({ scoreCp: 45, scoreMate: null }))).toBe(45)
  })

  it('returns a large positive number for a short mate for the side to move', () => {
    expect(effectiveCp(line({ scoreCp: null, scoreMate: 2 }))).toBeGreaterThan(50000)
  })

  it('returns a large negative number for a short mate against the side to move', () => {
    expect(effectiveCp(line({ scoreCp: null, scoreMate: -2 }))).toBeLessThan(-50000)
  })

  it('gives a closer mate a bigger magnitude than a longer one', () => {
    const mateIn1 = effectiveCp(line({ scoreCp: null, scoreMate: 1 }))
    const mateIn5 = effectiveCp(line({ scoreCp: null, scoreMate: 5 }))
    expect(mateIn1).toBeGreaterThan(mateIn5)
  })

  it('treats "mate 0" (the side to move is checkmated) as a large negative score', () => {
    // Real Stockfish reports "score mate 0" for a checkmated position -- the
    // side to move has no moves and is in check, i.e. a loss for them.
    expect(effectiveCp(line({ scoreCp: null, scoreMate: 0 }))).toBeLessThan(-50000)
  })
})

describe('cpToWinPercent', () => {
  it('returns 50% at an equal position', () => {
    expect(cpToWinPercent(0)).toBeCloseTo(50, 5)
  })

  it('increases monotonically with centipawns', () => {
    expect(cpToWinPercent(100)).toBeGreaterThan(cpToWinPercent(0))
    expect(cpToWinPercent(500)).toBeGreaterThan(cpToWinPercent(100))
  })

  it('is symmetric around 50%', () => {
    const above = cpToWinPercent(200)
    const below = cpToWinPercent(-200)
    expect(above - 50).toBeCloseTo(50 - below, 5)
  })
})

describe('computeMoveEvalDelta', () => {
  it('reports zero loss and isBestMove=true when the played move matches the top line', () => {
    const evalBefore: PositionEvaluation = {
      lines: [line({ scoreCp: 40, moveUci: 'e2e4' }), line({ scoreCp: 20, moveUci: 'd2d4' })]
    }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -38, moveUci: 'e7e5' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')

    expect(delta.isBestMove).toBe(true)
    expect(delta.cpLoss).toBe(0)
    expect(delta.evalBeforeMoverCp).toBe(40)
    expect(delta.secondBestMoverCp).toBe(20)
  })

  it('reports positive cpLoss for a move that is worse than the best line', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 40, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: 60, moveUci: 'a7a6' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'a2a3')

    expect(delta.isBestMove).toBe(false)
    expect(delta.evalAfterMoverCp).toBe(-60)
    expect(delta.cpLoss).toBe(100)
  })

  it('returns null secondBestMoverCp when only one line was evaluated', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 10, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -5, moveUci: 'e7e5' })] }

    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')

    expect(delta.secondBestMoverCp).toBeNull()
  })

  it('does not throw when evalAfter has an empty lines array (defense-in-depth)', () => {
    const evalBefore: PositionEvaluation = { lines: [line({ scoreCp: 40, moveUci: 'e2e4' })] }
    const evalAfter: PositionEvaluation = { lines: [] }

    expect(() => computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')).not.toThrow()
    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')
    expect(Number.isFinite(delta.evalAfterMoverCp)).toBe(true)
    expect(Number.isFinite(delta.cpLoss)).toBe(true)
  })

  it('does not throw when evalBefore has an empty lines array (defense-in-depth)', () => {
    const evalBefore: PositionEvaluation = { lines: [] }
    const evalAfter: PositionEvaluation = { lines: [line({ scoreCp: -5, moveUci: 'e7e5' })] }

    expect(() => computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')).not.toThrow()
    const delta = computeMoveEvalDelta(evalBefore, evalAfter, 'e2e4')
    expect(delta.isBestMove).toBe(false)
    expect(Number.isFinite(delta.evalBeforeMoverCp)).toBe(true)
  })
})

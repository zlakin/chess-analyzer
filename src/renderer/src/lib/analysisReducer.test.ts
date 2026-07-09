import { describe, it, expect } from 'vitest'
import { analysisReducer, INITIAL_STATE } from './analysisReducer'
import type { AnalyzedMove, AnalyzedPosition, GameAnalysisResult } from '../../../shared/types'

const fakePosition: AnalyzedPosition = {
  ply: 1,
  moveNumber: 1,
  color: 'w',
  san: 'e4',
  moveUci: 'e2e4',
  fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
  isPotentialSacrifice: false
}

const fakeMove: AnalyzedMove = {
  ...fakePosition,
  evalBefore: { lines: [] },
  evalAfter: { lines: [] },
  classification: 'best',
  accuracy: 95
}

describe('analysisReducer', () => {
  it('resets to analyzing state on START', () => {
    const state = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    expect(state.status).toBe('analyzing')
    expect(state.positions).toEqual([fakePosition])
    expect(state.moves).toEqual([])
  })

  it('appends moves on MOVE_PROGRESS', () => {
    const started = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    const withMove = analysisReducer(started, { type: 'MOVE_PROGRESS', move: fakeMove })
    expect(withMove.moves).toEqual([fakeMove])
    expect(withMove.progressCount).toBe(1)
  })

  it('stores accuracies on COMPLETE', () => {
    const result: GameAnalysisResult = { moves: [fakeMove], whiteAccuracy: 91.2, blackAccuracy: 88.4 }
    const state = analysisReducer(INITIAL_STATE, { type: 'COMPLETE', result })
    expect(state.status).toBe('done')
    expect(state.whiteAccuracy).toBe(91.2)
    expect(state.blackAccuracy).toBe(88.4)
  })

  it('records the error message on ERROR', () => {
    const state = analysisReducer(INITIAL_STATE, { type: 'ERROR', message: 'boom' })
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('RESET returns to the initial state', () => {
    const started = analysisReducer(INITIAL_STATE, { type: 'START', positions: [fakePosition] })
    const reset = analysisReducer(started, { type: 'RESET' })
    expect(reset).toEqual(INITIAL_STATE)
  })
})

import { describe, it, expect } from 'vitest'
import { resultBadge } from './chessComResult'
import type { ChessComGameSummary } from '../../../shared/types'

function makeGame(whiteResult: string, blackResult: string): ChessComGameSummary {
  return {
    url: 'https://chess.com/game/1',
    pgn: '',
    endTime: 0,
    timeControl: '600',
    white: { username: 'alice', rating: 1500, result: whiteResult },
    black: { username: 'bob', rating: 1500, result: blackResult }
  }
}

describe('resultBadge', () => {
  it('reports a white win', () => {
    expect(resultBadge(makeGame('win', 'resigned'))).toEqual({ text: '1–0', outcome: 'white' })
  })

  it('reports a black win', () => {
    expect(resultBadge(makeGame('resigned', 'win'))).toEqual({ text: '0–1', outcome: 'black' })
  })

  it('reports a draw', () => {
    expect(resultBadge(makeGame('agreed', 'agreed'))).toEqual({ text: '½–½', outcome: 'draw' })
  })
})

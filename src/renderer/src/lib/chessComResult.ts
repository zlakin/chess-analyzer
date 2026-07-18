import type { ChessComGameSummary } from '../../../shared/types'

const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  'timevsinsufficient',
  '50move'
])

export function resultBadge(game: ChessComGameSummary): {
  text: string
  outcome: 'white' | 'black' | 'draw'
} {
  if (DRAW_RESULTS.has(game.white.result) || DRAW_RESULTS.has(game.black.result)) {
    return { text: '½–½', outcome: 'draw' }
  }
  return game.white.result === 'win'
    ? { text: '1–0', outcome: 'white' }
    : { text: '0–1', outcome: 'black' }
}

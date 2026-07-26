import { describe, it, expect } from 'vitest'
import { buildPuzzleQueue } from './puzzleQueue'
import type { GameInsightRecord, SrsCardState } from '../../shared/types'

function mistakeRecord(gameUrl: string, plies: number[]): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'loss',
    openingName: null,
    accuracy: 80,
    mistakes: plies.map((ply) => ({
      ply,
      classification: 'blunder',
      phase: 'middlegame',
      cpLoss: 250,
      fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      playedMoveUci: 'e2e3',
      bestMoveUci: 'e2e4',
      missedTactics: [],
      punishedByTactics: [],
      clockSecondsRemaining: null,
      isTimePressure: false
    }))
  }
}

function state(cardId: string, dueDate: number): SrsCardState {
  return { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate, lastReviewedAt: 0 }
}

describe('buildPuzzleQueue', () => {
  it('synthesizes a due-now default for a mistake never reviewed before', () => {
    const records = [mistakeRecord('g1', [10])]
    const queue = buildPuzzleQueue(records, {}, 5000)

    expect(queue.due).toHaveLength(1)
    expect(queue.due[0].cardId).toBe('g1#10')
    expect(queue.nextDueAt).toBe(5000)
  })

  it('excludes a card whose stored dueDate is in the future', () => {
    const records = [mistakeRecord('g1', [10])]
    const srsState = { 'g1#10': state('g1#10', 10000) }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due).toEqual([])
    expect(queue.nextDueAt).toBe(10000)
  })

  it('includes a card whose stored dueDate has already passed', () => {
    const records = [mistakeRecord('g1', [10])]
    const srsState = { 'g1#10': state('g1#10', 1000) }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due).toHaveLength(1)
    expect(queue.due[0].cardId).toBe('g1#10')
  })

  it('sorts due cards oldest-due-first', () => {
    const records = [mistakeRecord('g1', [10, 20])]
    const srsState = {
      'g1#10': state('g1#10', 3000),
      'g1#20': state('g1#20', 1000)
    }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.due.map((c) => c.cardId)).toEqual(['g1#20', 'g1#10'])
  })

  it('nextDueAt is the soonest dueDate across the full set, including not-yet-due cards', () => {
    const records = [mistakeRecord('g1', [10, 20])]
    const srsState = {
      'g1#10': state('g1#10', 9000), // not due
      'g1#20': state('g1#20', 500) // due
    }

    const queue = buildPuzzleQueue(records, srsState, 5000)

    expect(queue.nextDueAt).toBe(500)
  })

  it('returns an empty queue with a null nextDueAt when there are no mistakes at all', () => {
    const queue = buildPuzzleQueue([], {}, 5000)
    expect(queue).toEqual({ due: [], nextDueAt: null })
  })
})

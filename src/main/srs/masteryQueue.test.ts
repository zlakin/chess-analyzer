import { describe, it, expect } from 'vitest'
import { buildMasteryTree, buildNodeQueue } from './masteryQueue'
import type { GameInsightRecord, SrsCardState, TacticType } from '../../shared/types'
import type { MasteryState } from './masteryTree'

function mistakeRecord(
  gameUrl: string,
  ply: number,
  tactic: TacticType,
  overrides: Partial<GameInsightRecord['mistakes'][number]> = {}
): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'loss',
    openingName: null,
    accuracy: 80,
    mistakes: [
      {
        ply,
        classification: 'blunder',
        phase: 'middlegame',
        cpLoss: 250,
        fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        playedMoveUci: 'e2e3',
        bestMoveUci: 'e2e4',
        missedTactics: [tactic],
        punishedByTactics: [],
        clockSecondsRemaining: null,
        isTimePressure: false,
        ...overrides
      }
    ]
  }
}

function srsState(cardId: string, dueDate: number): Record<string, SrsCardState> {
  return { [cardId]: { cardId, easeFactor: 2.5, intervalDays: 6, repetitions: 2, dueDate, lastReviewedAt: 0 } }
}

describe('buildNodeQueue', () => {
  it('includes the user\'s own mistakes of the matching tactic at the active level', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.some((c) => c.cardId === 'g1#10' && c.source === 'mistake')).toBe(true)
  })

  it('excludes mistakes tagged with a different tactic', () => {
    const records = [mistakeRecord('g1', 10, 'pin')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.some((c) => c.cardId === 'g1#10')).toBe(false)
  })

  it('tops up with backfill puzzles when real mistakes fall short of the minimum pool size', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.length).toBeGreaterThanOrEqual(15)
    expect(queue.some((c) => c.source === 'backfill')).toBe(true)
  })

  it('does not include backfill once real mistakes alone already meet the minimum', () => {
    const records = Array.from({ length: 20 }, (_, i) => mistakeRecord(`g${i}`, 10, 'fork'))
    const queue = buildNodeQueue('fork:1', records, {}, {}, 5000)

    expect(queue.every((c) => c.source === 'mistake')).toBe(true)
    expect(queue.length).toBe(20)
  })

  it('stops feeding new mistakes into a mastered, superseded level, using only backfill there', () => {
    const records = [mistakeRecord('g1', 10, 'fork')]
    const masteryState: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }

    const queue = buildNodeQueue('fork:1', records, masteryState, {}, 5000)

    expect(queue.every((c) => c.source === 'backfill')).toBe(true)
  })

  it('sorts cards with a past due-date before not-yet-due cards', () => {
    const records = [mistakeRecord('g1', 10, 'fork'), mistakeRecord('g2', 20, 'fork')]
    const state = {
      ...srsState('g1#10', 9000), // not due
      ...srsState('g2#20', 1000) // due
    }

    const queue = buildNodeQueue('fork:1', records, {}, state, 5000)

    expect(queue[0].cardId).toBe('g2#20')
  })
})

describe('buildMasteryTree', () => {
  it('returns all 18 nodes', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    expect(tree).toHaveLength(18)
  })

  it('unlocks only level 1 of every tactic by default', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    for (const node of tree) {
      expect(node.unlocked).toBe(node.level === 1)
    }
  })

  it('unlocks level 2 of a tactic once level 1 is mastered, leaving other tactics untouched', () => {
    const masteryState: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    const tree = buildMasteryTree([], masteryState, {}, 5000)

    const fork2 = tree.find((n) => n.key === 'fork:2')
    const pin2 = tree.find((n) => n.key === 'pin:2')
    expect(fork2?.unlocked).toBe(true)
    expect(pin2?.unlocked).toBe(false)
  })

  it('reports dueCount as 0 for a locked node without building its queue', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    const fork2 = tree.find((n) => n.key === 'fork:2')
    expect(fork2?.dueCount).toBe(0)
  })

  it('reports a nonzero dueCount for an unlocked node backed only by never-attempted backfill (immediately due)', () => {
    const tree = buildMasteryTree([], {}, {}, 5000)
    const fork1 = tree.find((n) => n.key === 'fork:1')
    expect(fork1?.dueCount).toBeGreaterThan(0)
  })
})

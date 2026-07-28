import { describe, it, expect } from 'vitest'
import {
  allMasteryNodeKeys,
  currentActiveLevel,
  defaultMasteryProgress,
  isUnlocked,
  masteryNodeKey,
  nextMasteryProgress,
  parseMasteryNodeKey,
  resolveMistakeCredit
} from './masteryTree'
import type { MasteryState } from './masteryTree'

describe('masteryNodeKey / parseMasteryNodeKey', () => {
  it('round-trips a tactic and level through a key', () => {
    expect(masteryNodeKey('fork', 2)).toBe('fork:2')
    expect(parseMasteryNodeKey('fork:2')).toEqual({ tactic: 'fork', level: 2 })
  })
})

describe('allMasteryNodeKeys', () => {
  it('produces exactly 18 unique keys, one per tactic x level', () => {
    const keys = allMasteryNodeKeys()
    expect(keys).toHaveLength(18)
    expect(new Set(keys).size).toBe(18)
    expect(keys).toContain('back_rank_mate:3')
    expect(keys).toContain('hung_piece:1')
  })
})

describe('isUnlocked', () => {
  it('level 1 is always unlocked regardless of state', () => {
    expect(isUnlocked({}, 'fork', 1)).toBe(true)
  })

  it('level 2 is locked until level 1 is mastered', () => {
    const state: MasteryState = {}
    expect(isUnlocked(state, 'fork', 2)).toBe(false)
  })

  it('level 2 unlocks once level 1 is mastered', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(isUnlocked(state, 'fork', 2)).toBe(true)
  })

  it('a different tactic mastering its level 1 does not unlock this one', () => {
    const state: MasteryState = { 'pin:1': { cleanStreak: 5, mastered: true } }
    expect(isUnlocked(state, 'fork', 2)).toBe(false)
  })
})

describe('currentActiveLevel', () => {
  it('is level 1 for a tactic with no progress yet', () => {
    expect(currentActiveLevel({}, 'fork')).toBe(1)
  })

  it('advances to level 2 once level 1 is mastered', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(currentActiveLevel(state, 'fork')).toBe(2)
  })

  it('stays at level 3 once every level is mastered', () => {
    const state: MasteryState = {
      'fork:1': { cleanStreak: 5, mastered: true },
      'fork:2': { cleanStreak: 5, mastered: true },
      'fork:3': { cleanStreak: 5, mastered: true }
    }
    expect(currentActiveLevel(state, 'fork')).toBe(3)
  })
})

describe('nextMasteryProgress', () => {
  it('extends the streak on a clean solve without mastering below the threshold', () => {
    const result = nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'clean')
    expect(result).toEqual({ cleanStreak: 4, mastered: false })
  })

  it('masters the node the moment the streak reaches the threshold', () => {
    const result = nextMasteryProgress({ cleanStreak: 4, mastered: false }, 'clean')
    expect(result).toEqual({ cleanStreak: 5, mastered: true })
  })

  it('resets the streak to 0 on a retried/hinted/gaveUp outcome', () => {
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'retried')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'hinted')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
    expect(nextMasteryProgress({ cleanStreak: 3, mastered: false }, 'gaveUp')).toEqual({
      cleanStreak: 0,
      mastered: false
    })
  })

  it('never un-masters a node once mastered, even on a later non-clean outcome', () => {
    const result = nextMasteryProgress({ cleanStreak: 7, mastered: true }, 'retried')
    expect(result).toEqual({ cleanStreak: 0, mastered: true })
  })
})

describe('defaultMasteryProgress', () => {
  it('starts at a zero streak, unmastered', () => {
    expect(defaultMasteryProgress()).toEqual({ cleanStreak: 0, mastered: false })
  })
})

describe('resolveMistakeCredit', () => {
  it('returns null when no tactic was detected', () => {
    expect(resolveMistakeCredit({}, [], [])).toBeNull()
  })

  it('credits the first missed tactic at its current active level', () => {
    const state: MasteryState = { 'fork:1': { cleanStreak: 5, mastered: true } }
    expect(resolveMistakeCredit(state, ['fork'], [])).toBe('fork:2')
  })

  it('falls back to punishedByTactics when missedTactics is empty', () => {
    expect(resolveMistakeCredit({}, [], ['pin'])).toBe('pin:1')
  })

  it('prefers missedTactics over punishedByTactics when both are present', () => {
    expect(resolveMistakeCredit({}, ['fork'], ['pin'])).toBe('fork:1')
  })
})

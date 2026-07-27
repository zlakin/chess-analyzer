import { describe, it, expect } from 'vitest'
import { getBackfillPuzzles } from './backfillPuzzles'
import { TACTIC_TYPES } from '../../shared/types'
import type { MasteryLevel } from '../../shared/types'

const LEVELS: MasteryLevel[] = [1, 2, 3]

describe('getBackfillPuzzles', () => {
  it('returns a non-empty, capped, well-formed puzzle list for every tactic and level', () => {
    for (const tactic of TACTIC_TYPES) {
      for (const level of LEVELS) {
        const puzzles = getBackfillPuzzles(tactic, level)
        expect(puzzles.length).toBeGreaterThan(0)
        expect(puzzles.length).toBeLessThanOrEqual(250)
        for (const puzzle of puzzles) {
          expect(typeof puzzle.id).toBe('string')
          expect(typeof puzzle.fenBefore).toBe('string')
          expect(typeof puzzle.bestMoveUci).toBe('string')
          expect(typeof puzzle.rating).toBe('number')
        }
      }
    }
  })

  it('returns an empty array rather than throwing for a key the dataset has no entry for', () => {
    // Every real (tactic, level) combination has data (proven above) - this
    // exercises the defensive fallback for a shape the loader itself would
    // never produce, not a real gap in the shipped dataset.
    expect(getBackfillPuzzles('fork', 99 as MasteryLevel)).toEqual([])
  })
})

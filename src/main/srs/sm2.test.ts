import { describe, it, expect } from 'vitest'
import { newCardState, nextCardState } from './sm2'

const DAY = 86400000

describe('sm2', () => {
  it('newCardState is due immediately with SM-2 defaults', () => {
    expect(newCardState('card-1', 1000)).toEqual({
      cardId: 'card-1',
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      dueDate: 1000,
      lastReviewedAt: null
    })
  })

  it('produces the standard SM-2 interval/ease sequence for constant quality 5', () => {
    let state = newCardState('card-1', 0)
    const now = () => state.dueDate // each review happens exactly when the previous one came due

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(1)
    expect(state.easeFactor).toBeCloseTo(2.6)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(6)
    expect(state.easeFactor).toBeCloseTo(2.7)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(17) // round(6 * 2.8)
    expect(state.easeFactor).toBeCloseTo(2.8)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(49) // round(17 * 2.9)
    expect(state.easeFactor).toBeCloseTo(2.9)

    state = nextCardState(state, 5, now())
    expect(state.intervalDays).toBe(147) // round(49 * 3.0)
    expect(state.easeFactor).toBeCloseTo(3.0)
  })

  it('holds easeFactor exactly flat for constant quality 4 (its delta is zero)', () => {
    let state = newCardState('card-1', 0)
    const now = () => state.dueDate

    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(1)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(6)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(15) // round(6 * 2.5)
    state = nextCardState(state, 4, now())
    expect(state.intervalDays).toBe(38) // round(15 * 2.5)

    expect(state.easeFactor).toBeCloseTo(2.5)
  })

  it('a fail resets repetitions and interval to a 1-day restart, leaving easeFactor untouched', () => {
    let state = newCardState('card-1', 0)
    state = nextCardState(state, 5, 0) // pass: repetitions 1, EF 2.6
    state = nextCardState(state, 5, DAY) // pass: repetitions 2, EF 2.7

    const failedAt = 7 * DAY
    state = nextCardState(state, 1, failedAt)

    expect(state.repetitions).toBe(0)
    expect(state.intervalDays).toBe(1)
    expect(state.dueDate).toBe(failedAt + DAY)
    expect(state.easeFactor).toBeCloseTo(2.7) // unchanged by the fail
    expect(state.lastReviewedAt).toBe(failedAt)

    // Recovering after a lapse restarts the 1/6/interval*EF progression
    // from repetition 1, but keeps the ease factor the lapse left behind.
    state = nextCardState(state, 5, state.dueDate)
    expect(state.repetitions).toBe(1)
    expect(state.intervalDays).toBe(1)
    expect(state.easeFactor).toBeCloseTo(2.8)
  })

  it('easeFactor never drops below the 1.3 floor under repeated weak passes', () => {
    let state = newCardState('card-1', 0)
    for (let i = 0; i < 20; i++) {
      state = nextCardState(state, 3, state.dueDate)
    }
    expect(state.easeFactor).toBe(1.3)
  })
})

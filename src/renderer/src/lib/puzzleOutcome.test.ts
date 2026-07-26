import { describe, it, expect } from 'vitest'
import {
  resolveSolvedOutcome,
  cappedQuality,
  newCardProgress,
  claimReview,
  claimOutcome
} from './puzzleOutcome'

describe('resolveSolvedOutcome', () => {
  it('is clean when solved on the first attempt with no hint', () => {
    expect(resolveSolvedOutcome(false, false)).toBe('clean')
  })

  it('is retried when solved after a wrong attempt, with no hint', () => {
    expect(resolveSolvedOutcome(true, false)).toBe('retried')
  })

  it('is hinted whenever a hint was used, regardless of prior wrong attempts', () => {
    expect(resolveSolvedOutcome(false, true)).toBe('hinted')
    expect(resolveSolvedOutcome(true, true)).toBe('hinted')
  })
})

describe('cappedQuality', () => {
  it('passes quality through unchanged when no hint was used', () => {
    expect(cappedQuality(5, false)).toBe(5)
    expect(cappedQuality(0, false)).toBe(0)
  })

  it('caps quality at 3 when a hint was used', () => {
    expect(cappedQuality(5, true)).toBe(3)
    expect(cappedQuality(4, true)).toBe(3)
    expect(cappedQuality(3, true)).toBe(3)
  })

  it('leaves an already-low quality untouched when a hint was used', () => {
    expect(cappedQuality(2, true)).toBe(2)
    expect(cappedQuality(0, true)).toBe(0)
  })
})

describe('newCardProgress', () => {
  it('starts with nothing claimed and no wrong attempt', () => {
    expect(newCardProgress('card-1')).toEqual({
      cardId: 'card-1',
      reviewSubmitted: false,
      hadWrongAttempt: false,
      outcomeSubmitted: false
    })
  })
})

describe('claimReview', () => {
  it('returns true exactly once for a fresh card, false on every retry', () => {
    const progress = newCardProgress('card-1')
    expect(claimReview(progress)).toBe(true)
    expect(claimReview(progress)).toBe(false)
    expect(claimReview(progress)).toBe(false)
  })

  it('marks the claim on the progress object so later readers can see it', () => {
    const progress = newCardProgress('card-1')
    expect(progress.reviewSubmitted).toBe(false)
    claimReview(progress)
    expect(progress.reviewSubmitted).toBe(true)
  })

  it('tracks each card independently', () => {
    const first = newCardProgress('card-1')
    const second = newCardProgress('card-2')
    expect(claimReview(first)).toBe(true)
    expect(claimReview(second)).toBe(true)
  })
})

describe('claimOutcome', () => {
  it('returns true exactly once for a fresh card, false on every retry', () => {
    const progress = newCardProgress('card-1')
    expect(claimOutcome(progress)).toBe(true)
    expect(claimOutcome(progress)).toBe(false)
    expect(claimOutcome(progress)).toBe(false)
  })

  it('marks the claim on the progress object so later readers can see it', () => {
    const progress = newCardProgress('card-1')
    expect(progress.outcomeSubmitted).toBe(false)
    claimOutcome(progress)
    expect(progress.outcomeSubmitted).toBe(true)
  })
})

describe('claimReview and claimOutcome independence', () => {
  it('claiming the review leaves the outcome unclaimed', () => {
    const progress = newCardProgress('card-1')
    claimReview(progress)
    expect(progress.outcomeSubmitted).toBe(false)
    expect(claimOutcome(progress)).toBe(true)
  })

  it('claiming the outcome leaves the review unclaimed', () => {
    const progress = newCardProgress('card-1')
    claimOutcome(progress)
    expect(progress.reviewSubmitted).toBe(false)
    expect(claimReview(progress)).toBe(true)
  })

  it('neither claim touches hadWrongAttempt', () => {
    const progress = newCardProgress('card-1')
    claimReview(progress)
    claimOutcome(progress)
    expect(progress.hadWrongAttempt).toBe(false)
  })
})

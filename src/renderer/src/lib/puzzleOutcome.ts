import type { PuzzleOutcome, SrsQuality } from '../../../shared/types'

export function resolveSolvedOutcome(hadWrongAttempt: boolean, hintUsed: boolean): PuzzleOutcome {
  if (hintUsed) return 'hinted'
  if (hadWrongAttempt) return 'retried'
  return 'clean'
}

export function cappedQuality(quality: SrsQuality, hintUsed: boolean): SrsQuality {
  return hintUsed ? (Math.min(quality, 3) as SrsQuality) : quality
}

/**
 * Per-card bookkeeping for the one-write-per-card guarantees. Deliberately
 * plain, mutable, and React-free: usePuzzleSession keeps one of these in a
 * ref and mutates it in place across retries, so the claim checks here are
 * the whole of the retry-safety logic and are unit-testable on their own.
 */
export interface CardProgress {
  cardId: string
  reviewSubmitted: boolean
  hadWrongAttempt: boolean
  outcomeSubmitted: boolean
}

export function newCardProgress(cardId: string): CardProgress {
  return { cardId, reviewSubmitted: false, hadWrongAttempt: false, outcomeSubmitted: false }
}

/**
 * Returns true if THIS call should actually submit the SRS review (and marks
 * it claimed) - false if an earlier call on this same card already did. The
 * read-check-set happens synchronously, before any await, so two in-flight
 * attempts can never both claim it.
 */
export function claimReview(progress: CardProgress): boolean {
  if (progress.reviewSubmitted) return false
  progress.reviewSubmitted = true
  return true
}

/** Same idea as claimReview, for the gamification-outcome write. */
export function claimOutcome(progress: CardProgress): boolean {
  if (progress.outcomeSubmitted) return false
  progress.outcomeSubmitted = true
  return true
}

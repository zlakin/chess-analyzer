import type { SrsCardState, SrsQuality } from '../../shared/types'

const DEFAULT_EASE_FACTOR = 2.5
const MIN_EASE_FACTOR = 1.3
const MS_PER_DAY = 86400000

export function newCardState(cardId: string, now: number): SrsCardState {
  return {
    cardId,
    easeFactor: DEFAULT_EASE_FACTOR,
    intervalDays: 0,
    repetitions: 0,
    dueDate: now,
    lastReviewedAt: null
  }
}

export function nextCardState(current: SrsCardState, quality: SrsQuality, now: number): SrsCardState {
  if (quality < 3) {
    // SM-2: a fail resets the repetition streak and drops straight back
    // to a 1-day interval, but leaves easeFactor untouched - ease only
    // ever moves on a pass, per the standard SM-2 definition.
    return {
      ...current,
      repetitions: 0,
      intervalDays: 1,
      dueDate: now + MS_PER_DAY,
      lastReviewedAt: now
    }
  }

  const repetitions = current.repetitions + 1
  // Uses current.easeFactor (the PRE-update value) - real SM-2 computes
  // this review's interval from the ease factor as it stood going into
  // the review, then updates the ease factor afterward for next time.
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(current.intervalDays * current.easeFactor)
  const easeFactor = Math.max(
    MIN_EASE_FACTOR,
    current.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  )

  return {
    ...current,
    repetitions,
    easeFactor,
    intervalDays,
    dueDate: now + intervalDays * MS_PER_DAY,
    lastReviewedAt: now
  }
}

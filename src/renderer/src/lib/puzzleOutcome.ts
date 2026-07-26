import type { PuzzleOutcome, SrsQuality } from '../../../shared/types'

export function resolveSolvedOutcome(hadWrongAttempt: boolean, hintUsed: boolean): PuzzleOutcome {
  if (hintUsed) return 'hinted'
  if (hadWrongAttempt) return 'retried'
  return 'clean'
}

export function cappedQuality(quality: SrsQuality, hintUsed: boolean): SrsQuality {
  return hintUsed ? (Math.min(quality, 3) as SrsQuality) : quality
}

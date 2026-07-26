import { useCallback, useEffect, useRef, useState } from 'react'
import type { PuzzleCard, PuzzleOutcome, PuzzleStats } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'
import { gradeAttempt } from '../lib/gradeAttempt'
import { resolveSolvedOutcome, cappedQuality } from '../lib/puzzleOutcome'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

interface CardProgress {
  cardId: string
  reviewSubmitted: boolean
  hadWrongAttempt: boolean
  outcomeSubmitted: boolean
}

export function usePuzzleSession(): {
  queue: PuzzleCard[]
  nextDueAt: number | null
  currentCard: PuzzleCard | null
  sessionTotal: number
  stats: PuzzleStats | null
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<PuzzleCard[]>([])
  const [nextDueAt, setNextDueAt] = useState<number | null>(null)
  const [sessionTotal, setSessionTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<PuzzleStats | null>(null)
  const [hintUsed, setHintUsed] = useState(false)
  const cardProgressRef = useRef<CardProgress | null>(null)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const result = await window.chessAPI.getPuzzleQueue()
    setQueue(result.due)
    setNextDueAt(result.nextDueAt)
    setSessionTotal(result.due.length)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    window.chessAPI.getPuzzleStats().then(setStats)
  }, [])

  const currentCard = queue[0] ?? null

  // A card's hint state and first-attempt/SRS-submission bookkeeping are
  // scoped to that one card - reset whenever the current card changes so
  // neither leaks into the next puzzle.
  useEffect(() => {
    cardProgressRef.current = null
    setHintUsed(false)
  }, [currentCard?.cardId])

  const submitOutcome = useCallback(
    async (outcome: PuzzleOutcome, classification: 'mistake' | 'blunder'): Promise<void> => {
      try {
        const updated = await window.chessAPI.submitPuzzleOutcome(outcome, classification)
        setStats(updated)
      } catch (err) {
        // Mirrors this hook's existing precedent for submitPuzzleReview below:
        // the puzzle-rating stats are a motivational extra, not load-bearing -
        // a failed write there shouldn't block showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    []
  )

  const attempt = useCallback(
    async (from: string, to: string): Promise<PuzzleAttemptResult | { error: string }> => {
      if (!currentCard) return { error: 'No puzzle to attempt.' }

      const uci = `${from}${to}`
      const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      let graded: ReturnType<typeof gradeAttempt>
      if (uci === currentCard.bestMoveUci || `${uci}q` === currentCard.bestMoveUci) {
        // Matches the recorded best move exactly - grade it a pass without
        // running a live eval at all. This also sidesteps a real problem:
        // bestMoveUci was found at the scan's depth (14), but grading runs
        // shallower (12) for speed - in a sharp, tactically-loaded position
        // (every puzzle is one, by definition), that depth gap could
        // otherwise make playing the *exact recorded answer* grade as a fail.
        graded = { correct: true, cpLoss: 0, quality: 5 }
      } else {
        const [evalBefore, evalAfter] = await Promise.all([
          window.chessAPI.evaluatePosition(currentCard.fenBefore, PUZZLE_DEPTH),
          window.chessAPI.evaluatePosition(fenAfterAttempt, PUZZLE_DEPTH)
        ])
        if ('error' in evalBefore) return { error: evalBefore.error }
        if ('error' in evalAfter) return { error: evalAfter.error }
        graded = gradeAttempt(evalBefore, evalAfter, uci, currentCard.bestMoveUci)
      }

      // Scoped to this card and mutated in place across retries (a ref, not
      // state) so that submitting the SRS review exactly once - and knowing
      // whether an earlier attempt on this same card was wrong - survives
      // across multiple attempt() calls without forcing a re-render for
      // bookkeeping nobody renders directly.
      const progress =
        cardProgressRef.current ?? {
          cardId: currentCard.cardId,
          reviewSubmitted: false,
          hadWrongAttempt: false,
          outcomeSubmitted: false
        }
      cardProgressRef.current = progress

      if (!progress.reviewSubmitted) {
        progress.reviewSubmitted = true
        const quality = cappedQuality(graded.quality, hintUsed)
        try {
          await window.chessAPI.submitPuzzleReview(currentCard.cardId, quality)
        } catch (err) {
          // The grading verdict itself is still valid and worth showing even
          // if persisting the new SRS schedule failed - logged, not surfaced,
          // matching this app's existing precedent for storage-layer hiccups
          // elsewhere.
          console.error('Failed to persist puzzle review', err)
        }
      }

      if (graded.correct) {
        // Guarded the same way as reviewSubmitted above (read-check-set
        // before the await) so a solved card can't fire the gamification
        // outcome write twice - e.g. if giveUp() already claimed this card,
        // or attempt() itself were somehow reachable again after resolving.
        if (!progress.outcomeSubmitted) {
          progress.outcomeSubmitted = true
          void submitOutcome(resolveSolvedOutcome(progress.hadWrongAttempt, hintUsed), currentCard.classification)
        }
      } else {
        progress.hadWrongAttempt = true
      }

      return { correct: graded.correct, cpLoss: graded.cpLoss, bestMoveUci: currentCard.bestMoveUci }
    },
    [currentCard, hintUsed, submitOutcome]
  )

  const requestHint = useCallback((): void => {
    if (!currentCard) return
    setHintUsed(true)
  }, [currentCard])

  const giveUp = useCallback((): void => {
    if (!currentCard || !hintUsed) return

    // Same get-or-create-then-write-back pattern as attempt() above, so
    // giveUp() and attempt() share one CardProgress per card instead of
    // each keeping their own view of it.
    const progress =
      cardProgressRef.current ?? {
        cardId: currentCard.cardId,
        reviewSubmitted: false,
        hadWrongAttempt: false,
        outcomeSubmitted: false
      }
    cardProgressRef.current = progress

    if (progress.outcomeSubmitted) return
    progress.outcomeSubmitted = true
    void submitOutcome('gaveUp', currentCard.classification)
  }, [currentCard, hintUsed, submitOutcome])

  const next = useCallback(() => {
    setQueue((q) => {
      const rest = q.slice(1)
      // Only go back to the server once the local queue is actually
      // drained - a just-reviewed card's new dueDate is always at least
      // 1 day out (SM-2's minimum interval), so it can never legitimately
      // reappear as due within this same session. Refetching on every
      // card instead would mean re-reading and re-parsing every cached
      // game record on disk (up to ~100 files) for every single puzzle.
      if (rest.length === 0) void loadQueue()
      return rest
    })
  }, [loadQueue])

  return {
    queue,
    nextDueAt,
    currentCard,
    sessionTotal,
    stats,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  }
}

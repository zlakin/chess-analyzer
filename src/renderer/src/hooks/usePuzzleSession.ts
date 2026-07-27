import { useCallback, useEffect, useRef, useState } from 'react'
import type { MasteryNodeKey, MasteryNodeProgress, MasteryPuzzleCard, PuzzleOutcome, PuzzleStats } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'
import { gradeAttempt } from '../lib/gradeAttempt'
import type { CardProgress } from '../lib/puzzleOutcome'
import {
  resolveSolvedOutcome,
  cappedQuality,
  newCardProgress,
  claimReview,
  claimOutcome
} from '../lib/puzzleOutcome'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

/**
 * Get-or-create the CardProgress for `cardId`, writing it back to the ref.
 * Scoped to one card and mutated in place across retries (a ref, not state)
 * so the one-write-per-card claims - and whether an earlier attempt on this
 * card was wrong - survive multiple attempt()/giveUp() calls without forcing
 * a re-render for bookkeeping nobody renders directly. The cardId check
 * backstops the reset effect: progress from another card is never reused.
 */
function progressFor(ref: { current: CardProgress | null }, cardId: string): CardProgress {
  const existing = ref.current
  if (existing !== null && existing.cardId === cardId) return existing
  const fresh = newCardProgress(cardId)
  ref.current = fresh
  return fresh
}

export function usePuzzleSession(nodeKey: MasteryNodeKey): {
  queue: MasteryPuzzleCard[]
  currentCard: MasteryPuzzleCard | null
  sessionTotal: number
  stats: PuzzleStats | null
  nodeProgress: MasteryNodeProgress | null
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<MasteryPuzzleCard[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<PuzzleStats | null>(null)
  const [nodeProgressState, setNodeProgressState] = useState<MasteryNodeProgress | null>(null)
  const [hintUsed, setHintUsed] = useState(false)
  const cardProgressRef = useRef<CardProgress | null>(null)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const due = await window.chessAPI.getNodeQueue(nodeKey)
    setQueue(due)
    setSessionTotal(due.length)
    setIsLoading(false)
  }, [nodeKey])

  // A fresh node selection is a fresh session: reload its queue and drop
  // whatever the previous node's hint/progress state was.
  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  useEffect(() => {
    window.chessAPI
      .getPuzzleStats()
      .then(setStats)
      .catch((err) => {
        // Stats are a motivational extra - failing to read them just leaves
        // the stats bar hidden, same as before the first solve ever.
        console.error('Failed to load puzzle stats', err)
      })
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
        const updated = await window.chessAPI.submitPuzzleOutcome(outcome, classification, nodeKey)
        setStats(updated.stats)
        setNodeProgressState(updated.nodeProgress)
      } catch (err) {
        // Mirrors this hook's existing precedent for submitPuzzleReview below:
        // the puzzle-rating stats and mastery progress are a motivational
        // extra, not load-bearing - a failed write there shouldn't block
        // showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    [nodeKey]
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

      const progress = progressFor(cardProgressRef, currentCard.cardId)

      if (claimReview(progress)) {
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
        // Guarded the same way as the review above (read-check-set before
        // the await) so a solved card can't fire the gamification outcome
        // write twice - e.g. if giveUp() already claimed this card, or
        // attempt() itself were somehow reachable again after resolving.
        if (claimOutcome(progress)) {
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

    // Shares one CardProgress per card with attempt(), so the two can't
    // each keep their own view of what has already been written.
    const progress = progressFor(cardProgressRef, currentCard.cardId)

    // Giving up has to record an SRS review too, not just the gamification
    // outcome: without one, no SRS entry ever exists for this card, so
    // buildNodeQueue keeps synthesizing a fresh due-now state for it and
    // the same given-up card loops back forever. Quality 0 is SM-2's
    // "couldn't recall it", which puts the card a day out. The claim guard
    // preserves first-resolution-wins - a wrong attempt before the give-up
    // already submitted its own (capped) review, and that one stands.
    if (claimReview(progress)) {
      void window.chessAPI.submitPuzzleReview(currentCard.cardId, 0).catch((err) => {
        // Same precedent as attempt(): the reveal is still worth showing
        // even if persisting the new schedule failed.
        console.error('Failed to persist puzzle review', err)
      })
    }

    if (claimOutcome(progress)) {
      void submitOutcome('gaveUp', currentCard.classification)
    }
  }, [currentCard, hintUsed, submitOutcome])

  const next = useCallback(() => {
    setQueue((q) => {
      const rest = q.slice(1)
      // Only go back to the server once the local queue is actually
      // drained - a just-reviewed card's new dueDate is always at least
      // 1 day out (SM-2's minimum interval), so it can never legitimately
      // reappear as due within this same session. Refetching on every
      // card instead would mean re-reading and re-parsing every cached
      // game record on disk for every single puzzle. Because backfill
      // guarantees an unlocked node always has content, this refetch will
      // almost always find more cards to continue with rather than
      // reaching an empty state.
      if (rest.length === 0) void loadQueue()
      return rest
    })
  }, [loadQueue])

  return {
    queue,
    currentCard,
    sessionTotal,
    stats,
    nodeProgress: nodeProgressState,
    hintUsed,
    attempt,
    requestHint,
    giveUp,
    next,
    isLoading
  }
}

import { useCallback, useEffect, useState } from 'react'
import type { PuzzleCard } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'
import { gradeAttempt } from '../lib/gradeAttempt'

const PUZZLE_DEPTH = 12

export interface PuzzleAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

export function usePuzzleSession(): {
  queue: PuzzleCard[]
  nextDueAt: number | null
  currentCard: PuzzleCard | null
  attempt: (from: string, to: string) => Promise<PuzzleAttemptResult | { error: string }>
  next: () => void
  isLoading: boolean
} {
  const [queue, setQueue] = useState<PuzzleCard[]>([])
  const [nextDueAt, setNextDueAt] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadQueue = useCallback(async () => {
    setIsLoading(true)
    const result = await window.chessAPI.getPuzzleQueue()
    setQueue(result.due)
    setNextDueAt(result.nextDueAt)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const currentCard = queue[0] ?? null

  const attempt = useCallback(
    async (from: string, to: string): Promise<PuzzleAttemptResult | { error: string }> => {
      if (!currentCard) return { error: 'No puzzle to attempt.' }

      const uci = `${from}${to}`
      const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      let graded: ReturnType<typeof gradeAttempt>
      if (uci === currentCard.bestMoveUci || `${uci}q` === currentCard.bestMoveUci) {
        // Matches the recorded best move exactly - grade it a pass
        // without running a live eval at all. This also sidesteps a
        // real problem: bestMoveUci was found at the scan's depth (14),
        // but grading runs shallower (12) for speed - in a sharp,
        // tactically-loaded position (every puzzle is one, by
        // definition), that depth gap could otherwise make playing the
        // *exact recorded answer* grade as a fail.
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

      try {
        await window.chessAPI.submitPuzzleReview(currentCard.cardId, graded.quality)
      } catch (err) {
        // The grading verdict itself is still valid and worth showing
        // even if persisting the new SRS schedule failed - logged, not
        // surfaced, matching this app's existing precedent for
        // storage-layer hiccups elsewhere.
        console.error('Failed to persist puzzle review', err)
      }

      return { correct: graded.correct, cpLoss: graded.cpLoss, bestMoveUci: currentCard.bestMoveUci }
    },
    [currentCard]
  )

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

  return { queue, nextDueAt, currentCard, attempt, next, isLoading }
}

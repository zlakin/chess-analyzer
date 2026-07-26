import { useCallback, useEffect, useState } from 'react'
import type { PuzzleCard } from '../../../shared/types'
import { computeMoveEvalDelta } from '../../../shared/engineMath'
import { tryMove } from '../lib/tryMove'
import { cpLossToQuality } from '../lib/cpLossToQuality'

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

      const fenAfterAttempt = tryMove(currentCard.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      const [evalBefore, evalAfter] = await Promise.all([
        window.chessAPI.evaluatePosition(currentCard.fenBefore, PUZZLE_DEPTH),
        window.chessAPI.evaluatePosition(fenAfterAttempt, PUZZLE_DEPTH)
      ])
      if ('error' in evalBefore) return { error: evalBefore.error }
      if ('error' in evalAfter) return { error: evalAfter.error }

      const { cpLoss } = computeMoveEvalDelta(evalBefore, evalAfter, `${from}${to}`)
      const quality = cpLossToQuality(cpLoss)
      try {
        await window.chessAPI.submitPuzzleReview(currentCard.cardId, quality)
      } catch (err) {
        // The grading verdict itself is still valid and worth showing even
        // if persisting the new SRS schedule failed - the user did get
        // real feedback, only the "when do I see this again" bookkeeping
        // is at risk. Logged, not surfaced, matching this app's existing
        // precedent for storage-layer hiccups elsewhere.
        console.error('Failed to persist puzzle review', err)
      }

      return { correct: quality >= 3, cpLoss, bestMoveUci: currentCard.bestMoveUci }
    },
    [currentCard]
  )

  // Deliberately does NOT refetch the queue - if it did, a card that just
  // passed could drop out (or the whole queue reorder) while its pass/fail
  // feedback is still on screen, snapping the board to a different puzzle
  // out from under the user before they've clicked "Next". next() (below)
  // is the point where the user has said they're done looking at this
  // card, so that's when it's safe to advance and reconcile with the
  // server's state.
  const next = useCallback(() => {
    setQueue((q) => q.slice(1))
    void loadQueue()
  }, [loadQueue])

  return { queue, nextDueAt, currentCard, attempt, next, isLoading }
}

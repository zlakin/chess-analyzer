import { useCallback, useRef, useState } from 'react'
import type { MistakeDetail, PuzzleOutcome } from '../../../shared/types'
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

const ATTEMPT_DEPTH = 12

export interface MistakeAttemptResult {
  correct: boolean
  cpLoss: number
  bestMoveUci: string
}

export function useMistakeAttempt(detail: MistakeDetail): {
  hintUsed: boolean
  attempt: (from: string, to: string) => Promise<MistakeAttemptResult | { error: string }>
  requestHint: () => void
  giveUp: () => void
} {
  const [hintUsed, setHintUsed] = useState(false)
  // One card for this hook's whole lifetime (unlike usePuzzleSession's ref,
  // which resets across queue advances) - initialized once, not in an effect.
  const progressRef = useRef<CardProgress>(newCardProgress(detail.cardId))

  const submitOutcome = useCallback(
    async (outcome: PuzzleOutcome): Promise<void> => {
      try {
        await window.chessAPI.submitPuzzleOutcome(outcome, detail.classification, detail.nodeKey)
      } catch (err) {
        // Mirrors usePuzzleSession's precedent: the puzzle-rating/mastery
        // update is a motivational extra, not load-bearing - a failed write
        // here shouldn't block showing the player their result.
        console.error('Failed to persist puzzle outcome', err)
      }
    },
    [detail.classification, detail.nodeKey]
  )

  const attempt = useCallback(
    async (from: string, to: string): Promise<MistakeAttemptResult | { error: string }> => {
      const uci = `${from}${to}`
      const fenAfterAttempt = tryMove(detail.fenBefore, from, to)
      if (!fenAfterAttempt) return { error: 'Illegal move.' }

      let graded: ReturnType<typeof gradeAttempt>
      if (uci === detail.bestMoveUci || `${uci}q` === detail.bestMoveUci) {
        // Same depth-mismatch rationale as usePuzzleSession: bestMoveUci was
        // found by the original scan at a higher depth than live grading
        // runs at, so re-evaluating the exact recorded answer could
        // otherwise wrongly fail it.
        graded = { correct: true, cpLoss: 0, quality: 5 }
      } else {
        const [evalBefore, evalAfter] = await Promise.all([
          window.chessAPI.evaluatePosition(detail.fenBefore, ATTEMPT_DEPTH),
          window.chessAPI.evaluatePosition(fenAfterAttempt, ATTEMPT_DEPTH)
        ])
        if ('error' in evalBefore) return { error: evalBefore.error }
        if ('error' in evalAfter) return { error: evalAfter.error }
        graded = gradeAttempt(evalBefore, evalAfter, uci, detail.bestMoveUci)
      }

      const progress = progressRef.current

      if (claimReview(progress)) {
        const quality = cappedQuality(graded.quality, hintUsed)
        try {
          await window.chessAPI.submitPuzzleReview(detail.cardId, quality)
        } catch (err) {
          console.error('Failed to persist puzzle review', err)
        }
      }

      if (graded.correct) {
        if (claimOutcome(progress)) {
          void submitOutcome(resolveSolvedOutcome(progress.hadWrongAttempt, hintUsed))
        }
      } else {
        progress.hadWrongAttempt = true
      }

      return { correct: graded.correct, cpLoss: graded.cpLoss, bestMoveUci: detail.bestMoveUci }
    },
    [detail, hintUsed, submitOutcome]
  )

  const requestHint = useCallback((): void => {
    setHintUsed(true)
  }, [])

  const giveUp = useCallback((): void => {
    if (!hintUsed) return
    const progress = progressRef.current

    if (claimReview(progress)) {
      void window.chessAPI.submitPuzzleReview(detail.cardId, 0).catch((err) => {
        console.error('Failed to persist puzzle review', err)
      })
    }

    if (claimOutcome(progress)) {
      void submitOutcome('gaveUp')
    }
  }, [detail.cardId, hintUsed, submitOutcome])

  return { hintUsed, attempt, requestHint, giveUp }
}

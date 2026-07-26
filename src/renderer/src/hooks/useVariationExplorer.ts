import { useCallback, useEffect, useRef, useState } from 'react'
import type { PositionEvaluation } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'

const EXPLORATION_DEPTH = 12

interface EvaluatedPosition {
  fen: string
  evaluation: PositionEvaluation
}

export function useVariationExplorer(baseFen: string): {
  isExploring: boolean
  currentFen: string
  sideToMove: 'w' | 'b'
  evaluation: PositionEvaluation | null
  isEvaluating: boolean
  makeMove: (from: string, to: string) => boolean
  undoLastMove: () => void
  exitExploration: () => void
} {
  const [scratchHistory, setScratchHistory] = useState<string[]>([])
  const [evaluated, setEvaluated] = useState<EvaluatedPosition | null>(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const requestIdRef = useRef(0)

  // Real-game navigation changed baseFen out from under us - any
  // in-progress exploration is relative to a position that's no longer
  // being viewed, so it's cleared rather than left dangling.
  useEffect(() => {
    setScratchHistory([])
    setEvaluated(null)
  }, [baseFen])

  const currentFen = scratchHistory[scratchHistory.length - 1] ?? baseFen
  const isExploring = scratchHistory.length > 0
  const sideToMove: 'w' | 'b' = currentFen.split(' ')[1] === 'b' ? 'b' : 'w'
  // Only ever expose an evaluation that was computed for the exact position
  // being shown right now - a stale eval for a position we've since moved
  // away from (or stopped exploring) is worse than no eval, since it reads
  // as current and, being relative to the old side-to-move, can be
  // sign-inverted against the new one.
  const evaluation = evaluated?.fen === currentFen ? evaluated.evaluation : null

  useEffect(() => {
    if (!isExploring) return
    const requestId = ++requestIdRef.current
    setIsEvaluating(true)
    window.chessAPI.evaluatePosition(currentFen, EXPLORATION_DEPTH).then((result) => {
      // A newer move superseded this request while it was in flight -
      // discard the now-stale response rather than overwrite a newer one.
      if (requestIdRef.current !== requestId) return
      setIsEvaluating(false)
      if ('error' in result) return
      setEvaluated({ fen: currentFen, evaluation: result })
    })
  }, [currentFen, isExploring])

  // If exploration ends (exitExploration, undo-to-empty, or a real-game
  // navigation clearing scratchHistory) while a request from the effect
  // above is still in flight, that effect's own isEvaluating reset never
  // runs - it's gated behind `if (!isExploring) return`, above, which now
  // fires for the *next* run instead. Without this, isEvaluating would
  // stay stuck true indefinitely (or until some later, unrelated
  // exploration's request happens to resolve).
  useEffect(() => {
    if (!isExploring) setIsEvaluating(false)
  }, [isExploring])

  const makeMove = useCallback(
    (from: string, to: string): boolean => {
      const nextFen = tryMove(currentFen, from, to)
      if (!nextFen) return false
      setScratchHistory((history) => [...history, nextFen])
      return true
    },
    [currentFen]
  )

  const undoLastMove = useCallback(() => {
    setScratchHistory((history) => history.slice(0, -1))
  }, [])

  const exitExploration = useCallback(() => {
    setScratchHistory([])
    setEvaluated(null)
  }, [])

  return {
    isExploring,
    currentFen,
    sideToMove,
    evaluation,
    isEvaluating,
    makeMove,
    undoLastMove,
    exitExploration
  }
}

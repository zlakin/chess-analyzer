import { useCallback, useEffect, useRef, useState } from 'react'
import type { PositionEvaluation } from '../../../shared/types'
import { tryMove } from '../lib/tryMove'

const EXPLORATION_DEPTH = 12

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
  const [evaluation, setEvaluation] = useState<PositionEvaluation | null>(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const requestIdRef = useRef(0)

  // Real-game navigation changed baseFen out from under us - any
  // in-progress exploration is relative to a position that's no longer
  // being viewed, so it's cleared rather than left dangling.
  useEffect(() => {
    setScratchHistory([])
    setEvaluation(null)
  }, [baseFen])

  const currentFen = scratchHistory[scratchHistory.length - 1] ?? baseFen
  const isExploring = scratchHistory.length > 0
  const sideToMove: 'w' | 'b' = currentFen.split(' ')[1] === 'b' ? 'b' : 'w'

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
      setEvaluation(result)
    })
  }, [currentFen, isExploring])

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
    setEvaluation(null)
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

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AnalyzedPosition } from '../../../shared/types'
import { analysisReducer, INITIAL_STATE } from '../lib/analysisReducer'

export function useGameAnalysis(): {
  state: ReturnType<typeof analysisReducer>
  startAnalysis: (positions: AnalyzedPosition[], depth?: number) => Promise<void>
  cancelAnalysis: () => void
  reset: () => void
} {
  const [state, dispatch] = useReducer(analysisReducer, INITIAL_STATE)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  // Mirrors the main process's AnalysisRunTracker: identifies which run a
  // resolved `analyzeGame` promise belongs to, so a run the UI has already
  // moved on from cannot dispatch its terminal state onto the current one.
  const runIdRef = useRef(0)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.chessAPI) {
      unsubscribeRef.current = window.chessAPI.onAnalysisProgress((move) => {
        dispatch({ type: 'MOVE_PROGRESS', move })
      })
    }
    return () => unsubscribeRef.current?.()
  }, [])

  const startAnalysis = useCallback(async (positions: AnalyzedPosition[], depth = 18) => {
    const runId = ++runIdRef.current
    dispatch({ type: 'START', positions })
    const result = await window.chessAPI.analyzeGame(positions, depth)
    // Discarded by a reset ("New Game") or superseded by a newer import while
    // this run was still in flight - its outcome is no longer the UI's state.
    if (runId !== runIdRef.current) return
    if ('error' in result) {
      dispatch({ type: 'ERROR', message: result.error })
    } else if ('cancelled' in result) {
      dispatch({ type: 'CANCELLED' })
    } else {
      dispatch({ type: 'COMPLETE', result })
    }
  }, [])

  const cancelAnalysis = useCallback(() => {
    window.chessAPI.cancelAnalysis()
  }, [])

  const reset = useCallback(() => {
    runIdRef.current++
    dispatch({ type: 'RESET' })
  }, [])

  return { state, startAnalysis, cancelAnalysis, reset }
}

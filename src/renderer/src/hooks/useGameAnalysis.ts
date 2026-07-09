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

  useEffect(() => {
    unsubscribeRef.current = window.chessAPI.onAnalysisProgress((move) => {
      dispatch({ type: 'MOVE_PROGRESS', move })
    })
    return () => unsubscribeRef.current?.()
  }, [])

  const startAnalysis = useCallback(async (positions: AnalyzedPosition[], depth = 18) => {
    dispatch({ type: 'START', positions })
    const result = await window.chessAPI.analyzeGame(positions, depth)
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

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  return { state, startAnalysis, cancelAnalysis, reset }
}

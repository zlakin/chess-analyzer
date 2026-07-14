import { useCallback, useEffect, useRef, useState } from 'react'
import type { InsightsReport, ScanProgress } from '../../../shared/types'

export type InsightsScanStatus = 'idle' | 'scanning' | 'error' | 'cancelled'

interface InsightsScanState {
  status: InsightsScanStatus
  progress: ScanProgress | null
  error: string | null
  report: InsightsReport | null
}

const INITIAL_STATE: InsightsScanState = { status: 'idle', progress: null, error: null, report: null }

export function useInsightsScan(): {
  state: InsightsScanState
  startScan: () => Promise<void>
  cancelScan: () => void
} {
  const [state, setState] = useState<InsightsScanState>(INITIAL_STATE)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  const loadReport = useCallback(async () => {
    const report = await window.chessAPI.getInsightsReport()
    setState((prev) => ({ ...prev, report }))
  }, [])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  useEffect(() => {
    unsubscribeRef.current = window.chessAPI.onScanProgress((progress) => {
      setState((prev) => ({ ...prev, progress }))
    })
    return () => unsubscribeRef.current?.()
  }, [])

  const startScan = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'scanning', error: null, progress: { scanned: 0, total: 0 } }))
    const result = await window.chessAPI.scanChessComGames()

    if ('error' in result) {
      setState((prev) => ({ ...prev, status: 'error', error: result.error }))
      return
    }
    if ('cancelled' in result) {
      setState((prev) => ({ ...prev, status: 'cancelled' }))
      return
    }

    await loadReport()
    setState((prev) => ({ ...prev, status: 'idle' }))
  }, [loadReport])

  const cancelScan = useCallback(() => {
    window.chessAPI.cancelScan()
  }, [])

  return { state, startScan, cancelScan }
}

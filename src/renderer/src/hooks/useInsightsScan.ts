import { useCallback, useEffect, useRef, useState } from 'react'
import type { InsightsReport, ScanOutcome, ScanProgress } from '../../../shared/types'

export type InsightsScanStatus = 'idle' | 'scanning' | 'error' | 'cancelled'

export interface InsightsScanState {
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

    let result: ScanOutcome
    try {
      result = await window.chessAPI.scanChessComGames()
    } catch (err) {
      // Games analyzed before the failure are already durably cached (see
      // scanRunner.ts), so reload the report even on an unhandled IPC
      // rejection -- otherwise partial progress stays invisible until the
      // next successful scan or an app restart, and status would
      // otherwise be stuck at 'scanning' forever with no recovery path.
      await loadReport()
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Scan failed unexpectedly'
      }))
      return
    }

    if ('error' in result) {
      await loadReport()
      setState((prev) => ({ ...prev, status: 'error', error: result.error }))
      return
    }
    if ('cancelled' in result) {
      await loadReport()
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

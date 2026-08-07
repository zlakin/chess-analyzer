import { useRef, useState } from 'react'
import type { InsightsScanState } from '../hooks/useInsightsScan'
import type { MistakeDetail } from '../../../shared/types'
import { TopFindingsList } from './insights/TopFindingsList'
import { BucketTabs } from './insights/BucketTabs'
import { MistakeCoachModal } from './MistakeCoachModal'
import { scanStatusLine } from '../lib/scanStatusLine'

interface InsightsTabProps {
  state: InsightsScanState
  startScan: () => Promise<void>
  cancelScan: () => void
}

function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes >= 1) return `~${minutes} min`
  return `~${Math.max(1, Math.round(ms / 1000))} sec`
}

export function InsightsTab({ state, startScan, cancelScan }: InsightsTabProps): JSX.Element {
  const hasReport = state.report !== null && state.report.gamesScanned > 0
  // Deliberately outside the hasReport branch below: a schema bump filters
  // every cached record out of the aggregates, so this line is all that stands
  // between the user and a tab that silently went blank after an update.
  const status = scanStatusLine({
    lastScanTime: state.report?.lastScanTime ?? null,
    gamesScanned: state.report?.gamesScanned ?? 0,
    staleSchema: state.report?.staleSchema ?? false,
    now: Date.now()
  })

  const [selectedMistake, setSelectedMistake] = useState<{ gameUrl: string; ply: number } | null>(null)
  const [mistakeDetail, setMistakeDetail] = useState<MistakeDetail | null>(null)
  const mistakeRequestRef = useRef(0)

  const handleSelectMistake = (gameUrl: string, ply: number): void => {
    const requestId = ++mistakeRequestRef.current
    setSelectedMistake({ gameUrl, ply })
    setMistakeDetail(null)
    window.chessAPI
      .getMistakeDetail(gameUrl, ply)
      .then((detail) => {
        if (requestId !== mistakeRequestRef.current) return
        if (detail === null) {
          setSelectedMistake(null)
          return
        }
        setMistakeDetail(detail)
      })
      .catch((err) => {
        if (requestId === mistakeRequestRef.current) setSelectedMistake(null)
        console.error('Failed to load mistake detail', err)
      })
  }

  const handleCloseMistake = (): void => {
    setSelectedMistake(null)
    setMistakeDetail(null)
  }

  return (
    <div className="insights-tab">
      <div className="insights-header">
        <span className={`insights-last-scan${status.stale ? ' stale' : ''}`}>{status.text}</span>

        {state.status === 'scanning' ? (
          <div className="insights-scan-progress">
            <span>
              Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
              {state.progress?.etaMs != null && ` · ${formatEta(state.progress.etaMs)} remaining`}
            </span>
            <progress value={state.progress?.scanned ?? 0} max={state.progress?.total || 1} />
            <button className="button-secondary" onClick={cancelScan}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="button-primary" onClick={() => void startScan()}>
            {hasReport ? 'Rescan' : 'Scan my games'}
          </button>
        )}
      </div>

      {state.status === 'error' && <div className="import-error">{state.error}</div>}
      {state.status === 'cancelled' && <div className="import-error">Scan cancelled.</div>}

      {!hasReport && state.status !== 'scanning' && (
        <p className="insights-empty-message">Scan your games to see patterns in your play.</p>
      )}

      {hasReport && state.report && (
        <div className="insights-report">
          <TopFindingsList findings={state.report.topFindings} />
          <BucketTabs buckets={state.report.buckets} onSelectMistake={handleSelectMistake} />
        </div>
      )}

      {selectedMistake && mistakeDetail && (
        <MistakeCoachModal detail={mistakeDetail} onClose={handleCloseMistake} />
      )}
    </div>
  )
}

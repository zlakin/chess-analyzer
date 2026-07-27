import type { InsightsScanState } from '../hooks/useInsightsScan'
import { TopFindingsList } from './insights/TopFindingsList'
import { BucketTabs } from './insights/BucketTabs'
import { formatRelativeTime } from '../lib/relativeTime'

interface InsightsTabProps {
  state: InsightsScanState
  startScan: () => Promise<void>
  cancelScan: () => void
}

// A scan older than this no longer reflects "recent" play - the last-scan
// line switches to a warning tone and nudges toward rescanning instead of
// just reporting a fact the user has to notice is stale themselves.
const STALE_SCAN_MS = 24 * 60 * 60 * 1000

export function InsightsTab({ state, startScan, cancelScan }: InsightsTabProps): JSX.Element {
  const hasReport = state.report !== null && state.report.gamesScanned > 0
  const lastScanTime = state.report?.lastScanTime ?? null
  const isStale = lastScanTime !== null && Date.now() - lastScanTime > STALE_SCAN_MS

  return (
    <div className="insights-tab">
      <div className="insights-header">
        <span className={`insights-last-scan${isStale ? ' stale' : ''}`}>
          {lastScanTime
            ? `Scanned ${formatRelativeTime(lastScanTime)} · ${state.report?.gamesScanned} games${isStale ? ' — rescan to catch up' : ''}`
            : 'No scan yet'}
        </span>

        {state.status === 'scanning' ? (
          <div className="insights-scan-progress">
            <span>
              Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
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
          <BucketTabs buckets={state.report.buckets} />
        </div>
      )}
    </div>
  )
}

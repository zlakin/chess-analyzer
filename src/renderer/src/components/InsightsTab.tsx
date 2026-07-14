import { useInsightsScan } from '../hooks/useInsightsScan'
import { TopFindingsList } from './insights/TopFindingsList'
import { TimeControlSection } from './insights/TimeControlSection'

export function InsightsTab(): JSX.Element {
  const { state, startScan, cancelScan } = useInsightsScan()

  const hasReport = state.report !== null && state.report.gamesScanned > 0

  return (
    <div className="insights-tab">
      <div className="insights-header">
        <span className="insights-last-scan">
          {state.report?.lastScanTime
            ? `Last scanned ${new Date(state.report.lastScanTime).toLocaleString()} · ${state.report.gamesScanned} games`
            : 'No scan yet'}
        </span>

        {state.status === 'scanning' ? (
          <div className="insights-scan-progress">
            <span>
              Scanning... {state.progress?.scanned ?? 0} / {state.progress?.total ?? 0}
            </span>
            <button onClick={cancelScan}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => void startScan()}>{hasReport ? 'Rescan' : 'Scan my games'}</button>
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
          <div className="insights-buckets">
            {state.report.buckets.map((bucket) => (
              <TimeControlSection key={bucket.key} bucket={bucket} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

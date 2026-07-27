import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { InsightsBucket, TacticType } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'
import { RecentMistakesList } from './RecentMistakesList'

interface TimeControlSectionProps {
  bucket: InsightsBucket
}

const RECENT_MISTAKES_PREVIEW_COUNT = 5

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--panel-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-control)',
    fontSize: '0.8rem'
  },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { color: 'var(--text-muted)' }
}

export function TimeControlSection({ bucket }: TimeControlSectionProps): JSX.Element {
  const [showAllMistakes, setShowAllMistakes] = useState(false)

  if (!bucket.hasEnoughData) {
    return (
      <div className="time-control-section time-control-section-empty">
        <p className="not-enough-data">Not enough games yet ({bucket.gamesCount} scanned).</p>
      </div>
    )
  }

  const phaseData = [
    { phase: 'Opening', count: bucket.phaseBreakdown.opening },
    { phase: 'Middlegame', count: bucket.phaseBreakdown.middlegame },
    { phase: 'Endgame', count: bucket.phaseBreakdown.endgame }
  ]

  const tacticEntries = (Object.entries(bucket.tacticBreakdown) as Array<[TacticType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  const visibleMistakes = showAllMistakes
    ? bucket.recentMistakes
    : bucket.recentMistakes.slice(0, RECENT_MISTAKES_PREVIEW_COUNT)
  const hiddenMistakesCount = bucket.recentMistakes.length - visibleMistakes.length

  return (
    <div className="time-control-section">
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.timePressureCount} under time pressure
      </p>

      {tacticEntries.length > 0 && (
        <div className="tactic-chip-row">
          {tacticEntries.map(([tag, count]) => (
            <span key={tag} className="tactic-chip">
              {TACTIC_LABELS[tag]} &times;{count}
            </span>
          ))}
        </div>
      )}

      <h4 className="insights-subheading">Mistakes by phase</h4>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={phaseData}>
          <XAxis dataKey="phase" stroke="var(--text-muted)" />
          <YAxis allowDecimals={false} stroke="var(--text-muted)" />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
          <Bar dataKey="count" fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>

      {bucket.weakOpenings.length > 0 && (
        <>
          <h4 className="insights-subheading">Weak openings</h4>
          <table className="weak-openings-table">
            <thead>
              <tr>
                <th>Opening</th>
                <th>Games</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {bucket.weakOpenings.map((opening) => (
                <tr key={opening.name}>
                  <td>{opening.name}</td>
                  <td>{opening.games}</td>
                  <td>{opening.accuracy.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {bucket.trend.length > 1 && (
        <>
          <h4 className="insights-subheading">Accuracy trend</h4>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={bucket.trend}>
              <XAxis dataKey="gameIndex" hide />
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)}%` : '')}
              />
              <Area
                type="monotone"
                dataKey="rollingAccuracy"
                stroke="var(--accent)"
                fill="var(--accent)"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {bucket.recentMistakes.length > 0 && (
        <>
          <h4 className="insights-subheading">Recent mistakes</h4>
          <RecentMistakesList mistakes={visibleMistakes} />
          {hiddenMistakesCount > 0 && (
            <button className="button-secondary show-more-mistakes" onClick={() => setShowAllMistakes(true)}>
              Show {hiddenMistakesCount} more
            </button>
          )}
        </>
      )}
    </div>
  )
}

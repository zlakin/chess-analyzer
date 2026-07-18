import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import type { InsightsBucket } from '../../../../shared/types'

interface TimeControlSectionProps {
  bucket: InsightsBucket
}

const BUCKET_LABELS: Record<InsightsBucket['key'], string> = {
  overall: 'Overall',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Daily'
}

export function TimeControlSection({ bucket }: TimeControlSectionProps): JSX.Element {
  if (!bucket.hasEnoughData) {
    return (
      <div className="time-control-section">
        <h3>{BUCKET_LABELS[bucket.key]}</h3>
        <p className="not-enough-data">Not enough games yet ({bucket.gamesCount} scanned).</p>
      </div>
    )
  }

  const phaseData = [
    { phase: 'Opening', count: bucket.phaseBreakdown.opening },
    { phase: 'Middlegame', count: bucket.phaseBreakdown.middlegame },
    { phase: 'Endgame', count: bucket.phaseBreakdown.endgame }
  ]

  return (
    <div className="time-control-section">
      <h3>{BUCKET_LABELS[bucket.key]}</h3>
      <p className="bucket-summary">
        {bucket.gamesCount} games &middot; {bucket.totalMistakes} mistakes/blunders &middot;{' '}
        {bucket.hungPieceCount} hung a piece &middot; {bucket.timePressureCount} under time pressure
      </p>

      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={phaseData}>
          <XAxis dataKey="phase" stroke="var(--text-muted)" />
          <YAxis allowDecimals={false} stroke="var(--text-muted)" />
          <Tooltip />
          <Bar dataKey="count" fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>

      {bucket.weakOpenings.length > 0 && (
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
      )}

      {bucket.trend.length > 1 && (
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={bucket.trend}>
            <XAxis dataKey="gameIndex" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip formatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)}%` : '')} />
            <Area
              type="monotone"
              dataKey="rollingAccuracy"
              stroke="var(--accent)"
              fill="var(--accent)"
              fillOpacity={0.3}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

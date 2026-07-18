import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface GameSummaryProps {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
  whiteUsername: string
  blackUsername: string
}

const CLASSIFICATIONS_TO_SHOW: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder'
]

const ALL_CLASSIFICATIONS_FOR_LEGEND: MoveClassification[] = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder'
]

function countByClassification(
  moves: AnalyzedMove[],
  color: 'w' | 'b'
): Record<MoveClassification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS_TO_SHOW.map((c) => [c, 0])) as Record<
    MoveClassification,
    number
  >
  for (const move of moves) {
    if (move.color === color && move.classification in counts) {
      counts[move.classification] += 1
    }
  }
  return counts
}

export function GameSummary({
  moves,
  whiteAccuracy,
  blackAccuracy,
  whiteUsername,
  blackUsername
}: GameSummaryProps): JSX.Element {
  const whiteCounts = countByClassification(moves, 'w')
  const blackCounts = countByClassification(moves, 'b')

  const barData = [
    { player: whiteUsername, ...whiteCounts },
    { player: blackUsername, ...blackCounts }
  ]

  return (
    <div className="game-summary">
      <div className="accuracy-scorecards">
        <div className="accuracy-scorecard">
          <span className="accuracy-scorecard-value">{whiteAccuracy.toFixed(1)}%</span>
          <span className="accuracy-scorecard-label">{whiteUsername}</span>
        </div>
        <div className="accuracy-scorecard">
          <span className="accuracy-scorecard-value">{blackAccuracy.toFixed(1)}%</span>
          <span className="accuracy-scorecard-label">{blackUsername}</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="player" hide />
          <Tooltip cursor={{ fill: 'transparent' }} />
          {CLASSIFICATIONS_TO_SHOW.map((classification) => (
            <Bar
              key={classification}
              dataKey={classification}
              stackId="quality"
              fill={MOVE_CLASSIFICATION_STYLE[classification].color}
              name={MOVE_CLASSIFICATION_STYLE[classification].label}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <ul className="classification-legend">
        {ALL_CLASSIFICATIONS_FOR_LEGEND.map((classification) => {
          const style = MOVE_CLASSIFICATION_STYLE[classification]
          const Icon = style.icon
          return (
            <li key={classification} className="classification-legend-item">
              <Icon size={13} style={{ color: style.color }} />
              <span>{style.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

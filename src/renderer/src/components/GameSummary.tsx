import { memo } from 'react'
import type { AnalyzedMove, MoveClassification } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface GameSummaryProps {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
  whiteUsername: string
  blackUsername: string
  openingName: string | null
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

export const GameSummary = memo(function GameSummary({
  moves,
  whiteAccuracy,
  blackAccuracy,
  whiteUsername,
  blackUsername,
  openingName
}: GameSummaryProps): JSX.Element {
  const whiteCounts = countByClassification(moves, 'w')
  const blackCounts = countByClassification(moves, 'b')
  // Only classifications that actually occurred get a row - an 8-row table
  // with mostly zeros is noise, not information, and chess.com's own report
  // only lists what happened in this specific game.
  const rows = CLASSIFICATIONS_TO_SHOW.filter(
    (classification) => whiteCounts[classification] > 0 || blackCounts[classification] > 0
  )

  return (
    <div className="game-summary">
      {openingName && <p className="game-summary-opening">{openingName}</p>}

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

      <table className="classification-breakdown">
        <tbody>
          {rows.map((classification) => {
            const style = MOVE_CLASSIFICATION_STYLE[classification]
            const Icon = style.icon
            return (
              <tr key={classification}>
                <td className="classification-breakdown-count">{whiteCounts[classification]}</td>
                <td className="classification-breakdown-label">
                  <Icon size={13} style={{ color: style.color }} />
                  <span>{style.label}</span>
                </td>
                <td className="classification-breakdown-count">{blackCounts[classification]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
})

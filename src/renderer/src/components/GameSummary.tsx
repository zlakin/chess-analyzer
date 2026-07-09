import type { AnalyzedMove, MoveClassification } from '../../../shared/types'

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

  return (
    <div className="game-summary">
      <div className="accuracy-row">
        <span>
          {whiteUsername}: {whiteAccuracy.toFixed(1)}% accuracy
        </span>
        <span>
          {blackUsername}: {blackAccuracy.toFixed(1)}% accuracy
        </span>
      </div>
      <table className="classification-table">
        <thead>
          <tr>
            <th>Move Quality</th>
            <th>{whiteUsername}</th>
            <th>{blackUsername}</th>
          </tr>
        </thead>
        <tbody>
          {CLASSIFICATIONS_TO_SHOW.map((classification) => (
            <tr key={classification}>
              <td>{classification}</td>
              <td>{whiteCounts[classification]}</td>
              <td>{blackCounts[classification]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

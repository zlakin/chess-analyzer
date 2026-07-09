import type { AnalyzedMove, MoveClassification } from '../../../shared/types'

interface MoveListProps {
  moves: AnalyzedMove[]
  currentPly: number
  onSelectPly: (ply: number) => void
}

interface MoveRow {
  moveNumber: number
  white?: AnalyzedMove
  black?: AnalyzedMove
}

const CLASSIFICATION_LABELS: Record<MoveClassification, string> = {
  book: 'Book',
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder'
}

export function MoveList({ moves, currentPly, onSelectPly }: MoveListProps): JSX.Element {
  const rows: MoveRow[] = []
  for (const move of moves) {
    const row = rows[move.moveNumber - 1] ?? { moveNumber: move.moveNumber }
    if (move.color === 'w') row.white = move
    else row.black = move
    rows[move.moveNumber - 1] = row
  }

  return (
    <ol className="move-list">
      {rows.map((row) => (
        <li key={row.moveNumber} className="move-row">
          <span className="move-number">{row.moveNumber}.</span>
          {row.white && (
            <button
              className={`move ${row.white.classification} ${row.white.ply === currentPly ? 'selected' : ''}`}
              onClick={() => onSelectPly(row.white!.ply)}
              title={CLASSIFICATION_LABELS[row.white.classification]}
            >
              {row.white.san}
            </button>
          )}
          {row.black && (
            <button
              className={`move ${row.black.classification} ${row.black.ply === currentPly ? 'selected' : ''}`}
              onClick={() => onSelectPly(row.black!.ply)}
              title={CLASSIFICATION_LABELS[row.black.classification]}
            >
              {row.black.san}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

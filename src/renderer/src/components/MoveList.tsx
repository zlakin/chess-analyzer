import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

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

function MoveButton({
  move,
  isSelected,
  onSelect
}: {
  move: AnalyzedMove
  isSelected: boolean
  onSelect: () => void
}): JSX.Element {
  const style = MOVE_CLASSIFICATION_STYLE[move.classification]
  const Icon = style.icon
  return (
    <button
      className={`move ${move.classification}${isSelected ? ' selected' : ''}`}
      onClick={onSelect}
      title={style.label}
    >
      <Icon size={12} className="move-icon" style={{ color: style.color }} />
      <span className="move-san" style={{ color: style.color }}>
        {move.san}
      </span>
    </button>
  )
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
            <MoveButton
              move={row.white}
              isSelected={row.white.ply === currentPly}
              onSelect={() => onSelectPly(row.white!.ply)}
            />
          )}
          {row.black && (
            <MoveButton
              move={row.black}
              isSelected={row.black.ply === currentPly}
              onSelect={() => onSelectPly(row.black!.ply)}
            />
          )}
        </li>
      ))}
    </ol>
  )
}

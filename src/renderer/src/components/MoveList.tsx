import { memo, useMemo } from 'react'
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

const MoveButton = memo(function MoveButton({
  move,
  ply,
  isSelected,
  onSelectPly
}: {
  move: AnalyzedMove
  ply: number
  isSelected: boolean
  onSelectPly: (ply: number) => void
}): JSX.Element {
  const style = MOVE_CLASSIFICATION_STYLE[move.classification]
  const Icon = style.icon
  return (
    <button
      className={`move ${move.classification}${isSelected ? ' selected' : ''}`}
      onClick={() => onSelectPly(ply)}
      title={style.label}
    >
      <Icon size={12} className="move-icon" style={{ color: style.color }} />
      <span className="move-san" style={{ color: style.color }}>
        {move.san}
      </span>
    </button>
  )
})

export const MoveList = memo(function MoveList({
  moves,
  currentPly,
  onSelectPly
}: MoveListProps): JSX.Element {
  // Grouping into rows depends only on `moves`, never on `currentPly` - so a
  // pure ply-navigation render (the common case) reuses the same row
  // structure instead of rebuilding it, same principle as memoizing the
  // MoveButton children below.
  const rows: MoveRow[] = useMemo(() => {
    const result: MoveRow[] = []
    for (const move of moves) {
      const row = result[move.moveNumber - 1] ?? { moveNumber: move.moveNumber }
      if (move.color === 'w') row.white = move
      else row.black = move
      result[move.moveNumber - 1] = row
    }
    return result
  }, [moves])

  return (
    <ol className="move-list">
      {rows.map((row) => (
        <li key={row.moveNumber} className="move-row">
          <span className="move-number">{row.moveNumber}.</span>
          {row.white && (
            <MoveButton
              move={row.white}
              ply={row.white.ply}
              isSelected={row.white.ply === currentPly}
              onSelectPly={onSelectPly}
            />
          )}
          {row.black && (
            <MoveButton
              move={row.black}
              ply={row.black.ply}
              isSelected={row.black.ply === currentPly}
              onSelectPly={onSelectPly}
            />
          )}
        </li>
      ))}
    </ol>
  )
})

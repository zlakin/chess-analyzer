import { useMemo } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, SquareRenderer } from 'react-chessboard'
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
  currentMove: AnalyzedMove | null
}

export function Board({ fen, bestMoveUci, currentMove }: BoardProps): JSX.Element {
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'rgb(21, 128, 61)'
        }
      ]
    : []

  const badgeSquare = currentMove ? currentMove.moveUci.slice(2, 4) : null
  const badgeStyle = currentMove ? MOVE_CLASSIFICATION_STYLE[currentMove.classification] : null

  const squareRenderer: SquareRenderer = useMemo(() => {
    return ({ square, children }) => {
      const showBadge = badgeSquare !== null && badgeStyle !== null && square === badgeSquare
      const BadgeIcon = badgeStyle?.icon
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {children}
          {showBadge && badgeStyle && BadgeIcon && (
            <span
              className="board-move-badge"
              style={{ backgroundColor: badgeStyle.color }}
              title={badgeStyle.label}
            >
              <BadgeIcon size={12} strokeWidth={2.5} color="var(--accent-contrast)" />
            </span>
          )}
        </div>
      )
    }
  }, [badgeSquare, badgeStyle])

  return (
    <div className="board-container">
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          arrows,
          boardOrientation: 'white',
          squareRenderer
        }}
      />
    </div>
  )
}

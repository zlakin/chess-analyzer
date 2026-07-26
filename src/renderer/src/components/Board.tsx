import { memo, useEffect, useMemo, useRef } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Arrow, SquareRenderer } from 'react-chessboard'
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
  currentMove: AnalyzedMove | null
  onHeightChange?: (height: number) => void
}

export const Board = memo(function Board({
  fen,
  bestMoveUci,
  currentMove,
  onHeightChange
}: BoardProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  // .board-container is capped by both width and viewport height (see
  // app.css), so its real rendered size can't be derived from props -
  // measure it directly and report up so EvalBar (a grid sibling, not a
  // descendant) can match it instead of relying on the two staying in
  // sync via a hand-copied CSS pixel value.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onHeightChange) return
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (height) onHeightChange(height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeightChange])

  const arrows: Arrow[] = useMemo(
    () =>
      bestMoveUci
        ? [
            {
              startSquare: bestMoveUci.slice(0, 2),
              endSquare: bestMoveUci.slice(2, 4),
              color: 'var(--accent)'
            }
          ]
        : [],
    [bestMoveUci]
  )

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
    <div className="board-container" ref={containerRef}>
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
})

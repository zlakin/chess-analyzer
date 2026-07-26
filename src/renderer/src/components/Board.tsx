import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import type {
  Arrow,
  SquareRenderer,
  PieceDropHandlerArgs,
  SquareHandlerArgs,
  PieceHandlerArgs
} from 'react-chessboard'
import type { AnalyzedMove } from '../../../shared/types'
import { MOVE_CLASSIFICATION_STYLE } from '../lib/moveClassificationStyle'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
  currentMove: AnalyzedMove | null
  boardOrientation: 'white' | 'black'
  onMove: (from: string, to: string) => boolean
  onHeightChange?: (height: number) => void
}

export const Board = memo(function Board({
  fen,
  bestMoveUci,
  currentMove,
  boardOrientation,
  onMove,
  onHeightChange
}: BoardProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null)

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

  // The board's own FEN changing (a real navigation, or a successful
  // exploration move) means any in-progress click-to-move selection is
  // stale - clear it rather than let a leftover selection apply against
  // a position it was never validated for.
  useEffect(() => {
    setSelectedSquare(null)
  }, [fen])

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

  const squareStyles = useMemo(
    () => (selectedSquare ? { [selectedSquare]: { boxShadow: 'inset 0 0 0 3px var(--accent)' } } : {}),
    [selectedSquare]
  )

  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false
    return onMove(sourceSquare, targetSquare)
  }

  function handleSquareClick({ piece, square }: SquareHandlerArgs): void {
    if (selectedSquare) {
      const moved = onMove(selectedSquare, square)
      setSelectedSquare(moved ? null : piece ? square : null)
      return
    }
    if (piece) setSelectedSquare(square)
  }

  function canDragPiece({ piece }: PieceHandlerArgs): boolean {
    // pieceType is 'w'+LETTER / 'b'+LETTER (e.g. 'wP', 'bQ') - confirmed
    // against react-chessboard's actual fenToPieceCode source, not assumed.
    const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    return piece.pieceType.startsWith(sideToMove)
  }

  return (
    <div className="board-container" ref={containerRef}>
      <Chessboard
        options={{
          position: fen,
          allowDragging: true,
          canDragPiece,
          onPieceDrop: handlePieceDrop,
          onSquareClick: handleSquareClick,
          arrows,
          boardOrientation,
          squareRenderer,
          squareStyles
        }}
      />
    </div>
  )
})

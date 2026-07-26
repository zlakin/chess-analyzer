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
  hintSquare?: string | null
}

export const Board = memo(function Board({
  fen,
  bestMoveUci,
  currentMove,
  boardOrientation,
  onMove,
  onHeightChange,
  hintSquare = null
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

  const squareStyles = useMemo(() => {
    const styles: Record<string, { boxShadow: string }> = {}
    if (hintSquare) styles[hintSquare] = { boxShadow: 'inset 0 0 0 3px var(--mq-inaccuracy)' }
    if (selectedSquare) styles[selectedSquare] = { boxShadow: 'inset 0 0 0 3px var(--accent)' }
    return styles
  }, [hintSquare, selectedSquare])

  const squareRenderer: SquareRenderer = useMemo(() => {
    return ({ square, children }) => {
      const showBadge = badgeSquare !== null && badgeStyle !== null && square === badgeSquare
      const BadgeIcon = badgeStyle?.icon
      return (
        // react-chessboard (5.10.0) only ever applies its own `squareStyles`
        // option inside the `squareRenderer?.(...) || <div>` fallback branch
        // of its internal Square component - since squareRenderer is always
        // provided here and always returns a truthy element, that fallback
        // is dead code and `squareStyles` passed to <Chessboard> below is
        // silently a no-op. Spreading it into this wrapper's own style is
        // what actually makes the hint/selection highlight visible.
        <div style={{ position: 'relative', width: '100%', height: '100%', ...squareStyles[square] }}>
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
  }, [badgeSquare, badgeStyle, squareStyles])

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

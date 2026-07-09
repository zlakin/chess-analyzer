import { Chessboard } from 'react-chessboard'
import type { Arrow } from 'react-chessboard'

interface BoardProps {
  fen: string
  bestMoveUci: string | null
}

export function Board({ fen, bestMoveUci }: BoardProps): JSX.Element {
  const arrows: Arrow[] = bestMoveUci
    ? [
        {
          startSquare: bestMoveUci.slice(0, 2),
          endSquare: bestMoveUci.slice(2, 4),
          color: 'rgb(21, 128, 61)'
        }
      ]
    : []

  return (
    <div className="board-container">
      <Chessboard
        options={{
          position: fen,
          allowDragging: false,
          arrows,
          boardOrientation: 'white'
        }}
      />
    </div>
  )
}

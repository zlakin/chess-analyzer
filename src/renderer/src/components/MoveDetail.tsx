import type { AnalyzedMove } from '../../../shared/types'
import { formatMoveDetail } from '../lib/moveDetail'

interface MoveDetailProps {
  move: AnalyzedMove | null
}

export function MoveDetail({ move }: MoveDetailProps): JSX.Element | null {
  const text = formatMoveDetail(move)
  if (!text) return null
  return <p className="move-detail">{text}</p>
}

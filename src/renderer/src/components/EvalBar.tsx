import { memo } from 'react'

interface EvalBarProps {
  whiteWinPercent: number
  displayScore: string
}

export const EvalBar = memo(function EvalBar({
  whiteWinPercent,
  displayScore
}: EvalBarProps): JSX.Element {
  return (
    <div className="eval-bar">
      <div className="eval-bar-black" style={{ height: `${100 - whiteWinPercent}%` }} />
      <div className="eval-bar-white" style={{ height: `${whiteWinPercent}%` }} />
      <span className="eval-bar-score">{displayScore}</span>
    </div>
  )
})

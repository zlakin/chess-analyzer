import type { MistakeSummary } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'

interface RecentMistakesListProps {
  mistakes: MistakeSummary[]
}

export function RecentMistakesList({ mistakes }: RecentMistakesListProps): JSX.Element | null {
  if (mistakes.length === 0) return null

  return (
    <ul className="recent-mistakes-list">
      {mistakes.map((mistake) => {
        const tags = [...mistake.missedTactics, ...mistake.punishedByTactics]
        return (
          <li key={`${mistake.gameUrl}-${mistake.ply}`} className="recent-mistake-row">
            <span className="recent-mistake-meta">
              {new Date(mistake.endTime * 1000).toLocaleDateString()} &middot; vs {mistake.opponentUsername}
              &middot; move {Math.ceil(mistake.ply / 2)}
            </span>
            <span className="recent-mistake-tags">
              {tags.length === 0
                ? 'Positional'
                : tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="recent-mistake-tag">
                      {TACTIC_LABELS[tag]}
                    </span>
                  ))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

import type { MistakeSummary, TacticType } from '../../../../shared/types'
import { TACTIC_LABELS } from '../../lib/tacticLabels'

interface RecentMistakesListProps {
  mistakes: MistakeSummary[]
}

const PHASE_LABELS = { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' }

// missedTactics and punishedByTactics can legitimately share a tag (e.g. the
// player missed a fork earlier and was separately forked later in the same
// move) -- dedupe for display, since two identical "Fork" chips read as a
// rendering glitch rather than two distinct facts.
function displayTags(mistake: MistakeSummary): TacticType[] {
  return Array.from(new Set([...mistake.missedTactics, ...mistake.punishedByTactics]))
}

export function RecentMistakesList({ mistakes }: RecentMistakesListProps): JSX.Element | null {
  if (mistakes.length === 0) return null

  return (
    <ul className="recent-mistakes-list">
      {mistakes.map((mistake) => {
        const tags = displayTags(mistake)
        return (
          <li key={`${mistake.gameUrl}-${mistake.ply}`} className="recent-mistake-row">
            <span className="recent-mistake-meta">
              {`${new Date(mistake.endTime * 1000).toLocaleDateString()} · vs ${mistake.opponentUsername} · move ${Math.ceil(mistake.ply / 2)} · ${PHASE_LABELS[mistake.phase]}`}
            </span>
            <span className="recent-mistake-tags">
              {tags.length === 0 ? (
                <span className="recent-mistake-tag">Positional</span>
              ) : (
                tags.map((tag) => (
                  <span key={tag} className="recent-mistake-tag">
                    {TACTIC_LABELS[tag]}
                  </span>
                ))
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

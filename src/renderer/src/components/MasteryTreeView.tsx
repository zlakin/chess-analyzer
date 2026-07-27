import { useEffect, useState } from 'react'
import type { MasteryNodeState, MasteryTree, PuzzleStats } from '../../../shared/types'
import { TACTIC_TYPES } from '../../../shared/types'
import { TACTIC_LABELS } from '../lib/tacticLabels'

interface MasteryTreeViewProps {
  onSelectNode: (node: MasteryNodeState) => void
}

export function MasteryTreeView({ onSelectNode }: MasteryTreeViewProps): JSX.Element {
  const [tree, setTree] = useState<MasteryTree | null>(null)
  const [stats, setStats] = useState<PuzzleStats | null>(null)

  useEffect(() => {
    window.chessAPI.getMasteryTree().then(setTree)
    window.chessAPI.getPuzzleStats().then(setStats)
  }, [])

  if (!tree) return <div className="puzzles-tab" />

  const masteredCount = tree.filter((node) => node.mastered).length

  return (
    <div className="puzzles-tab">
      {stats && (
        <div className="puzzle-stats-bar">
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.rating}</span>
            <span className="puzzle-stat-label">Rating</span>
          </div>
          <div className="puzzle-stat-tile" title={`Best: ${stats.longestStreak}`}>
            <span className="puzzle-stat-value">{stats.currentStreak}</span>
            <span className="puzzle-stat-label">Solve streak</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{stats.solvedToday}</span>
            <span className="puzzle-stat-label">Solved today</span>
          </div>
          <div className="puzzle-stat-tile">
            <span className="puzzle-stat-value">{`${masteredCount}/${tree.length}`}</span>
            <span className="puzzle-stat-label">Mastered</span>
          </div>
        </div>
      )}
      <div className="mastery-tree">
        {TACTIC_TYPES.map((tactic) => {
          const nodes = tree.filter((node) => node.tactic === tactic).sort((a, b) => a.level - b.level)
          return (
            <div key={tactic} className="mastery-tactic-column">
              <h3 className="mastery-tactic-heading">{TACTIC_LABELS[tactic]}</h3>
              {nodes.map((node) => (
                <button
                  key={node.key}
                  className={`mastery-node${node.mastered ? ' mastered' : ''}${!node.unlocked ? ' locked' : ''}`}
                  disabled={!node.unlocked}
                  onClick={() => onSelectNode(node)}
                >
                  <span className="mastery-node-level">Level {node.level}</span>
                  <span className="mastery-node-status">
                    {node.mastered
                      ? 'Mastered'
                      : node.unlocked
                        ? `${node.cleanStreak}/5${node.dueCount > 0 ? ` · ${node.dueCount} due` : ''}`
                        : 'Locked'}
                  </span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

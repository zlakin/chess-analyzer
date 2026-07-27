import { useEffect, useState } from 'react'
import type { MasteryNodeKey, MasteryTree } from '../../../shared/types'
import { TACTIC_TYPES } from '../../../shared/types'
import { TACTIC_LABELS } from '../lib/tacticLabels'

interface MasteryTreeViewProps {
  onSelectNode: (key: MasteryNodeKey) => void
}

export function MasteryTreeView({ onSelectNode }: MasteryTreeViewProps): JSX.Element {
  const [tree, setTree] = useState<MasteryTree | null>(null)

  useEffect(() => {
    window.chessAPI.getMasteryTree().then(setTree)
  }, [])

  if (!tree) return <div className="puzzles-tab" />

  return (
    <div className="puzzles-tab">
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
                  onClick={() => onSelectNode(node.key)}
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

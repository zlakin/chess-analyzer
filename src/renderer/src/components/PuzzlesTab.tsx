import { useState } from 'react'
import type { MasteryNodeState } from '../../../shared/types'
import { MasteryTreeView } from './MasteryTreeView'
import { PuzzleSessionView } from './PuzzleSessionView'

export function PuzzlesTab(): JSX.Element {
  const [selectedNode, setSelectedNode] = useState<MasteryNodeState | null>(null)

  if (selectedNode === null) {
    return <MasteryTreeView onSelectNode={setSelectedNode} />
  }

  return (
    <PuzzleSessionView
      nodeKey={selectedNode.key}
      initialNodeState={selectedNode}
      onBack={() => setSelectedNode(null)}
    />
  )
}

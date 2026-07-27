import { useState } from 'react'
import type { MasteryNodeKey } from '../../../shared/types'
import { MasteryTreeView } from './MasteryTreeView'
import { PuzzleSessionView } from './PuzzleSessionView'

export function PuzzlesTab(): JSX.Element {
  const [selectedNode, setSelectedNode] = useState<MasteryNodeKey | null>(null)

  if (selectedNode === null) {
    return <MasteryTreeView onSelectNode={setSelectedNode} />
  }

  return <PuzzleSessionView nodeKey={selectedNode} onBack={() => setSelectedNode(null)} />
}

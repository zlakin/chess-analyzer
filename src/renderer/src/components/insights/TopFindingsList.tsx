import type { TopFinding } from '../../../../shared/types'

interface TopFindingsListProps {
  findings: TopFinding[]
}

export function TopFindingsList({ findings }: TopFindingsListProps): JSX.Element {
  if (findings.length === 0) {
    return <p className="top-findings-empty">Not enough data yet for a confident finding.</p>
  }

  return (
    <ul className="top-findings-list">
      {findings.slice(0, 8).map((finding, index) => (
        <li key={`${index}-${finding.text}`}>{finding.text}</li>
      ))}
    </ul>
  )
}

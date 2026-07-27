interface PlayerHeaderProps {
  name: string
  elo: string | null
}

export function PlayerHeader({ name, elo }: PlayerHeaderProps): JSX.Element {
  return (
    <div className="player-header">
      <span className="player-header-name">{name}</span>
      {elo && <span className="player-header-elo">{elo}</span>}
    </div>
  )
}

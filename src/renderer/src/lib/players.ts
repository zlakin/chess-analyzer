export interface Players {
  white: string
  black: string
  whiteElo: string | null
  blackElo: string | null
}

export function parsePlayers(pgn: string): Players {
  return {
    white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
    black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black',
    whiteElo: pgn.match(/\[WhiteElo "(\d+)"\]/)?.[1] ?? null,
    blackElo: pgn.match(/\[BlackElo "(\d+)"\]/)?.[1] ?? null
  }
}

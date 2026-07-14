export interface OpeningBookLine {
  name: string
  moves: string[]
}

export const OPENING_BOOK_LINES: OpeningBookLine[] = [
  {
    name: 'Ruy Lopez, Morphy Defense',
    // Extended from a bare 3.Bb5 so that well-known developing/theory
    // moves like 3...a6 are tagged "book" instead of falling through to
    // the sacrifice/brilliant heuristic (a6's destination square is
    // "attacked" by the bishop on b5, which the coarse sacrifice heuristic
    // in shared/pgn.ts misreads as a potential sacrifice).
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']
  },
  {
    name: 'Italian Game, Giuoco Pianissimo',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3']
  },
  {
    name: "Petrov's Defense",
    moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3']
  },
  {
    name: 'Sicilian Defense, Najdorf',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5']
  },
  {
    name: 'Sicilian Defense, Open (2...Nc6)',
    moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3']
  },
  {
    name: 'Caro-Kann Defense, Classical',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5']
  },
  {
    name: 'French Defense, Classical',
    moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7']
  },
  {
    name: 'Scandinavian Defense',
    moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5']
  },
  {
    name: 'Modern Defense',
    moves: ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6']
  },
  {
    name: "Alekhine's Defense",
    moves: ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6']
  },
  {
    name: "Queen's Gambit Declined",
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6']
  },
  {
    name: "King's Indian Defense, Classical",
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6']
  },
  {
    name: 'Nimzo-Indian Defense, Rubinstein',
    moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O']
  },
  {
    name: 'Dutch Defense, Leningrad',
    moves: ['d4', 'f5', 'g3', 'Nf6', 'Bg2']
  },
  {
    name: 'English Opening, Reversed Sicilian',
    moves: ['c4', 'e5', 'Nc3', 'Nf6']
  },
  {
    name: 'Reti Opening',
    moves: ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']
  }
]

export function isBookMove(sanHistory: string[], ply: number): boolean {
  const movesSoFar = sanHistory.slice(0, ply)
  return OPENING_BOOK_LINES.some(
    (line) => line.moves.length >= movesSoFar.length && movesSoFar.every((san, i) => line.moves[i] === san)
  )
}

// Identifies a whole game's opening as the longest book line that is a
// complete prefix of its move list. Deliberately coarse (same style as
// isBookMove): a game that deviates before completing any full book line
// returns null rather than guessing a "closest" match.
export function matchOpeningName(sanHistory: string[]): string | null {
  let bestMatch: OpeningBookLine | null = null

  for (const line of OPENING_BOOK_LINES) {
    if (line.moves.length > sanHistory.length) continue
    const matches = line.moves.every((san, i) => san === sanHistory[i])
    if (matches && (!bestMatch || line.moves.length > bestMatch.moves.length)) {
      bestMatch = line
    }
  }

  return bestMatch?.name ?? null
}

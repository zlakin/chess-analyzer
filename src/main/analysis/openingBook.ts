export const OPENING_BOOK_LINES: string[][] = [
  // Ruy Lopez, Morphy Defense main line (1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4
  // Nf6 5.O-O Be7): extended from a bare 3.Bb5 so that well-known
  // developing/theory moves like 3...a6 are tagged "book" instead of
  // falling through to the sacrifice/brilliant heuristic (a6's destination
  // square is "attacked" by the bishop on b5, which the coarse sacrifice
  // heuristic in pgn.ts misreads as a potential sacrifice).
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
  // Italian Game, Giuoco Pianissimo main line.
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3'],
  // Petrov's Defense main line.
  ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'd6', 'Nf3', 'Nxe4', 'd4', 'd5', 'Bd3'],
  // Sicilian Najdorf main line.
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2', 'e5'],
  // Sicilian, Open, 2...Nc6 main line.
  ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'],
  // Caro-Kann, Classical main line.
  ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],
  // French Defense, Classical main line.
  ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7'],
  // Scandinavian Defense main line.
  ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5'],
  // Modern Defense main line.
  ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6'],
  // Alekhine's Defense main line.
  ['e4', 'Nf6', 'e5', 'Nd5', 'd4', 'd6'],
  // Queen's Gambit Declined main line.
  ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
  // King's Indian Defense, Classical main line.
  ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'],
  // Nimzo-Indian Defense, Rubinstein main line.
  ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4', 'e3', 'O-O'],
  // Dutch Defense, Leningrad-ish setup.
  ['d4', 'f5', 'g3', 'Nf6', 'Bg2'],
  // English Opening, reversed Sicilian main line.
  ['c4', 'e5', 'Nc3', 'Nf6'],
  // Reti Opening main line.
  ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2']
]

export function isBookMove(sanHistory: string[], ply: number): boolean {
  const movesSoFar = sanHistory.slice(0, ply)
  return OPENING_BOOK_LINES.some(
    (line) => line.length >= movesSoFar.length && movesSoFar.every((san, i) => line[i] === san)
  )
}

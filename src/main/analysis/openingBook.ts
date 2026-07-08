export const OPENING_BOOK_LINES: string[][] = [
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
  ['e4', 'e5', 'Nf3', 'Nf6'],
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'],
  ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4'],
  ['e4', 'c6', 'd4', 'd5'],
  ['e4', 'e6', 'd4', 'd5'],
  ['e4', 'd5'],
  ['e4', 'g6'],
  ['e4', 'Nf6'],
  ['d4', 'd5', 'c4'],
  ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
  ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
  ['d4', 'f5'],
  ['c4'],
  ['Nf3', 'd5', 'g3']
]

export function isBookMove(sanHistory: string[], ply: number): boolean {
  const movesSoFar = sanHistory.slice(0, ply)
  return OPENING_BOOK_LINES.some(
    (line) => line.length >= movesSoFar.length && movesSoFar.every((san, i) => line[i] === san)
  )
}

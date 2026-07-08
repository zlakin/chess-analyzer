export interface AnalyzedPosition {
  ply: number
  moveNumber: number
  color: 'w' | 'b'
  san: string
  moveUci: string
  fenBefore: string
  fenAfter: string
  isPotentialSacrifice: boolean
}

export interface EngineLine {
  depth: number
  scoreCp: number | null
  scoreMate: number | null
  moveUci: string
  pv: string[]
}

export interface PositionEvaluation {
  lines: EngineLine[]
}

export type MoveClassification =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export interface AnalyzedMove extends AnalyzedPosition {
  evalBefore: PositionEvaluation
  evalAfter: PositionEvaluation
  classification: MoveClassification
  accuracy: number
}

export interface GameAnalysisResult {
  moves: AnalyzedMove[]
  whiteAccuracy: number
  blackAccuracy: number
}

export interface ChessComPlayerResult {
  username: string
  rating: number
  result: string
}

export interface ChessComGameSummary {
  url: string
  pgn: string
  endTime: number
  timeControl: string
  white: ChessComPlayerResult
  black: ChessComPlayerResult
}

export interface ChessAPI {
  analyzeGame(
    positions: AnalyzedPosition[],
    depth: number
  ): Promise<GameAnalysisResult | { cancelled: true } | { error: string }>
  onAnalysisProgress(callback: (move: AnalyzedMove) => void): () => void
  cancelAnalysis(): void
  openPgnFile(): Promise<{ pgn: string } | { cancelled: true } | { error: string }>
  fetchChessComGames(username: string): Promise<ChessComGameSummary[] | { error: string }>
}

export interface AppSettings {
  chessComUsername: string | null
}

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
  getSettings(): Promise<AppSettings>
  setChessComUsername(username: string): Promise<AppSettings>
  scanChessComGames(): Promise<ScanOutcome>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  cancelScan(): void
  getInsightsReport(): Promise<InsightsReport>
}

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'daily'

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

export interface GameInsightMistake {
  ply: number
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  isHungPiece: boolean
  clockSecondsRemaining: number | null
  isTimePressure: boolean
}

export interface GameInsightRecord {
  gameUrl: string
  endTime: number
  timeControlCategory: TimeControlCategory
  userColor: 'w' | 'b'
  result: 'win' | 'loss' | 'draw'
  openingName: string | null
  accuracy: number
  mistakes: GameInsightMistake[]
}

export interface ScanMeta {
  username: string | null
  lastScanTime: number | null
  scannedUrls: string[]
}

export interface PhaseBreakdown {
  opening: number
  middlegame: number
  endgame: number
}

export interface OpeningStat {
  name: string
  games: number
  accuracy: number
}

export interface TrendPoint {
  gameIndex: number
  endTime: number
  rollingAccuracy: number
}

export type InsightsBucketKey = 'overall' | TimeControlCategory

export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  hungPieceCount: number
  positionalCount: number
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
}

export interface TopFinding {
  text: string
  significance: number
}

export interface InsightsReport {
  gamesScanned: number
  lastScanTime: number | null
  topFindings: TopFinding[]
  buckets: InsightsBucket[]
}

export interface ScanProgress {
  scanned: number
  total: number
}

export type ScanOutcome = { scanned: number } | { cancelled: true } | { error: string }

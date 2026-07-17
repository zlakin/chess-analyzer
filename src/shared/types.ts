export interface LinkedAccount {
  username: string
  verifiedAt: number | null
}

export interface AppSettings {
  linkedAccount: LinkedAccount | null
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
  // Chess.com's own authoritative bucket ('bullet'/'blitz'/'rapid'/'daily'),
  // preferred over re-deriving one from `timeControl` when present -- some
  // game types (e.g. "Play vs Coach") report a non-numeric `timeControl`
  // like "-" that a raw parse can't categorize correctly. Optional/untyped
  // since it's straight from the external API and could be absent/unknown.
  timeClass?: string
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
  startAccountLink(username: string): Promise<{ code: string } | { error: string }>
  verifyAccountLink(): Promise<
    { verified: true; username: string; verifiedAt: number } | { error: string }
  >
  disconnectAccount(): Promise<void>
  openChessComProfileSettings(): Promise<void>
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

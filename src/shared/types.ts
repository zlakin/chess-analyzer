export interface LinkedAccount {
  username: string
  verifiedAt: number | null
}

export type Theme = 'light' | 'dark'

export interface AppSettings {
  linkedAccount: LinkedAccount | null
  theme: Theme
}

export interface AnalyzedPosition {
  ply: number
  moveNumber: number
  color: 'w' | 'b'
  san: string
  moveUci: string
  fenBefore: string
  fenAfter: string
  /** Static exchange evaluation of this move, in centipawns. Negative means
   *  the move gives up material on its destination square. */
  seeCp: number
  isCapture: boolean
  /** Legal moves available to the mover in `fenBefore`. 1 means forced. */
  legalMoveCount: number
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

export interface ChessComPlayerStats {
  bullet: number | null
  blitz: number | null
  rapid: number | null
  daily: number | null
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
  fetchChessComStats(username: string): Promise<ChessComPlayerStats | { error: string }>
  getSettings(): Promise<AppSettings>
  setTheme(theme: Theme): Promise<void>
  evaluatePosition(fen: string, depth: number): Promise<PositionEvaluation | { error: string }>
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
  getMasteryTree(): Promise<MasteryTree>
  getNodeQueue(key: MasteryNodeKey): Promise<MasteryPuzzleCard[]>
  submitPuzzleReview(cardId: string, quality: SrsQuality): Promise<SrsCardState>
  getPuzzleStats(): Promise<PuzzleStats>
  submitPuzzleOutcome(
    outcome: PuzzleOutcome,
    classification: 'mistake' | 'blunder',
    nodeKey: MasteryNodeKey | null
  ): Promise<{ stats: PuzzleStats; nodeProgress: MasteryNodeProgress | null }>
  getMistakeDetail(gameUrl: string, ply: number): Promise<MistakeDetail | null>
}

export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'daily'

export type GamePhase = 'opening' | 'middlegame' | 'endgame'

export type TacticType = 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'back_rank_mate' | 'hung_piece'

export const TACTIC_TYPES: TacticType[] = [
  'fork',
  'pin',
  'skewer',
  'discovered_attack',
  'back_rank_mate',
  'hung_piece'
]

export interface GameInsightMistake {
  ply: number
  classification: 'mistake' | 'blunder'
  phase: GamePhase
  cpLoss: number
  /** Mover-perspective evaluation before the mistake, in centipawns. Stored
   *  so a future classifier change can be applied without a rescan. */
  evalBeforeMoverCp: number
  winPercentLoss: number
  fenBefore: string
  playedMoveUci: string
  bestMoveUci: string
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  clockSecondsRemaining: number | null
  isTimePressure: boolean
}

export interface GameInsightRecord {
  gameUrl: string
  endTime: number
  timeControlCategory: TimeControlCategory
  userColor: 'w' | 'b'
  opponentUsername: string
  result: 'win' | 'loss' | 'draw'
  openingName: string | null
  accuracy: number
  mistakes: GameInsightMistake[]
  schemaVersion: number
}

export interface ScanMeta {
  username: string | null
  lastScanTime: number | null
  scannedUrls: string[]
  schemaVersion: number
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

export interface MistakeSummary {
  gameUrl: string
  endTime: number
  opponentUsername: string
  ply: number
  phase: GamePhase
  cpLoss: number
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
}

export interface MistakeDetail {
  fenBefore: string
  bestMoveUci: string
  classification: 'mistake' | 'blunder'
  missedTactics: TacticType[]
  punishedByTactics: TacticType[]
  userColor: 'w' | 'b'
  cardId: string
  nodeKey: MasteryNodeKey | null
}

export interface TacticTrend {
  type: TacticType
  olderShare: number
  newerShare: number
}

export interface InsightsBucket {
  key: InsightsBucketKey
  gamesCount: number
  hasEnoughData: boolean
  totalMistakes: number
  averageAccuracy: number
  phaseBreakdown: PhaseBreakdown
  tacticBreakdown: Record<TacticType, number>
  missedTacticBreakdown: Record<TacticType, number>
  timePressureCount: number
  weakOpenings: OpeningStat[]
  trend: TrendPoint[]
  recentMistakes: MistakeSummary[]
  tacticTrends: TacticTrend[]
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
  staleSchema: boolean
}

export interface ScanProgress {
  scanned: number
  total: number
}

export type ScanOutcome = { scanned: number } | { cancelled: true } | { error: string }

export type SrsQuality = 0 | 1 | 2 | 3 | 4 | 5

export interface SrsCardState {
  cardId: string
  easeFactor: number
  intervalDays: number
  repetitions: number
  dueDate: number
  lastReviewedAt: number | null
}

export type MasteryLevel = 1 | 2 | 3

export type MasteryNodeKey = string // `${TacticType}:${MasteryLevel}`, e.g. "fork:2"

export interface MasteryNodeProgress {
  cleanStreak: number
  mastered: boolean
}

export interface MasteryNodeState {
  key: MasteryNodeKey
  tactic: TacticType
  level: MasteryLevel
  unlocked: boolean
  mastered: boolean
  cleanStreak: number
  dueCount: number
}

export type MasteryTree = MasteryNodeState[]

export interface MasteryPuzzleCard {
  cardId: string
  source: 'mistake' | 'backfill'
  fenBefore: string
  bestMoveUci: string
  tactic: TacticType
  userColor: 'w' | 'b'
  gameUrl: string | null
  opponentUsername: string | null
  endTime: number | null
  classification: 'mistake' | 'blunder'
}

export type PuzzleOutcome = 'clean' | 'retried' | 'hinted' | 'gaveUp'

export interface PuzzleStats {
  rating: number
  currentStreak: number
  longestStreak: number
  totalResolved: number
  totalCleanSolves: number
  solvedToday: number
  lastSolvedDate: string
}

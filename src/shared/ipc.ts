export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
} as const

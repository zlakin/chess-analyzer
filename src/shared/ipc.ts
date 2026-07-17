export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  startAccountLink: 'account:start-link',
  verifyAccountLink: 'account:verify-link',
  disconnectAccount: 'account:disconnect',
  openChessComProfileSettings: 'app:open-chesscom-profile-settings',
  scanChessComGames: 'insights:scan',
  scanProgress: 'insights:scan-progress',
  cancelScan: 'insights:cancel-scan',
  getInsightsReport: 'insights:get-report'
} as const

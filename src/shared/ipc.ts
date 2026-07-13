export const IPC_CHANNELS = {
  analyzeGame: 'chess:analyze-game',
  analysisProgress: 'chess:analysis-progress',
  cancelAnalysis: 'chess:cancel-analysis',
  openPgnFile: 'chess:open-pgn-file',
  fetchChessComGames: 'chess:fetch-chesscom-games',
  getSettings: 'settings:get',
  setChessComUsername: 'settings:set-chesscom-username'
} as const

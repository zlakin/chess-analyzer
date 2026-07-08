import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AnalyzedPosition, AnalyzedMove, ChessAPI } from '../shared/types'

const chessAPI: ChessAPI = {
  analyzeGame: (positions: AnalyzedPosition[], depth: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.analyzeGame, positions, depth),
  onAnalysisProgress: (callback: (move: AnalyzedMove) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, move: AnalyzedMove): void => callback(move)
    ipcRenderer.on(IPC_CHANNELS.analysisProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.analysisProgress, handler)
  },
  cancelAnalysis: () => ipcRenderer.send(IPC_CHANNELS.cancelAnalysis),
  openPgnFile: () => ipcRenderer.invoke(IPC_CHANNELS.openPgnFile),
  fetchChessComGames: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchChessComGames, username)
}

contextBridge.exposeInMainWorld('chessAPI', chessAPI)

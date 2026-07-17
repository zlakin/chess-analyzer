import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AnalyzedPosition, AnalyzedMove, ChessAPI, ScanProgress } from '../shared/types'

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
  fetchChessComGames: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchChessComGames, username),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  scanChessComGames: () => ipcRenderer.invoke(IPC_CHANNELS.scanChessComGames),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.scanProgress, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanProgress, handler)
  },
  cancelScan: () => ipcRenderer.send(IPC_CHANNELS.cancelScan),
  getInsightsReport: () => ipcRenderer.invoke(IPC_CHANNELS.getInsightsReport)
}

contextBridge.exposeInMainWorld('chessAPI', chessAPI)

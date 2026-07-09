/// <reference types="vite/client" />
import type { ChessAPI } from '../../shared/types'

declare global {
  interface Window {
    chessAPI: ChessAPI
  }
}

export {}

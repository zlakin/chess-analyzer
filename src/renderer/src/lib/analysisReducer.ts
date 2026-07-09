import type { AnalyzedMove, AnalyzedPosition, GameAnalysisResult } from '../../../shared/types'

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'error' | 'cancelled'

export interface AnalysisState {
  status: AnalysisStatus
  positions: AnalyzedPosition[]
  moves: AnalyzedMove[]
  whiteAccuracy: number | null
  blackAccuracy: number | null
  error: string | null
  progressCount: number
}

export type AnalysisAction =
  | { type: 'START'; positions: AnalyzedPosition[] }
  | { type: 'MOVE_PROGRESS'; move: AnalyzedMove }
  | { type: 'COMPLETE'; result: GameAnalysisResult }
  | { type: 'CANCELLED' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' }

export const INITIAL_STATE: AnalysisState = {
  status: 'idle',
  positions: [],
  moves: [],
  whiteAccuracy: null,
  blackAccuracy: null,
  error: null,
  progressCount: 0
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'START':
      return { ...INITIAL_STATE, status: 'analyzing', positions: action.positions }
    case 'MOVE_PROGRESS':
      return {
        ...state,
        moves: [...state.moves, action.move],
        progressCount: state.progressCount + 1
      }
    case 'COMPLETE':
      return {
        ...state,
        status: 'done',
        moves: action.result.moves,
        whiteAccuracy: action.result.whiteAccuracy,
        blackAccuracy: action.result.blackAccuracy
      }
    case 'CANCELLED':
      return { ...state, status: 'cancelled' }
    case 'ERROR':
      return { ...state, status: 'error', error: action.message }
    case 'RESET':
      return INITIAL_STATE
    default:
      return state
  }
}

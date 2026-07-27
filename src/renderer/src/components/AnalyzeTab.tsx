import { useMemo } from 'react'
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, FlipVertical2 } from 'lucide-react'
import { matchOpeningName } from '../../../shared/analysis/openingBook'
import type { AnalyzedMove } from '../../../shared/types'
import type { AnalysisState } from '../lib/analysisReducer'
import type { PositionAtPly } from '../lib/gameNavigation'
import type { Players } from '../lib/players'
import { useVariationExplorer } from '../hooks/useVariationExplorer'
import { ImportModal } from './ImportModal'
import { Board } from './Board'
import { EvalBar } from './EvalBar'
import { MoveList } from './MoveList'
import { EvalGraph } from './EvalGraph'
import { GameSummary } from './GameSummary'
import { MoveDetail } from './MoveDetail'
import { ExploringBanner } from './ExploringBanner'
import { PlayerHeader } from './PlayerHeader'
import { formatScore, whiteWinPercent } from '../lib/displayEval'

interface AnalyzeTabProps {
  state: AnalysisState
  currentPly: number
  position: PositionAtPly
  currentMove: AnalyzedMove | null
  boardOrientation: 'white' | 'black'
  boardHeight: number | undefined
  players: Players
  pgnError: string | null
  explorer: ReturnType<typeof useVariationExplorer>
  onGameLoaded: (pgn: string) => void
  onNewGame: () => void
  onFlipBoard: () => void
  onCancelAnalysis: () => void
  onBoardHeightChange: (height: number) => void
  goToPly: (ply: number) => void
  setCurrentPly: (ply: number) => void
}

export function AnalyzeTab({
  state,
  currentPly,
  position,
  currentMove,
  boardOrientation,
  boardHeight,
  players,
  pgnError,
  explorer,
  onGameLoaded,
  onNewGame,
  onFlipBoard,
  onCancelAnalysis,
  onBoardHeightChange,
  goToPly,
  setCurrentPly
}: AnalyzeTabProps): JSX.Element {
  const topPlayer =
    boardOrientation === 'white'
      ? { name: players.black, elo: players.blackElo }
      : { name: players.white, elo: players.whiteElo }
  const bottomPlayer =
    boardOrientation === 'white'
      ? { name: players.white, elo: players.whiteElo }
      : { name: players.black, elo: players.blackElo }
  const openingName = useMemo(() => matchOpeningName(state.moves.map((m) => m.san)), [state.moves])

  return (
    <>
      {state.status !== 'idle' && (
        <div className="analyze-tab-toolbar">
          <button onClick={onNewGame}>New Game</button>
        </div>
      )}

      {state.status === 'idle' && <ImportModal onGameLoaded={onGameLoaded} />}
      {pgnError && <div className="import-error">{pgnError}</div>}

      {state.status === 'analyzing' && (
        <div className="analysis-progress">
          <span>
            Analyzing... {state.moves.length} / {state.positions.length} moves
          </span>
          <progress value={state.moves.length} max={state.positions.length} />
          <button onClick={onCancelAnalysis}>Cancel</button>
        </div>
      )}

      {state.status === 'error' && <div className="import-error">{state.error}</div>}
      {state.status === 'cancelled' && <div className="import-error">Analysis cancelled.</div>}

      {(state.status === 'analyzing' || state.status === 'done') && state.moves.length > 0 && (
        <div className="analysis-layout">
          <EvalBar
            whiteWinPercent={
              explorer.isExploring
                ? explorer.evaluation
                  ? whiteWinPercent(explorer.evaluation, explorer.sideToMove)
                  : 50
                : position.evaluation
                  ? whiteWinPercent(position.evaluation, position.sideToMove)
                  : 50
            }
            displayScore={
              explorer.isExploring
                ? explorer.evaluation
                  ? formatScore(explorer.evaluation, explorer.sideToMove)
                  : '...'
                : position.evaluation
                  ? formatScore(position.evaluation, position.sideToMove)
                  : '0.00'
            }
            height={boardHeight}
          />
          <div className="board-column">
            <PlayerHeader name={topPlayer.name} elo={topPlayer.elo} />
            <Board
              fen={explorer.currentFen}
              bestMoveUci={explorer.isExploring ? null : position.bestMoveUci}
              currentMove={explorer.isExploring ? null : currentMove}
              boardOrientation={boardOrientation}
              onMove={explorer.makeMove}
              onHeightChange={onBoardHeightChange}
            />
            <PlayerHeader name={bottomPlayer.name} elo={bottomPlayer.elo} />
            <div className="board-nav">
              <button onClick={() => goToPly(0)} disabled={currentPly === 0} title="First move (Home)">
                <ChevronsLeft size={18} />
              </button>
              <button
                onClick={() => goToPly(currentPly - 1)}
                disabled={currentPly === 0}
                title="Previous move (←)"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => goToPly(currentPly + 1)}
                disabled={currentPly === state.moves.length}
                title="Next move (→)"
              >
                <ChevronRight size={18} />
              </button>
              <button
                onClick={() => goToPly(state.moves.length)}
                disabled={currentPly === state.moves.length}
                title="Last move (End)"
              >
                <ChevronsRight size={18} />
              </button>
              <button className="board-nav-flip" onClick={onFlipBoard} title="Flip board (F)">
                <FlipVertical2 size={18} />
              </button>
            </div>
            {explorer.isExploring ? (
              <ExploringBanner
                evaluation={explorer.evaluation}
                isEvaluating={explorer.isEvaluating}
                sideToMove={explorer.sideToMove}
                canUndo={true}
                onUndo={explorer.undoLastMove}
                onExit={explorer.exitExploration}
              />
            ) : (
              <MoveDetail move={currentMove} />
            )}
          </div>
          <div className="side-panel">
            <MoveList moves={state.moves} currentPly={currentPly} onSelectPly={setCurrentPly} />
            <EvalGraph moves={state.moves} currentPly={currentPly} onSelectPly={setCurrentPly} />
            {state.status === 'done' && state.whiteAccuracy !== null && state.blackAccuracy !== null && (
              <GameSummary
                moves={state.moves}
                whiteAccuracy={state.whiteAccuracy}
                blackAccuracy={state.blackAccuracy}
                whiteUsername={players.white}
                blackUsername={players.black}
                openingName={openingName}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

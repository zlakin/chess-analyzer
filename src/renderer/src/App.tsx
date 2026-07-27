import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
import { NavBar } from './components/NavBar'
import type { AppTab } from './components/NavBar'
import { InsightsTab } from './components/InsightsTab'
import { PuzzlesTab } from './components/PuzzlesTab'
import { ImportModal } from './components/ImportModal'
import { Board } from './components/Board'
import { EvalBar } from './components/EvalBar'
import { MoveList } from './components/MoveList'
import { EvalGraph } from './components/EvalGraph'
import { GameSummary } from './components/GameSummary'
import { ConnectAccountModal } from './components/ConnectAccountModal'
import type { ChessComPlayerStats, LinkedAccount } from '../../shared/types'
import { useGameAnalysis } from './hooks/useGameAnalysis'
import { useInsightsScan } from './hooks/useInsightsScan'
import { useTheme } from './hooks/useTheme'
import { parsePgn, PgnParseError } from '../../shared/pgn'
import { getPositionAtPly, getMoveAtPly } from './lib/gameNavigation'
import { formatScore, whiteWinPercent } from './lib/displayEval'
import { MoveDetail } from './components/MoveDetail'
import { useVariationExplorer } from './hooks/useVariationExplorer'
import { ExploringBanner } from './components/ExploringBanner'

interface Players {
  white: string
  black: string
}

function App(): JSX.Element {
  const { state, startAnalysis, cancelAnalysis, reset } = useGameAnalysis()
  const insightsScan = useInsightsScan()
  const { theme, toggleTheme } = useTheme()
  const [currentPly, setCurrentPly] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Players>({ white: 'White', black: 'Black' })
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')
  const [linkedAccount, setLinkedAccount] = useState<LinkedAccount | null>(null)
  const [rating, setRating] = useState<ChessComPlayerStats | null>(null)
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [boardHeight, setBoardHeight] = useState<number | undefined>(undefined)
  const handleBoardHeightChange = useCallback((height: number) => setBoardHeight(height), [])

  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => setLinkedAccount(settings.linkedAccount))
  }, [])

  useEffect(() => {
    if (!linkedAccount?.verifiedAt) {
      setRating(null)
      return
    }
    window.chessAPI.fetchChessComStats(linkedAccount.username).then((result) => {
      setRating('error' in result ? null : result)
    })
  }, [linkedAccount?.verifiedAt, linkedAccount?.username])

  const handleGameLoaded = (pgn: string): void => {
    setPgnError(null)
    try {
      const positions = parsePgn(pgn)
      setPlayers({
        white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
        black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
      })
      setCurrentPly(0)
      explorer.exitExploration()
      void startAnalysis(positions)
    } catch (err) {
      setPgnError(err instanceof PgnParseError ? err.message : 'Could not parse this PGN')
    }
  }

  const position = useMemo(() => getPositionAtPly(state.moves, currentPly), [state.moves, currentPly])
  const currentMove = useMemo(() => getMoveAtPly(state.moves, currentPly), [state.moves, currentPly])
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white')
  const explorer = useVariationExplorer(position.fen)

  const handleNewGame = (): void => {
    // "New Game" is offered while an analysis is still running, so cancel it
    // first - otherwise the whole engine pool keeps churning server-side on a
    // game the renderer has already thrown away. No-op when nothing is in flight.
    cancelAnalysis()
    reset()
    setCurrentPly(0)
    explorer.exitExploration()
    setPgnError(null)
  }

  const goToPly = (ply: number): void => {
    setCurrentPly(Math.max(0, Math.min(ply, state.moves.length)))
  }

  useEffect(() => {
    if (state.moves.length === 0) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') goToPly(currentPly - 1)
      else if (e.key === 'ArrowRight') goToPly(currentPly + 1)
      else if (e.key === 'Home') goToPly(0)
      else if (e.key === 'End') goToPly(state.moves.length)
      else if (e.key === 'f' || e.key === 'F') setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPly, state.moves.length])

  return (
    <div className="app">
      <NavBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAnalyzing={state.status === 'analyzing'}
        isScanning={insightsScan.state.status === 'scanning'}
        linkedAccount={linkedAccount}
        rating={rating}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      {isConnectModalOpen && (
        <ConnectAccountModal
          linkedAccount={linkedAccount}
          onClose={() => setIsConnectModalOpen(false)}
          onLinked={(account) => {
            setLinkedAccount(account)
            setIsConnectModalOpen(false)
          }}
          onDisconnected={() => {
            setLinkedAccount(null)
            setIsConnectModalOpen(false)
          }}
        />
      )}
      <main className="app-content">
        {activeTab === 'analyze' && (
          <>
            {state.status !== 'idle' && (
              <div className="analyze-tab-toolbar">
                <button onClick={handleNewGame}>New Game</button>
              </div>
            )}

            {state.status === 'idle' && <ImportModal onGameLoaded={handleGameLoaded} />}
            {pgnError && <div className="import-error">{pgnError}</div>}

            {state.status === 'analyzing' && (
              <div className="analysis-progress">
                <span>
                  Analyzing... {state.moves.length} / {state.positions.length} moves
                </span>
                <progress value={state.moves.length} max={state.positions.length} />
                <button onClick={cancelAnalysis}>Cancel</button>
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
                  <Board
                    fen={explorer.currentFen}
                    bestMoveUci={explorer.isExploring ? null : position.bestMoveUci}
                    currentMove={explorer.isExploring ? null : currentMove}
                    boardOrientation={boardOrientation}
                    onMove={explorer.makeMove}
                    onHeightChange={handleBoardHeightChange}
                  />
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
                    />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'insights' && (
          <InsightsTab
            state={insightsScan.state}
            startScan={insightsScan.startScan}
            cancelScan={insightsScan.cancelScan}
          />
        )}

        {activeTab === 'puzzles' && <PuzzlesTab />}
      </main>
    </div>
  )
}

export default App

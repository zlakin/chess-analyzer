import { useEffect, useMemo, useState } from 'react'
import { NavBar } from './components/NavBar'
import type { AppTab } from './components/NavBar'
import { InsightsTab } from './components/InsightsTab'
import { ImportModal } from './components/ImportModal'
import { Board } from './components/Board'
import { EvalBar } from './components/EvalBar'
import { MoveList } from './components/MoveList'
import { EvalGraph } from './components/EvalGraph'
import { GameSummary } from './components/GameSummary'
import { useGameAnalysis } from './hooks/useGameAnalysis'
import { parsePgn, PgnParseError } from '../../shared/pgn'
import { getPositionAtPly } from './lib/gameNavigation'
import { formatScore, whiteWinPercent } from './lib/displayEval'

interface Players {
  white: string
  black: string
}

function App(): JSX.Element {
  const { state, startAnalysis, cancelAnalysis, reset } = useGameAnalysis()
  const [currentPly, setCurrentPly] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [players, setPlayers] = useState<Players>({ white: 'White', black: 'Black' })
  const [activeTab, setActiveTab] = useState<AppTab>('analyze')

  const handleGameLoaded = (pgn: string): void => {
    setPgnError(null)
    try {
      const positions = parsePgn(pgn)
      setPlayers({
        white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
        black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
      })
      setCurrentPly(0)
      void startAnalysis(positions)
    } catch (err) {
      setPgnError(err instanceof PgnParseError ? err.message : 'Could not parse this PGN')
    }
  }

  const position = useMemo(() => getPositionAtPly(state.moves, currentPly), [state.moves, currentPly])

  const handleNewGame = (): void => {
    reset()
    setCurrentPly(0)
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
      />
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
                    position.evaluation ? whiteWinPercent(position.evaluation, position.sideToMove) : 50
                  }
                  displayScore={
                    position.evaluation ? formatScore(position.evaluation, position.sideToMove) : '0.00'
                  }
                />
                <div className="board-column">
                  <Board fen={position.fen} bestMoveUci={position.bestMoveUci} />
                  <div className="board-nav">
                    <button onClick={() => goToPly(0)} disabled={currentPly === 0} title="First move (Home)">
                      ⏮
                    </button>
                    <button
                      onClick={() => goToPly(currentPly - 1)}
                      disabled={currentPly === 0}
                      title="Previous move (←)"
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => goToPly(currentPly + 1)}
                      disabled={currentPly === state.moves.length}
                      title="Next move (→)"
                    >
                      ▶
                    </button>
                    <button
                      onClick={() => goToPly(state.moves.length)}
                      disabled={currentPly === state.moves.length}
                      title="Last move (End)"
                    >
                      ⏭
                    </button>
                  </div>
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

        {activeTab === 'insights' && <InsightsTab />}
      </main>
    </div>
  )
}

export default App

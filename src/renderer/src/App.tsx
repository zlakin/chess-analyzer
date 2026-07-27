import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavBar } from './components/NavBar'
import type { AppTab } from './components/NavBar'
import { InsightsTab } from './components/InsightsTab'
import { PuzzlesTab } from './components/PuzzlesTab'
import { AnalyzeTab } from './components/AnalyzeTab'
import { ConnectAccountModal } from './components/ConnectAccountModal'
import type { ChessComPlayerStats, LinkedAccount } from '../../shared/types'
import type { Players } from './lib/players'
import { useGameAnalysis } from './hooks/useGameAnalysis'
import { useInsightsScan } from './hooks/useInsightsScan'
import { useTheme } from './hooks/useTheme'
import { parsePgn, PgnParseError } from '../../shared/pgn'
import { getPositionAtPly, getMoveAtPly } from './lib/gameNavigation'
import { useVariationExplorer } from './hooks/useVariationExplorer'
import { resolveUserColor } from './lib/userColor'

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
      const newPlayers = {
        white: pgn.match(/\[White "([^"]*)"\]/)?.[1] ?? 'White',
        black: pgn.match(/\[Black "([^"]*)"\]/)?.[1] ?? 'Black'
      }
      setPlayers(newPlayers)
      const detectedColor = resolveUserColor(newPlayers, linkedAccount?.username ?? null)
      setBoardOrientation(detectedColor === 'b' ? 'black' : 'white')
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

  const handleFlipBoard = (): void => {
    setBoardOrientation((o) => (o === 'white' ? 'black' : 'white'))
  }

  useEffect(() => {
    if (state.moves.length === 0) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') goToPly(currentPly - 1)
      else if (e.key === 'ArrowRight') goToPly(currentPly + 1)
      else if (e.key === 'Home') goToPly(0)
      else if (e.key === 'End') goToPly(state.moves.length)
      else if (e.key === 'f' || e.key === 'F') handleFlipBoard()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPly, state.moves.length, handleFlipBoard])

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
          <AnalyzeTab
            state={state}
            currentPly={currentPly}
            position={position}
            currentMove={currentMove}
            boardOrientation={boardOrientation}
            boardHeight={boardHeight}
            players={players}
            pgnError={pgnError}
            explorer={explorer}
            onGameLoaded={handleGameLoaded}
            onNewGame={handleNewGame}
            onFlipBoard={handleFlipBoard}
            onCancelAnalysis={cancelAnalysis}
            onBoardHeightChange={handleBoardHeightChange}
            goToPly={goToPly}
            setCurrentPly={setCurrentPly}
          />
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

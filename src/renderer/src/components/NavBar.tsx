import { Loader2, BadgeCheck, Sun, Moon } from 'lucide-react'
import type { ChessComPlayerStats, LinkedAccount, Theme } from '../../../shared/types'
import { primaryRating } from '../lib/chessComRatingLabels'

export type AppTab = 'analyze' | 'insights' | 'puzzles'

interface NavBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
  isAnalyzing: boolean
  isScanning: boolean
  linkedAccount: LinkedAccount | null
  rating: ChessComPlayerStats | null
  onOpenConnectModal: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function NavBar({
  activeTab,
  onSelectTab,
  isAnalyzing,
  isScanning,
  linkedAccount,
  rating,
  onOpenConnectModal,
  theme,
  onToggleTheme
}: NavBarProps): JSX.Element {
  const chipLabel = linkedAccount
    ? linkedAccount.verifiedAt
      ? linkedAccount.username
      : `${linkedAccount.username} · Unverified`
    : 'Connect chess.com account'
  const headlineRating = linkedAccount?.verifiedAt ? primaryRating(rating) : null

  return (
    <header className="nav-bar">
      <span className="nav-brand">Study Room</span>
      <nav className="segmented-control">
        <button
          className={`segmented-control-option${activeTab === 'analyze' ? ' active' : ''}`}
          onClick={() => onSelectTab('analyze')}
        >
          Analyze
          {isAnalyzing && <Loader2 size={14} className="spin-icon" />}
        </button>
        <button
          className={`segmented-control-option${activeTab === 'insights' ? ' active' : ''}`}
          onClick={() => onSelectTab('insights')}
        >
          Insights
          {isScanning && <Loader2 size={14} className="spin-icon" />}
        </button>
        <button
          className={`segmented-control-option${activeTab === 'puzzles' ? ' active' : ''}`}
          onClick={() => onSelectTab('puzzles')}
        >
          Puzzles
        </button>
      </nav>
      <div className="nav-bar-actions">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className={`account-chip${linkedAccount?.verifiedAt ? ' verified' : ''}`}
          onClick={onOpenConnectModal}
        >
          {linkedAccount?.verifiedAt && <BadgeCheck size={14} className="account-chip-icon" />}
          {chipLabel}
          {headlineRating != null && <span className="account-chip-rating">{headlineRating}</span>}
        </button>
      </div>
    </header>
  )
}

import { Loader2, CircleCheck } from 'lucide-react'
import type { LinkedAccount } from '../../../shared/types'

export type AppTab = 'analyze' | 'insights'

interface NavBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
  isAnalyzing: boolean
  isScanning: boolean
  linkedAccount: LinkedAccount | null
  onOpenConnectModal: () => void
}

export function NavBar({
  activeTab,
  onSelectTab,
  isAnalyzing,
  isScanning,
  linkedAccount,
  onOpenConnectModal
}: NavBarProps): JSX.Element {
  const chipLabel = linkedAccount
    ? linkedAccount.verifiedAt
      ? linkedAccount.username
      : `${linkedAccount.username} · Unverified`
    : 'Connect chess.com account'

  return (
    <header className="nav-bar">
      <span className="nav-brand">Chess Analyzer</span>
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
      </nav>
      <button
        className={`account-chip${linkedAccount?.verifiedAt ? ' verified' : ''}`}
        onClick={onOpenConnectModal}
      >
        {linkedAccount?.verifiedAt && <CircleCheck size={14} className="account-chip-icon" />}
        {chipLabel}
      </button>
    </header>
  )
}

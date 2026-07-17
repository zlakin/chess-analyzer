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
      ? `✓ ${linkedAccount.username}`
      : `${linkedAccount.username} (unverified)`
    : 'Connect chess.com account'

  return (
    <header className="nav-bar">
      <span className="nav-brand">Chess Analyzer</span>
      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'analyze' ? 'active' : ''}`}
          onClick={() => onSelectTab('analyze')}
        >
          Analyze{isAnalyzing ? ' ⏳' : ''}
        </button>
        <button
          className={`nav-tab ${activeTab === 'insights' ? 'active' : ''}`}
          onClick={() => onSelectTab('insights')}
        >
          Insights{isScanning ? ' ⏳' : ''}
        </button>
      </nav>
      <button className="account-chip" onClick={onOpenConnectModal}>
        {chipLabel}
      </button>
    </header>
  )
}

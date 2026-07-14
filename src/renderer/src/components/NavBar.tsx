export type AppTab = 'analyze' | 'insights'

interface NavBarProps {
  activeTab: AppTab
  onSelectTab: (tab: AppTab) => void
  isAnalyzing: boolean
}

export function NavBar({ activeTab, onSelectTab, isAnalyzing }: NavBarProps): JSX.Element {
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
          Insights
        </button>
      </nav>
    </header>
  )
}

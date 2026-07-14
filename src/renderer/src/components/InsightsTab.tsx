export function InsightsTab(): JSX.Element {
  return (
    <div className="insights-tab insights-empty">
      <p className="insights-empty-message">Scan your games to see patterns in your play.</p>
      <button className="insights-scan-button" disabled title="Coming soon">
        Scan my games
      </button>
    </div>
  )
}

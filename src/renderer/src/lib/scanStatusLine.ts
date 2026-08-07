import { formatRelativeTime } from './relativeTime'

// A scan older than this no longer reflects "recent" play - the last-scan
// line switches to a warning tone and nudges toward rescanning instead of
// just reporting a fact the user has to notice is stale themselves.
const STALE_SCAN_MS = 24 * 60 * 60 * 1000

export interface ScanStatusInput {
  lastScanTime: number | null
  gamesScanned: number
  // True when cached records were written by an older analysis schema. Those
  // records are filtered out of every aggregate (see
  // loadCurrentSchemaGameRecords), so the report can be empty while the disk
  // is full of games.
  staleSchema: boolean
  now: number
}

export interface ScanStatus {
  text: string
  stale: boolean
}

// Extracted from InsightsTab so this line can be tested at all: the suite runs
// in a node environment with no DOM, and this is the one place the app
// explains why a schema bump emptied the Insights tab.
export function scanStatusLine({
  lastScanTime,
  gamesScanned,
  staleSchema,
  now
}: ScanStatusInput): ScanStatus {
  const stale = staleSchema || (lastScanTime !== null && now - lastScanTime > STALE_SCAN_MS)

  if (lastScanTime === null) {
    // A schema bump makes every cached record stale, so the report arrives
    // empty and the tab, the mastery tree and the puzzle queues all go blank.
    // The user has to be told why, and "No scan yet" beside a "Scan my games"
    // button reads as if their work never existed. lastScanTime is null here
    // whenever the only scan they ever ran was cancelled or errored partway:
    // it is written only when a scan finishes, while the games it analysed
    // were cached one by one as it went.
    return { text: staleSchema ? 'Analysis improved — rescan to update' : 'No scan yet', stale }
  }

  const suffix = staleSchema
    ? ' — analysis improved, rescan to update'
    : stale
      ? ' — rescan to catch up'
      : ''
  return {
    text: `Scanned ${formatRelativeTime(lastScanTime, now)} · ${gamesScanned} games${suffix}`,
    stale
  }
}

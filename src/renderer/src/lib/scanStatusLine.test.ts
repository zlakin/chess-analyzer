import { describe, it, expect } from 'vitest'
import { scanStatusLine } from './scanStatusLine'

const NOW = new Date('2026-08-06T12:00:00Z').getTime()
const HOUR = 60 * 60 * 1000

describe('scanStatusLine', () => {
  it('reports a recent scan without a nudge', () => {
    const status = scanStatusLine({
      lastScanTime: NOW - 2 * HOUR,
      gamesScanned: 40,
      staleSchema: false,
      now: NOW
    })
    expect(status.text).toBe('Scanned 2 hours ago · 40 games')
    expect(status.stale).toBe(false)
  })

  it('nudges toward a rescan once a scan is a day old', () => {
    const status = scanStatusLine({
      lastScanTime: NOW - 30 * HOUR,
      gamesScanned: 40,
      staleSchema: false,
      now: NOW
    })
    expect(status.text).toContain('rescan to catch up')
    expect(status.stale).toBe(true)
  })

  // The empty state a schema bump produces: every cached record is filtered
  // out of the aggregates, so gamesScanned is 0 and the whole tab is blank.
  // The line is the only thing telling the user their data is not lost.
  it('explains a schema bump even though the report came back empty', () => {
    const status = scanStatusLine({
      lastScanTime: NOW - 2 * HOUR,
      gamesScanned: 0,
      staleSchema: true,
      now: NOW
    })
    expect(status.text).toContain('analysis improved, rescan to update')
    expect(status.stale).toBe(true)
  })

  // Reachable whenever the user's only scan was cancelled or errored partway:
  // games are cached game by game, but lastScanTime is written only when a
  // scan runs to the end. A bump then blanks their tab, and "No scan yet"
  // beside a "Scan my games" button would deny the work ever happened.
  it('still explains a schema bump when no scan ever finished', () => {
    const status = scanStatusLine({
      lastScanTime: null,
      gamesScanned: 0,
      staleSchema: true,
      now: NOW
    })
    expect(status.text).toBe('Analysis improved — rescan to update')
    expect(status.stale).toBe(true)
  })

  it('says nothing about a rescan for a user who has genuinely never scanned', () => {
    const status = scanStatusLine({
      lastScanTime: null,
      gamesScanned: 0,
      staleSchema: false,
      now: NOW
    })
    expect(status.text).toBe('No scan yet')
    expect(status.stale).toBe(false)
  })
})

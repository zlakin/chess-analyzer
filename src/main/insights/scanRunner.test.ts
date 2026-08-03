import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChessComGameSummary, PositionEvaluation, ScanProgress } from '../../shared/types'

const fetchRecentGamesMock = vi.fn()
const isGameScannedMock = vi.fn()
const saveGameRecordMock = vi.fn()
const saveScanMetaMock = vi.fn()
const ensureUsernameScopeMock = vi.fn()
const ensureSchemaVersionMock = vi.fn()

vi.mock('../chesscom/chessComClient', () => ({
  fetchRecentGames: (username: string, limit?: number) => fetchRecentGamesMock(username, limit)
}))

vi.mock('./insightsStore', () => ({
  isGameScanned: (url: string) => isGameScannedMock(url),
  saveGameRecord: (record: unknown) => saveGameRecordMock(record),
  saveScanMeta: (patch: unknown) => saveScanMetaMock(patch),
  ensureUsernameScope: (username: string) => ensureUsernameScopeMock(username),
  ensureSchemaVersion: () => ensureSchemaVersionMock(),
  // extractInsightRecord.ts (reached indirectly through runScan) reads this
  // constant to stamp every record it builds -- the mock above replaces the
  // whole module, so it has to be supplied here too or that import resolves
  // to undefined. The exact number doesn't matter to any assertion below.
  CURRENT_SCHEMA_VERSION: 2,
  // scanRunner.ts now imports its game-fetch limit from insightsStore.ts
  // (moved there so isSchemaStale() and runScan() share one definition
  // instead of duplicating the number) -- same reasoning as
  // CURRENT_SCHEMA_VERSION above: the mock replaces the whole module, so
  // this must be supplied too. The exact number doesn't matter to any
  // assertion below.
  SCAN_GAME_LIMIT: 100
}))

import { runScan } from './scanRunner'

function game(url: string, pgn = '1. e4 e5'): ChessComGameSummary {
  return {
    url,
    pgn,
    endTime: 1000,
    timeControl: '600',
    white: { username: 'testuser', rating: 1500, result: 'win' },
    black: { username: 'opponent', rating: 1490, result: 'checkmated' }
  }
}

function fakePool(): {
  evaluatePosition: () => Promise<PositionEvaluation>
  stop: () => void
} {
  return {
    evaluatePosition: async () => ({
      lines: [{ depth: 14, scoreCp: 20, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'] }]
    }),
    stop: () => {}
  }
}

describe('runScan', () => {
  beforeEach(() => {
    fetchRecentGamesMock.mockReset()
    isGameScannedMock.mockReset()
    saveGameRecordMock.mockReset()
    saveScanMetaMock.mockReset()
    ensureUsernameScopeMock.mockReset()
    ensureSchemaVersionMock.mockReset()
    isGameScannedMock.mockReturnValue(false)
  })

  it('scopes the cache to the tracked username before fetching any games', async () => {
    fetchRecentGamesMock.mockResolvedValue([])

    await runScan('testuser', { createPool: async () => fakePool() })

    expect(ensureUsernameScopeMock).toHaveBeenCalledWith('testuser')
  })

  it('skips games that are already scanned', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    isGameScannedMock.mockImplementation((url: string) => url === 'g1')

    const result = await runScan('testuser', { createPool: async () => fakePool() })

    expect(result).toEqual({ scanned: 1 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('reports progress as each game finishes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const progressUpdates: ScanProgress[] = []

    await runScan('testuser', {
      createPool: async () => fakePool(),
      onProgress: (p) => progressUpdates.push(p)
    })

    expect(progressUpdates).toEqual([
      { scanned: 0, total: 2, etaMs: null },
      { scanned: 1, total: 2, etaMs: expect.any(Number) },
      { scanned: 2, total: 2, etaMs: expect.any(Number) }
    ])
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])

    const result = await runScan('testuser', {
      createPool: async () => fakePool(),
      isCancelled: () => true
    })

    expect(result).toEqual({ cancelled: true })
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })

  it('skips a game that fails to parse instead of aborting the whole scan', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1', 'not a valid pgn'), game('g2')])

    const result = await runScan('testuser', { createPool: async () => fakePool() })

    expect(result).toEqual({ scanned: 2 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('records lastScanTime and username in scan metadata when the scan completes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1')])

    await runScan('testuser', { createPool: async () => fakePool() })

    expect(saveScanMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'testuser', lastScanTime: expect.any(Number) })
    )
  })

  it('propagates an analysis engine failure so the whole scan aborts rather than silently continuing', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const crashingPool = (): { evaluatePosition: () => Promise<PositionEvaluation>; stop: () => void } => ({
      evaluatePosition: async () => {
        throw new Error('engine crashed')
      },
      stop: () => {}
    })

    await expect(
      runScan('testuser', { createPool: async () => crashingPool() })
    ).rejects.toThrow('engine crashed')
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })

  it('stops the pool when the scan finishes', async () => {
    const stop = vi.fn()
    fetchRecentGamesMock.mockResolvedValue([game('https://example.com/1')])
    isGameScannedMock.mockReturnValue(false)

    await runScan('testuser', { createPool: async () => ({ ...fakePool(), stop }) })

    expect(stop).toHaveBeenCalledOnce()
  })

  it('reports an eta once at least one game has completed', async () => {
    fetchRecentGamesMock.mockResolvedValue([
      game('https://example.com/1'),
      game('https://example.com/2')
    ])
    isGameScannedMock.mockReturnValue(false)
    const progress: ScanProgress[] = []

    await runScan('testuser', {
      createPool: async () => fakePool(),
      onProgress: (p) => progress.push(p)
    })

    expect(progress[0].etaMs).toBeNull()
    const last = progress[progress.length - 1]
    expect(last.etaMs).not.toBeNull()
    expect(typeof last.etaMs).toBe('number')
  })

  it('returns an error when the pool cannot start', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('https://example.com/1')])
    isGameScannedMock.mockReturnValue(false)

    const result = await runScan('testuser', {
      createPool: async () => {
        throw new Error('no binary')
      }
    })

    expect(result).toEqual({ error: 'Could not start Stockfish: no binary' })
  })
})

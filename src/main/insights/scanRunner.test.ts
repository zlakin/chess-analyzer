import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChessComGameSummary, PositionEvaluation } from '../../shared/types'

const fetchRecentGamesMock = vi.fn()
const isGameScannedMock = vi.fn()
const saveGameRecordMock = vi.fn()
const saveScanMetaMock = vi.fn()

vi.mock('../chesscom/chessComClient', () => ({
  fetchRecentGames: (username: string, limit?: number) => fetchRecentGamesMock(username, limit)
}))

vi.mock('./insightsStore', () => ({
  isGameScanned: (url: string) => isGameScannedMock(url),
  saveGameRecord: (record: unknown) => saveGameRecordMock(record),
  saveScanMeta: (patch: unknown) => saveScanMetaMock(patch)
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

function fakeEngine(): {
  evaluatePosition: () => Promise<PositionEvaluation>
  start: () => Promise<void>
  stop: () => void
} {
  return {
    evaluatePosition: async () => ({
      lines: [{ depth: 14, scoreCp: 20, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'] }]
    }),
    start: async () => {},
    stop: () => {}
  }
}

describe('runScan', () => {
  beforeEach(() => {
    fetchRecentGamesMock.mockReset()
    isGameScannedMock.mockReset()
    saveGameRecordMock.mockReset()
    saveScanMetaMock.mockReset()
    isGameScannedMock.mockReturnValue(false)
  })

  it('skips games that are already scanned', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    isGameScannedMock.mockImplementation((url: string) => url === 'g1')

    const result = await runScan('testuser', { createEngine: fakeEngine })

    expect(result).toEqual({ scanned: 1 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('reports progress as each game finishes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const progressUpdates: Array<{ scanned: number; total: number }> = []

    await runScan('testuser', { createEngine: fakeEngine, onProgress: (p) => progressUpdates.push(p) })

    expect(progressUpdates).toEqual([
      { scanned: 0, total: 2 },
      { scanned: 1, total: 2 },
      { scanned: 2, total: 2 }
    ])
  })

  it('stops early and returns cancelled when isCancelled is true', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])

    const result = await runScan('testuser', { createEngine: fakeEngine, isCancelled: () => true })

    expect(result).toEqual({ cancelled: true })
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })

  it('skips a game that fails to parse instead of aborting the whole scan', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1', 'not a valid pgn'), game('g2')])

    const result = await runScan('testuser', { createEngine: fakeEngine })

    expect(result).toEqual({ scanned: 2 })
    expect(saveGameRecordMock).toHaveBeenCalledTimes(1)
    expect(saveGameRecordMock.mock.calls[0][0]).toMatchObject({ gameUrl: 'g2' })
  })

  it('records lastScanTime and username in scan metadata when the scan completes', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1')])

    await runScan('testuser', { createEngine: fakeEngine })

    expect(saveScanMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'testuser', lastScanTime: expect.any(Number) })
    )
  })

  it('propagates an analysis engine failure so the whole scan aborts rather than silently continuing', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1'), game('g2')])
    const crashingEngine = (): {
      evaluatePosition: () => Promise<PositionEvaluation>
      start: () => Promise<void>
      stop: () => void
    } => ({
      evaluatePosition: async () => {
        throw new Error('engine crashed')
      },
      start: async () => {},
      stop: () => {}
    })

    await expect(runScan('testuser', { createEngine: crashingEngine })).rejects.toThrow('engine crashed')
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })
})

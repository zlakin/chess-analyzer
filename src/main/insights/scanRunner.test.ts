import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChessComGameSummary, PositionEvaluation } from '../../shared/types'

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
  ensureSchemaVersion: () => ensureSchemaVersionMock()
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
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

    await runScan('testuser', { createEngine: fakeEngine })

    expect(ensureUsernameScopeMock).toHaveBeenCalledWith('testuser')
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

  it('never sends more than one concurrent evaluatePosition call to the reused engine', async () => {
    // '1. e4 e5' parses to 2 positions -> analyzeGame (Task 2) dispatches 3
    // evaluatePosition calls (fenBefore + 2 fenAfter) concurrently for this
    // one game. Since scanRunner reuses a single raw engine instance across
    // the whole scan, those 3 calls must be serialized before reaching it --
    // otherwise a real StockfishManager (which has no per-call request
    // identity) would silently cross-contaminate results between them.
    fetchRecentGamesMock.mockResolvedValue([game('g1')])

    const inFlight: Array<{ resolve: (value: PositionEvaluation) => void }> = []
    let concurrentInFlight = 0
    let maxConcurrentInFlight = 0

    const engine = {
      evaluatePosition: async (): Promise<PositionEvaluation> => {
        concurrentInFlight += 1
        maxConcurrentInFlight = Math.max(maxConcurrentInFlight, concurrentInFlight)
        const d = deferred<PositionEvaluation>()
        inFlight.push(d)
        const result = await d.promise
        concurrentInFlight -= 1
        return result
      },
      start: async () => {},
      stop: () => {}
    }

    const scanPromise = runScan('testuser', { createEngine: () => engine })

    await flushMicrotasks()

    // If the engine were not serialized, all 3 calls dispatched by
    // analyzeGame would already be in flight at once here.
    expect(inFlight).toHaveLength(1)
    expect(maxConcurrentInFlight).toBe(1)

    const evaluation: PositionEvaluation = {
      lines: [{ depth: 14, scoreCp: 20, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'] }]
    }

    inFlight[0].resolve(evaluation)
    await flushMicrotasks()
    expect(inFlight).toHaveLength(2)
    expect(maxConcurrentInFlight).toBe(1)

    inFlight[1].resolve(evaluation)
    await flushMicrotasks()
    expect(inFlight).toHaveLength(3)
    expect(maxConcurrentInFlight).toBe(1)

    inFlight[2].resolve(evaluation)

    const result = await scanPromise
    expect(result).toEqual({ scanned: 1 })
  })

  it('calls engine.stop() if engine.start() fails', async () => {
    fetchRecentGamesMock.mockResolvedValue([game('g1')])
    const stopMock = vi.fn()
    const failingEngineFactory = () => ({
      evaluatePosition: async () => ({
        lines: [{ depth: 14, scoreCp: 20, scoreMate: null, moveUci: 'e2e4', pv: ['e2e4'] }]
      }),
      start: async () => {
        throw new Error('Stockfish binary not found')
      },
      stop: stopMock
    })

    const result = await runScan('testuser', { createEngine: failingEngineFactory })

    expect(result).toEqual({
      error: 'Could not start Stockfish: Stockfish binary not found'
    })
    expect(stopMock).toHaveBeenCalledOnce()
    expect(saveGameRecordMock).not.toHaveBeenCalled()
  })
})

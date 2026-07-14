import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`)
      return userDataDir
    }
  }
}))

import {
  loadScanMeta,
  saveScanMeta,
  isGameScanned,
  saveGameRecord,
  loadAllGameRecords,
  ensureUsernameScope
} from './insightsStore'
import type { GameInsightRecord } from '../../shared/types'

function record(gameUrl: string): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: []
  }
}

describe('insightsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-insights-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({ username: null, lastScanTime: null, scannedUrls: [] })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({ username: 'hikaru', lastScanTime: 12345, scannedUrls: [] })
  })

  it('a game is not scanned until its record is saved', () => {
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  it('treats a corrupted per-game cache file as not scanned, even if scan-meta lists it', () => {
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    const dir = join(userDataDir, 'games')
    const [fileName] = readdirSync(dir)
    writeFileSync(join(dir, fileName), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
  })

  it('still treats a game as scanned when scan-meta.json is corrupted but its own cache file is intact', () => {
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    writeFileSync(join(userDataDir, 'scan-meta.json'), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  describe('ensureUsernameScope', () => {
    it('records the username on the very first scan without clearing anything', () => {
      saveGameRecord(record('https://www.chess.com/game/live/1'))
      ensureUsernameScope('hikaru')

      expect(loadScanMeta().username).toBe('hikaru')
      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('is a no-op when the username is unchanged (case-insensitively)', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(record('https://www.chess.com/game/live/1'))

      ensureUsernameScope('Hikaru')

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('clears all cached game records and resets scan metadata when the tracked username changes', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(record('https://www.chess.com/game/live/1'))
      saveGameRecord(record('https://www.chess.com/game/live/2'))

      ensureUsernameScope('magnuscarlsen')

      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta()).toEqual({ username: 'magnuscarlsen', lastScanTime: null, scannedUrls: [] })
    })

    it('records the username immediately, before any games are cached, so an interrupted scan is not mistaken for having no tracked user', () => {
      ensureUsernameScope('hikaru')
      // Simulate a scan that cached nothing yet (e.g. it was interrupted
      // before the first game finished analysis) -- username should still
      // be recorded so a later switch to a different username is detected.
      ensureUsernameScope('magnuscarlsen')

      expect(loadScanMeta().username).toBe('magnuscarlsen')
    })
  })

  it('loadAllGameRecords returns every saved record and skips corrupted files', () => {
    saveGameRecord(record('https://www.chess.com/game/live/1'))
    saveGameRecord(record('https://www.chess.com/game/live/2'))
    mkdirSync(join(userDataDir, 'games'), { recursive: true })
    writeFileSync(join(userDataDir, 'games', 'garbage.json'), 'not json', 'utf-8')

    const records = loadAllGameRecords()
    expect(records).toHaveLength(2)
    expect(records.map((r) => r.gameUrl).sort()).toEqual([
      'https://www.chess.com/game/live/1',
      'https://www.chess.com/game/live/2'
    ])
  })

  it('returns an empty array when no games directory exists yet', () => {
    expect(loadAllGameRecords()).toEqual([])
  })
})

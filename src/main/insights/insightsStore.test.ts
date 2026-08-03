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
  ensureUsernameScope,
  ensureSchemaVersion,
  isSchemaStale,
  CURRENT_SCHEMA_VERSION
} from './insightsStore'
import type { GameInsightRecord } from '../../shared/types'
import { createHash } from 'node:crypto'

function recordFor(gameUrl: string): GameInsightRecord {
  return {
    gameUrl,
    endTime: 1000,
    timeControlCategory: 'rapid',
    userColor: 'w',
    opponentUsername: 'opponent',
    result: 'win',
    openingName: null,
    accuracy: 90,
    mistakes: [],
    schemaVersion: CURRENT_SCHEMA_VERSION
  }
}

// Writes a game-record JSON file directly to disk, bypassing saveGameRecord
// -- needed to simulate a record shape saveGameRecord itself could never
// produce, e.g. one written before the schemaVersion field existed at all.
function writeRecordJsonDirectly(gameUrl: string, json: unknown): void {
  const dir = join(userDataDir, 'games')
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(gameUrl).digest('hex')
  writeFileSync(join(dir, `${hash}.json`), JSON.stringify(json), 'utf-8')
}

describe('insightsStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'chess-analyzer-insights-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns default scan metadata when nothing has been scanned yet', () => {
    expect(loadScanMeta()).toEqual({
      username: null,
      lastScanTime: null,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('round-trips scan metadata', () => {
    saveScanMeta({ username: 'hikaru', lastScanTime: 12345 })
    expect(loadScanMeta()).toEqual({
      username: 'hikaru',
      lastScanTime: 12345,
      scannedUrls: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    })
  })

  it('a game is not scanned until its record is saved', () => {
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  it('treats a corrupted per-game cache file as not scanned, even if scan-meta lists it', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    const dir = join(userDataDir, 'games')
    const [fileName] = readdirSync(dir)
    writeFileSync(join(dir, fileName), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(false)
  })

  it('still treats a game as scanned when scan-meta.json is corrupted but its own cache file is intact', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    writeFileSync(join(userDataDir, 'scan-meta.json'), '{not valid json', 'utf-8')

    expect(isGameScanned('https://www.chess.com/game/live/1')).toBe(true)
  })

  describe('ensureUsernameScope', () => {
    it('records the username on the very first scan without clearing anything', () => {
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      ensureUsernameScope('hikaru')

      expect(loadScanMeta().username).toBe('hikaru')
      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('is a no-op when the username is unchanged (case-insensitively)', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))

      ensureUsernameScope('Hikaru')

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('clears all cached game records and resets scan metadata when the tracked username changes', () => {
      ensureUsernameScope('hikaru')
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      saveGameRecord(recordFor('https://www.chess.com/game/live/2'))

      ensureUsernameScope('magnuscarlsen')

      expect(loadAllGameRecords()).toEqual([])
      expect(loadScanMeta()).toEqual({
        username: 'magnuscarlsen',
        lastScanTime: null,
        scannedUrls: [],
        schemaVersion: CURRENT_SCHEMA_VERSION
      })
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

  describe('ensureSchemaVersion', () => {
    it('is a no-op when the stored schema version already matches', () => {
      saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
      ensureSchemaVersion()

      expect(loadAllGameRecords()).toHaveLength(1)
    })

    it('does not delete cached records when the schema version is stale, but still persists the new version', () => {
      saveGameRecord(recordFor('https://example.com/1'))
      saveScanMeta({ schemaVersion: 1 })

      ensureSchemaVersion()

      expect(loadAllGameRecords()).toHaveLength(1)
      expect(loadScanMeta().schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    })
  })

  it('reports a stale schema without changing the stored version', () => {
    // isSchemaStale() answers from the per-game records themselves, not
    // from scan-meta's own schemaVersion bookkeeping field -- so staleness
    // requires an actual stale record, and the assertion below confirms
    // it's a pure read that never touches scan-meta's stored version as a
    // side effect.
    saveGameRecord({ ...recordFor('https://example.com/1a'), schemaVersion: 1 })
    const storedVersionBefore = loadScanMeta().schemaVersion

    expect(isSchemaStale()).toBe(true)
    expect(loadScanMeta().schemaVersion).toBe(storedVersionBefore)
  })

  it('treats a record written under an older schema as unscanned so a rescan rebuilds it', () => {
    const url = 'https://example.com/2'
    saveGameRecord({ ...recordFor(url), schemaVersion: 1 })
    expect(isGameScanned(url)).toBe(false)
  })

  it('treats a record written under the current schema as scanned', () => {
    const url = 'https://example.com/3'
    saveGameRecord(recordFor(url))
    expect(isGameScanned(url)).toBe(true)
  })

  it('treats a record with no schemaVersion field as version 1', () => {
    const url = 'https://example.com/4'
    const { schemaVersion: _omitted, ...legacy } = recordFor(url)
    writeRecordJsonDirectly(url, legacy)
    expect(isGameScanned(url)).toBe(false)
    expect(loadAllGameRecords()).toHaveLength(1)
  })

  it('loadAllGameRecords returns every saved record and skips corrupted files', () => {
    saveGameRecord(recordFor('https://www.chess.com/game/live/1'))
    saveGameRecord(recordFor('https://www.chess.com/game/live/2'))
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
